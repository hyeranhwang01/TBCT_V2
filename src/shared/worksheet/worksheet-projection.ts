// The write-path contract for the worksheet layer. RuntimeContext.fields
// (persisted inside runtime_sessions.data, see src/shared/runtime/runtime-context.ts)
// remains the single canonical source of truth. Nothing in this module
// writes worksheet_field_values from anywhere other than that canonical
// state, and worksheet-originated edits are written back through the same
// canonical state before being re-projected -- there is deliberately no
// path that lets worksheetJson and runtimeFields diverge:
//
//   Participant message -> assessment extraction -> existing clinical
//   validation -> canonical RuntimeContext.fields update -> (this module)
//   projectRuntimeFieldsToWorksheet -> worksheet_field_values -> renderer
//
//   Participant worksheet edit -> (this module) editWorksheetField ->
//   canonical RuntimeContext.fields update -> re-projection -> audit event
//
// KNOWN LIMITATION (flagged, not silently glossed over): editWorksheetField
// merges the edited value directly into runtimeContext.fields without
// re-running extractRuntimeState's field-specific validation (e.g. the
// feeling/urge-vs-thought heuristics, sibling-repeat checks). It is safe for
// this pilot's bound fields (plain text/percentage/list edits confirmed by
// the participant themselves) but should not be treated as equivalent to a
// real turn's validation until that's addressed.

import { getRuntimeSession, listRuntimeSessions, listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { listRuntimeParticipants } from "@/shared/api/participant-api";
import { updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { TBCT_SOURCE_TEXT_HASH } from "@/shared/protocol/tbct-source-text.generated";
import { getWorksheetBindings, hasWorksheetBindings } from "@/shared/worksheet/worksheet-binding-registry";
import {
  appendWorksheetEvent,
  appendWorksheetFieldRevision,
  ensureWorksheetInstance,
  ensureWorksheetTemplateVersion,
  getWorksheetInstance,
  listWorksheetFieldDefinitions,
  listWorksheetFieldValues,
  replaceWorksheetCollectionItems,
  upsertWorksheetFieldValue,
} from "@/shared/data/repositories/worksheet-repository";
import type { CohortProgressSummaryRow, ProgressSeries, SessionProgressCard, WorksheetFieldDefinitionRecord, WorksheetFieldProvenance, WorksheetFieldStatus, WorksheetFieldValueRecord, WorksheetHistoryRow, WorksheetHistoryView, WorksheetView } from "@/types/worksheet";

const TEMPLATE_VERSION = 1;

async function ensureTemplateAndInstance(runtimeSessionId: string, sessionDefinitionId: string) {
  const bindings = getWorksheetBindings(sessionDefinitionId);
  const templateVersion = await ensureWorksheetTemplateVersion({
    templateId: `worksheet-template-${sessionDefinitionId}`,
    sessionDefinitionId,
    title: `${sessionDefinitionId} worksheet`,
    version: TEMPLATE_VERSION,
    sourceTextHash: TBCT_SOURCE_TEXT_HASH,
    fieldDefinitions: bindings.map((binding) => ({
      canonicalFieldKey: binding.canonicalFieldKey,
      worksheetFieldKey: binding.worksheetFieldKey,
      valueType: binding.valueType,
      participantOwned: binding.participantOwned,
      assistantMustNotSupply: binding.assistantMustNotSupply,
      confirmationRequired: binding.confirmationRequired,
      visualElementId: binding.visualElementId,
      displayOrder: binding.displayOrder,
      sourceSection: binding.sourceSection,
    })),
  });
  const instance = await ensureWorksheetInstance(runtimeSessionId, templateVersion.id);
  const fieldDefinitions = await listWorksheetFieldDefinitions(templateVersion.id);
  return { templateVersion, instance, fieldDefinitions };
}

function displayValueFor(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Called after a turn's canonical fields update (commitRuntimeAssistantTurn
 * / claimRuntimePatientTurn). Projects every bound field that has a value in
 * `fields` into worksheet_field_values -- draft_extracted for a first-time
 * or changed value, left untouched for a field the participant already
 * confirmed with the same value, so an unrelated turn doesn't silently
 * knock a confirmed box back to unconfirmed. */
export async function projectRuntimeFieldsToWorksheet(input: {
  runtimeSessionId: string;
  sessionDefinitionId: string;
  fields: Record<string, unknown>;
  sourceTurnId?: string;
}): Promise<void> {
  if (!hasWorksheetBindings(input.sessionDefinitionId)) return;
  const { instance, fieldDefinitions } = await ensureTemplateAndInstance(input.runtimeSessionId, input.sessionDefinitionId);
  const existingValues = await listWorksheetFieldValues(instance.id);
  const existingByDefinitionId = new Map(existingValues.map((value) => [value.fieldDefinitionId, value]));
  const bindings = getWorksheetBindings(input.sessionDefinitionId);
  const bindingByCanonicalKey = new Map(bindings.map((binding) => [binding.canonicalFieldKey, binding]));

  for (const definition of fieldDefinitions) {
    if (!(definition.canonicalFieldKey in input.fields)) continue;
    const rawValue = input.fields[definition.canonicalFieldKey];
    if (rawValue === undefined) continue;
    const binding = bindingByCanonicalKey.get(definition.canonicalFieldKey);
    const existing = existingByDefinitionId.get(definition.id);
    const unchanged = existing && JSON.stringify(existing.value) === JSON.stringify(rawValue);
    if (unchanged && existing?.status === "participant_confirmed") continue; // don't unconfirm on a no-op re-project

    // FIXED (Patient Authorship Invariant, .claude/TASK_SCOPE.json
    // note2026_09_05): this used to key off assistantMustNotSupply, which
    // asserted "confirmed" for the overwhelming majority of fields at the
    // moment of first projection -- before confirmWorksheetField below has
    // ever run -- while a field the assistant WAS allowed to author (S03's
    // 18 pre-fix bindings) got labeled "verbatim". A freshly projected
    // value is whatever extractRuntimeState stored, which is the
    // participant's own wording verbatim for every participant-owned field
    // (runtime-context.ts:1136-1153); "confirmed" is a claim about an event
    // that has not happened yet at projection time -- only
    // confirmWorksheetField below is allowed to make that claim. The one
    // case where the value never came from the participant's own words at
    // all is a system-owned field (participantOwned: false, e.g. a
    // calculated total).
    const provenance: WorksheetFieldProvenance = binding && !binding.participantOwned ? "system_calculated" : "participant_verbatim";
    const status: WorksheetFieldStatus = unchanged ? (existing?.status ?? "draft_extracted") : "draft_extracted";

    if (definition.valueType === "text_list" && Array.isArray(rawValue)) {
      const fieldValue = await upsertWorksheetFieldValue(instance.id, definition.id, {
        status, provenance, sourceTurnId: input.sourceTurnId, value: rawValue, displayValue: displayValueFor(rawValue),
      });
      await replaceWorksheetCollectionItems(fieldValue.id, rawValue.map((item) => ({ value: item, displayValue: String(item), status, provenance, sourceTurnId: input.sourceTurnId })));
      await appendWorksheetFieldRevision({ fieldValueId: fieldValue.id, status, provenance, sourceTurnId: input.sourceTurnId, snapshot: rawValue });
      continue;
    }

    const fieldValue = await upsertWorksheetFieldValue(instance.id, definition.id, {
      status, provenance, sourceTurnId: input.sourceTurnId, value: rawValue, displayValue: displayValueFor(rawValue),
    });
    if (!unchanged) await appendWorksheetFieldRevision({ fieldValueId: fieldValue.id, status, provenance, sourceTurnId: input.sourceTurnId, snapshot: rawValue });
  }
}

/** Assembles the read model the WorksheetPane UI renders. Safe to call on
 * session resume -- it only reads persisted state, never mutates it. */
export async function getWorksheetView(runtimeSessionId: string, sessionDefinitionId: string): Promise<WorksheetView | null> {
  if (!hasWorksheetBindings(sessionDefinitionId)) return null;
  const { instance, templateVersion, fieldDefinitions } = await ensureTemplateAndInstance(runtimeSessionId, sessionDefinitionId);
  const values = await listWorksheetFieldValues(instance.id);
  const valueByDefinitionId = new Map(values.map((value) => [value.fieldDefinitionId, value]));
  const bindings = getWorksheetBindings(sessionDefinitionId);
  const bindingByWorksheetKey = new Map(bindings.map((binding) => [binding.worksheetFieldKey, binding]));
  // ensureTemplateAndInstance's worksheet_field_definitions rows are written
  // ONCE per (templateId, TEMPLATE_VERSION) and then reused forever, so a
  // session created before a content rewrite that renamed or removed a
  // worksheetFieldKey (e.g. S01's personalThoughtEmotionLink/
  // personalEmotionBehaviorLink/personalBehaviorSituationLink, replaced by
  // openingInitialThought/personalEmotion/personalBehavior/
  // personalBodySensations) still has field-definition rows for the OLD key,
  // which no longer has a matching binding in the current registry. Filtering
  // those out here -- rather than asserting a binding always exists -- is
  // what actually crashed in production (TypeError: undefined is not an
  // object (evaluating 'e.binding.displayOrder')): an orphaned field simply
  // disappears from the view instead of crashing the whole panel.
  // The other direction (a field ADDED to a session's bindings after its
  // template version already exists -- S07's emotionReasonSpeakers/
  // consensusSurprise/consensusEmotionIntent/consensusPartsNeeds, which
  // simply never appeared for any session created before they were added)
  // is handled on the write side instead: ensureTemplateVersion now backfills
  // any missing current-binding definition row on every call, not only the
  // first one (see its own comment in worksheet-store.ts).
  const fields = fieldDefinitions
    .filter((definition: WorksheetFieldDefinitionRecord) => bindingByWorksheetKey.has(definition.worksheetFieldKey))
    .map((definition: WorksheetFieldDefinitionRecord) => ({
      definition,
      binding: bindingByWorksheetKey.get(definition.worksheetFieldKey)!,
      value: valueByDefinitionId.get(definition.id) ?? null,
    }));
  return { instance, templateVersion, fields };
}

/**
 * Cross-run "progress over time" view for a repeatable list+scores field
 * pair -- currently only S06's Symptom Hierarchy has one (see that
 * session's own manual's "Seeing your progress over time" sample sheet).
 * Not folded into getWorksheetView's generic per-run read model: aligning
 * "this item in run 3" with "the same item in run 1" needs a stable
 * identity, and the only one available is the item's own text, so this is
 * parameterized by a specific items/scores field-key pair rather than made
 * a general worksheet capability.
 *
 * Returns null if the current run's session can't be found, or if (somehow)
 * no run at all matches -- the caller decides whether a single-run result
 * (no real "history" yet) is worth rendering.
 */
export async function getListScoreHistory(input: {
  runtimeSessionId: string;
  sessionDefinitionId: string;
  itemsWorksheetFieldKey: string;
  scoresWorksheetFieldKey: string;
}): Promise<WorksheetHistoryView | null> {
  const current = await getRuntimeSession(input.runtimeSessionId);
  if (!current) return null;
  const { participantId, sessionDefinitionId } = current.session;
  const allSessions = await listRuntimeSessions();
  const runs = allSessions
    .filter((session) => session.participantId === participantId && session.sessionDefinitionId === sessionDefinitionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (!runs.length) return null;

  const perRun = await Promise.all(runs.map(async (run) => {
    const view = await getWorksheetView(run.id, sessionDefinitionId);
    const itemsField = view?.fields.find((field) => field.definition.worksheetFieldKey === input.itemsWorksheetFieldKey);
    const scoresField = view?.fields.find((field) => field.definition.worksheetFieldKey === input.scoresWorksheetFieldKey);
    const items = Array.isArray(itemsField?.value?.value) ? (itemsField!.value!.value as unknown[]).map((item) => String(item)) : [];
    const scores = Array.isArray(scoresField?.value?.value) ? (scoresField!.value!.value as unknown[]) : [];
    return { run, items, scores };
  }));

  // Union of every item text seen in any run, in first-seen order --
  // matched case/whitespace-insensitively so a minor rewording across runs
  // doesn't silently split into two rows, but the ORIGINAL wording (from
  // whichever run first introduced it) is what's displayed.
  const itemOrder: string[] = [];
  const seenKeys = new Set<string>();
  for (const { items } of perRun) {
    for (const item of items) {
      const key = item.trim().toLowerCase();
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        itemOrder.push(item);
      }
    }
  }

  const rows: WorksheetHistoryRow[] = itemOrder.map((item) => {
    const key = item.trim().toLowerCase();
    const scoresByRunId: Record<string, number | null> = {};
    for (const { run, items, scores } of perRun) {
      const index = items.findIndex((candidate) => candidate.trim().toLowerCase() === key);
      const rawScore = index >= 0 ? scores[index] : undefined;
      const parsed = rawScore !== undefined ? Number(rawScore) : NaN;
      scoresByRunId[run.id] = Number.isFinite(parsed) ? parsed : null;
    }
    return { item, scoresByRunId };
  });

  const totalsByRunId: Record<string, number | null> = {};
  for (const { run } of perRun) {
    const values = rows.map((row) => row.scoresByRunId[run.id]).filter((value): value is number => value !== null);
    totalsByRunId[run.id] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  return {
    runs: perRun.map(({ run }, index) => ({ runtimeSessionId: run.id, runLabel: `S${index + 1}`, startedAt: run.startedAt ?? run.createdAt })),
    rows,
    totalsByRunId,
  };
}

/**
 * Which before/after belief-%/intensity-% checkpoint pairs to chart per
 * session, for the patient-facing progress graph (patient-profile-page.tsx).
 * Field-audited against each session's actual worksheet bindings -- not
 * every session has a genuine multi-point pair (e.g. S03/S04 only capture
 * emotion intensity once, at the start, so intensity isn't charted for
 * those two; S08 has a 6-point belief chain but no intensity field at all).
 * `checkpoint` is a stable key the UI resolves through i18n, not a
 * pre-localized label (see ProgressPoint's own doc comment).
 */
const PROGRESS_SERIES_PLAN: Record<string, { seriesKey: string; checkpoints: { fieldKey: string; checkpoint: string }[] }[]> = {
  "tbct-s03": [
    {
      seriesKey: "belief",
      checkpoints: [
        { fieldKey: "automaticThoughtBeliefPercent", checkpoint: "before" },
        { fieldKey: "revisedAutomaticThoughtBeliefPercent", checkpoint: "after" },
      ],
    },
  ],
  "tbct-s04": [
    {
      seriesKey: "belief",
      checkpoints: [
        { fieldKey: "patientAutomaticThoughtBeliefPercent", checkpoint: "before" },
        { fieldKey: "revisedPatientAutomaticThoughtBeliefPercent", checkpoint: "after" },
      ],
    },
  ],
  "tbct-s05": [
    {
      seriesKey: "guiltBelief",
      checkpoints: [
        { fieldKey: "guiltBeliefBaseline", checkpoint: "start" },
        { fieldKey: "guiltBeliefFinal", checkpoint: "now" },
      ],
    },
    {
      seriesKey: "shameIntensity",
      checkpoints: [
        { fieldKey: "shameIntensityBaseline", checkpoint: "start" },
        { fieldKey: "shameIntensityFinal", checkpoint: "now" },
      ],
    },
  ],
  "tbct-s08": [
    {
      seriesKey: "belief",
      checkpoints: [
        { fieldKey: "coreBeliefBaselinePercent", checkpoint: "start" },
        { fieldKey: "defendantPostProsecutionBeliefPercent", checkpoint: "afterProsecution" },
        { fieldKey: "defendantPostDefenseBeliefPercent", checkpoint: "afterDefense" },
        { fieldKey: "defendantPostRebuttalBeliefPercent", checkpoint: "afterRebuttal" },
        { fieldKey: "defendantPostVerdictBeliefPercent", checkpoint: "afterVerdict" },
        { fieldKey: "originalChargeFinalBeliefPercent", checkpoint: "final" },
      ],
    },
  ],
};

/** Patient-facing "your progress" view: one card per session that has at
 * least one two-point (or longer) checkpoint series filled in, skipping
 * checkpoints the participant hasn't reached yet rather than fabricating a
 * zero. When a participant has more than one run of the same session, the
 * most recently completed run is preferred (falling back to the most
 * recently updated run of any status, so an in-progress session still shows
 * whatever's been filled in so far). */
export async function getPatientProgressSeries(participantId: string): Promise<SessionProgressCard[]> {
  const sessions = await listRuntimeSessionsForParticipant(participantId);
  const cards: SessionProgressCard[] = [];
  for (const [sessionDefinitionId, seriesPlans] of Object.entries(PROGRESS_SERIES_PLAN)) {
    const runs = sessions
      .filter((session) => session.sessionDefinitionId === sessionDefinitionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (!runs.length) continue;
    const preferredRun = runs.find((run) => run.status === "completed") ?? runs[0];
    const view = await getWorksheetView(preferredRun.id, sessionDefinitionId);
    if (!view) continue;
    const valueByFieldKey = new Map(view.fields.map((field) => [field.definition.worksheetFieldKey, field.value?.value]));

    const series: ProgressSeries[] = [];
    for (const plan of seriesPlans) {
      const points = plan.checkpoints
        .map(({ fieldKey, checkpoint }) => {
          const raw = valueByFieldKey.get(fieldKey);
          const value = raw === undefined || raw === null ? NaN : Number(raw);
          return { checkpoint, value };
        })
        .filter((point) => Number.isFinite(point.value));
      if (points.length >= 2) series.push({ seriesKey: plan.seriesKey, points });
    }
    if (series.length) cards.push({ sessionDefinitionId, series });
  }
  return cards;
}

/** Clinician-facing cohort rollup of getPatientProgressSeries: for every
 * participant, for every (session, series) pair they have a real two-point
 * series for, take last-minus-first, then average those deltas per pair
 * across the whole roster. Deliberately reuses getPatientProgressSeries per
 * participant rather than re-deriving the field plan -- this pilot's
 * participant count is small enough that one query per participant is not
 * a real cost, and it keeps PROGRESS_SERIES_PLAN defined in exactly one
 * place. A (session, series) pair nobody has reached yet is simply absent
 * from the result, never fabricated as a zero. */
export async function getCohortProgressSummary(): Promise<CohortProgressSummaryRow[]> {
  const participants = await listRuntimeParticipants();
  const perParticipant = await Promise.all(participants.map((participant) => getPatientProgressSeries(participant.id)));
  const deltasByKey = new Map<string, number[]>();
  for (const cards of perParticipant) {
    for (const card of cards) {
      for (const series of card.series) {
        const delta = series.points.at(-1)!.value - series.points[0].value;
        const key = `${card.sessionDefinitionId}:${series.seriesKey}`;
        const deltas = deltasByKey.get(key) ?? [];
        deltas.push(delta);
        deltasByKey.set(key, deltas);
      }
    }
  }
  return Array.from(deltasByKey.entries()).map(([key, deltas]) => {
    const [sessionDefinitionId, seriesKey] = key.split(":");
    const averageDelta = Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length);
    return { sessionDefinitionId, seriesKey, averageDelta, sampleSize: deltas.length };
  });
}

/** Participant confirms a field as shown -- the only status transition the
 * UI itself is allowed to make without going through a canonical update. */
export async function confirmWorksheetField(runtimeSessionId: string, sessionDefinitionId: string, worksheetFieldKey: string): Promise<WorksheetFieldValueRecord> {
  const { instance, fieldDefinitions } = await ensureTemplateAndInstance(runtimeSessionId, sessionDefinitionId);
  const definition = fieldDefinitions.find((item) => item.worksheetFieldKey === worksheetFieldKey);
  if (!definition) throw new Error(`Unknown worksheet field ${worksheetFieldKey} for ${sessionDefinitionId}`);
  const existing = (await listWorksheetFieldValues(instance.id)).find((value) => value.fieldDefinitionId === definition.id);
  const now = new Date().toISOString();
  // This is the one place "confirmed" provenance is actually earned -- see
  // the projection-time comment above for why it must not be asserted any
  // earlier.
  const provenance: WorksheetFieldProvenance = existing?.provenance === "system_calculated" ? "system_calculated" : "participant_confirmed_summary";
  const fieldValue = await upsertWorksheetFieldValue(instance.id, definition.id, {
    status: "participant_confirmed", provenance, confirmedAt: now, value: existing?.value, displayValue: existing?.displayValue,
  });
  await appendWorksheetFieldRevision({ fieldValueId: fieldValue.id, status: "participant_confirmed", provenance: fieldValue.provenance, snapshot: fieldValue.value });
  await appendWorksheetEvent(instance.id, "field_confirmed", { worksheetFieldKey });
  return fieldValue;
}

/** Participant edits a field's value from the worksheet pane. Routes the
 * edit through the canonical RuntimeContext.fields update (see the
 * KNOWN LIMITATION note at the top of this file) rather than writing
 * worksheet_field_values directly, then re-projects. */
export async function editWorksheetField(runtimeSessionId: string, sessionDefinitionId: string, worksheetFieldKey: string, nextValue: unknown): Promise<WorksheetFieldValueRecord> {
  const bindings = getWorksheetBindings(sessionDefinitionId);
  const binding = bindings.find((item) => item.worksheetFieldKey === worksheetFieldKey);
  if (!binding) throw new Error(`Unknown worksheet field ${worksheetFieldKey} for ${sessionDefinitionId}`);
  if (binding.assistantMustNotSupply === false && binding.participantOwned === false) throw new Error(`${worksheetFieldKey} is not participant-editable`);

  const view = await getRuntimeSession(runtimeSessionId);
  if (!view) throw new Error("Runtime session not found");
  const nextFields = { ...view.session.runtimeContext.fields, [binding.canonicalFieldKey]: nextValue };
  await updateRuntimeSessionRecord(runtimeSessionId, { runtimeContext: { ...view.session.runtimeContext, fields: nextFields } });

  const { instance, fieldDefinitions } = await ensureTemplateAndInstance(runtimeSessionId, sessionDefinitionId);
  const definition = fieldDefinitions.find((item) => item.worksheetFieldKey === worksheetFieldKey)!;
  const fieldValue = await upsertWorksheetFieldValue(instance.id, definition.id, {
    status: "participant_edited", provenance: "participant_verbatim", value: nextValue, displayValue: displayValueFor(nextValue),
  });
  await appendWorksheetFieldRevision({ fieldValueId: fieldValue.id, status: "participant_edited", provenance: "participant_verbatim", snapshot: nextValue });
  await appendWorksheetEvent(instance.id, "field_edited", { worksheetFieldKey });
  return fieldValue;
}
