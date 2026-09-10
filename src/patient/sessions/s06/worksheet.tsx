"use client";

import { useQuery } from "@tanstack/react-query";
import { ScoreChip, SessionSignals, WorksheetCell, capturedStatus, listCount } from "@/components/runtime/worksheet-renderers/shared";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import { getListScoreHistory } from "@/lib/worksheet/worksheet-projection";
import type { WorksheetFieldView, WorksheetHistoryView, WorksheetView } from "@/types/worksheet";

// Recreates the TBCT Session 6 Color-Coded Symptoms Hierarchy (CCSH): a
// severity-ordered list of situations, each scored 0-5 on the same color
// scale as the manual's own Annex card (bold chip, not a subtle tint --
// see ScoreChip), the green-only homework selection, the safety-behavior/
// underlying-assumption circuit box, and (when the participant has run
// this session more than once) the manual's own "seeing your progress
// over time" cross-run tracking table.

const SESSION_DEFINITION_ID = "tbct-s06";

export function S06Worksheet({
  view,
  activeCanonicalFieldKey,
  onConfirm,
  onEdit,
  busy,
  runtimeSessionId,
}: {
  view: WorksheetView;
  activeCanonicalFieldKey?: string;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
  runtimeSessionId: string;
}) {
  const reducedMotion = Boolean(useReducedMotionPreference());
  const byKey = new Map(view.fields.map((field) => [field.binding.worksheetFieldKey, field]));
  const get = (key: string) => byKey.get(key);
  const isActive = (field?: WorksheetFieldView) => Boolean(field && field.binding.canonicalFieldKey === activeCanonicalFieldKey);

  const historyQuery = useQuery({
    queryKey: ["worksheet-history", SESSION_DEFINITION_ID, runtimeSessionId],
    queryFn: () => getListScoreHistory({
      runtimeSessionId,
      sessionDefinitionId: SESSION_DEFINITION_ID,
      itemsWorksheetFieldKey: "symptomItems",
      scoresWorksheetFieldKey: "symptomItemScores",
    }),
    refetchInterval: 4000,
  });

  return (
    <div className="space-y-5 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <SessionSignals
        items={[
          { label: "Items tracked", value: listCount(get("symptomItems")) },
          { label: "Green practice selected", value: listCount(get("greenHomeworkItems")) },
          { label: "Safety behaviors noted", value: listCount(get("safetyBehaviors")) },
          { label: "Underlying assumption", value: capturedStatus(get("underlyingAssumption")) },
        ]}
      />
      <SymptomHierarchy itemsField={get("symptomItems")} scoresField={get("symptomItemScores")} active={isActive(get("symptomItems")) || isActive(get("symptomItemScores"))} onConfirm={onConfirm} />

      {historyQuery.data && historyQuery.data.runs.length > 1 && <SymptomHistoryTable history={historyQuery.data} />}

      <div className="rounded-panel border-2 border-success/40 bg-success-light/15 p-3 sm:p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">This week&apos;s practice — green items only</div>
        </div>
        <WorksheetCell field={get("greenHomeworkItems")} q="—" label="Chosen items" list borderless active={isActive(get("greenHomeworkItems"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <WorksheetCell field={get("accountabilityPartner")} q="—" label="Accountability partner" compact borderless active={isActive(get("accountabilityPartner"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <WorksheetCell field={get("fallbackPlan")} q="—" label="Plan B" compact borderless active={isActive(get("fallbackPlan"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
      </div>

      <div className="rounded-panel border border-border bg-surface p-3 sm:p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">The safety-behavior circuit</div>
        <WorksheetCell field={get("safetyBehaviors")} q="—" label="Safety behaviors I've noticed" list active={isActive(get("safetyBehaviors"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <div className="mt-2">
          <WorksheetCell field={get("underlyingAssumption")} q="—" label={'My underlying assumption ("If... then...")'} active={isActive(get("underlyingAssumption"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
      </div>

      <div className="rounded-panel border-2 border-clinical-blue/40 bg-clinical-blue-light/20 p-1">
        <WorksheetCell field={get("circuitTwoSummary")} q="—" label="My summary" borderless active={isActive(get("circuitTwoSummary"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>
    </div>
  );
}

function SymptomHierarchy({
  itemsField,
  scoresField,
  active,
  onConfirm,
}: {
  itemsField?: WorksheetFieldView;
  scoresField?: WorksheetFieldView;
  active: boolean;
  onConfirm: (worksheetFieldKey: string) => void;
}) {
  if (!itemsField || !scoresField) return null;
  const items = Array.isArray(itemsField.value?.value) ? (itemsField.value?.value as unknown[]) : [];
  const scores = Array.isArray(scoresField.value?.value) ? (scoresField.value?.value as unknown[]) : [];
  const filled = items.length > 0;
  const draftPending = itemsField.value?.status === "draft_extracted" || scoresField.value?.status === "draft_extracted";

  return (
    <div className={`rounded-panel border p-3 sm:p-4 transition ${active ? "ring-2 ring-clinical-blue border-clinical-blue" : "border-border bg-surface"} ${!filled ? "border-dashed opacity-70" : ""}`}>
      <div className="mb-3 text-sm font-semibold text-text-primary">Symptom Hierarchy</div>
      {filled ? (
        <ul className="space-y-1.5">
          {items.map((item, index) => {
            // Bold chip (same colors as the manual's own 0-5 Annex card),
            // not the subtler left-border tint this used to draw -- the
            // point of this scale is that the color reads at a glance.
            const score = scores[index] !== undefined ? Number(scores[index]) : null;
            return (
              <li key={index} className="flex items-center gap-2.5 rounded-panel border border-border bg-surface-subtle px-2.5 py-1.5">
                <ScoreChip score={score} />
                <span className="text-sm text-text-primary">{String(item)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="text-sm text-text-muted">&hellip;</div>
      )}
      {draftPending && (
        <button
          type="button"
          className="mt-2 rounded-panel border border-clinical-blue px-3 py-1 text-xs font-semibold text-clinical-blue"
          onClick={() => { onConfirm(itemsField.definition.worksheetFieldKey); onConfirm(scoresField.definition.worksheetFieldKey); }}
        >
          Confirm
        </button>
      )}
    </div>
  );
}

/** The manual's own "seeing your progress over time" sample sheet (a
 * per-item row, one column per past run of this session, colored score
 * chips, a TOTAL row) -- only shown once there's more than one run to
 * compare (see the historyQuery.data.runs.length > 1 gate above this
 * component's call site). overflow-x-auto guards against a wide run count
 * pushing the page itself sideways on a narrow viewport. */
function SymptomHistoryTable({ history }: { history: WorksheetHistoryView }) {
  return (
    <div className="rounded-panel border border-border bg-surface p-3 sm:p-4">
      <div className="mb-1 text-sm font-semibold text-text-primary">Seeing your progress over time</div>
      <div className="mb-3 text-xs text-text-secondary">The same items, scored again each time you&apos;ve run this session — watch reds and yellows drift toward greens and blues.</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.05em] text-text-muted">Item</th>
              {history.runs.map((run) => (
                <th key={run.runtimeSessionId} className="px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-[0.05em] text-text-muted">
                  {run.runLabel}
                  {run.startedAt && <div className="mt-0.5 font-normal normal-case text-[10px] text-text-muted">{new Date(run.startedAt).toLocaleDateString()}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.rows.map((row) => (
              <tr key={row.item} className="border-t border-border">
                <td className="px-2 py-1.5 text-text-primary">{row.item}</td>
                {history.runs.map((run) => (
                  <td key={run.runtimeSessionId} className="px-2 py-1.5 text-center">
                    <ScoreChip score={row.scoresByRunId[run.runtimeSessionId] ?? null} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-border-strong font-semibold">
              <td className="px-2 py-1.5 text-text-primary">Total</td>
              {history.runs.map((run) => (
                <td key={run.runtimeSessionId} className="px-2 py-1.5 text-center text-text-primary">{history.totalsByRunId[run.runtimeSessionId] ?? "—"}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
