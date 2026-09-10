"use client";

import { ChoicePills, SessionSignals, WorksheetCell, capturedStatus } from "@/components/runtime/worksheet-renderers/shared";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Recreates the TBCT Session 7 Consensual Role-Play (CRP) form: decisional
// balance, an Emotion-vs-Reason "tug of war" weighing, the empty-chair
// dialogue rendered as alternating speech bubbles, the Consensus chair's
// re-weighing, the Ready/Not-ready decision, and the 6-part Action Plan.

const READINESS_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "not_ready", label: "Not ready yet" },
];

export function S07Worksheet({
  view,
  activeCanonicalFieldKey,
  onConfirm,
  onEdit,
  busy,
}: {
  view: WorksheetView;
  activeCanonicalFieldKey?: string;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
}) {
  const reducedMotion = Boolean(useReducedMotionPreference());
  const byKey = new Map(view.fields.map((field) => [field.binding.worksheetFieldKey, field]));
  const get = (key: string) => byKey.get(key);
  const isActive = (field?: WorksheetFieldView) => Boolean(field && field.binding.canonicalFieldKey === activeCanonicalFieldKey);

  const readinessRaw = get("implementationReadiness")?.value?.value;
  const readinessLabel = READINESS_OPTIONS.find((option) => option.value === readinessRaw)?.label ?? "—";
  const initialEmotionWeight = get("emotionDisadvantageWeight")?.value?.displayValue;
  const initialReasonWeight = get("reasonAdvantageWeight")?.value?.displayValue;
  const initialWeightSignal = initialEmotionWeight && initialReasonWeight ? `Emotion ${initialEmotionWeight}% / Reason ${initialReasonWeight}%` : "—";
  const consensusAdv = get("consensusAdvantageWeight")?.value?.displayValue;
  const consensusDis = get("consensusDisadvantageWeight")?.value?.displayValue;
  const consensusWeightSignal = consensusAdv && consensusDis ? `Advantages ${consensusAdv}% / Disadvantages ${consensusDis}%` : "—";

  return (
    <div className="space-y-5 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <SessionSignals
        items={[
          { label: "Decision", value: readinessLabel },
          { label: "Initial weight", value: initialWeightSignal },
          { label: "Consensus weight", value: consensusWeightSignal },
          { label: "Action plan", value: capturedStatus(get("proposedActions")) },
        ]}
      />
      <div className="rounded-panel border-2 border-clinical-blue/40 bg-clinical-blue-light/20 p-1">
        <WorksheetCell field={get("desiredOrFearedAction")} q="1" label="The desired / feared action" borderless active={isActive(get("desiredOrFearedAction"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <WorksheetCell field={get("disadvantages")} q="1" label="Disadvantages" list active={isActive(get("disadvantages"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} emphasized />
        <WorksheetCell field={get("advantages")} q="1" label="Advantages" list active={isActive(get("advantages"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>

      <TugOfWar leftLabel="Emotion" rightLabel="Reason" leftField={get("emotionDisadvantageWeight")} rightField={get("reasonAdvantageWeight")} active={isActive(get("emotionDisadvantageWeight")) || isActive(get("reasonAdvantageWeight"))} />

      <EmptyChairDialogue field={get("emotionReasonDialogue")} speakersField={get("emotionReasonSpeakers")} active={isActive(get("emotionReasonDialogue"))} onConfirm={onConfirm} />

      <div className="rounded-panel border border-clinical-blue/30 bg-surface p-3 sm:p-4">
        <div className="mb-2 inline-flex items-center rounded-full bg-clinical-blue px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-white">Consensus chair</div>
        <WorksheetCell field={get("consensusLearning")} q="4" label="What the Consensus chair learned" list borderless active={isActive(get("consensusLearning"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <WorksheetCell field={get("consensusSurprise")} q="4" label="What surprised you" borderless active={isActive(get("consensusSurprise"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <WorksheetCell field={get("consensusEmotionIntent")} q="4" label="What Emotion was trying to do" borderless active={isActive(get("consensusEmotionIntent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <WorksheetCell field={get("consensusPartsNeeds")} q="4" label="What each part needed" borderless active={isActive(get("consensusPartsNeeds"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <div className="mt-3">
          <TugOfWar leftLabel="Advantages" rightLabel="Disadvantages" leftField={get("consensusAdvantageWeight")} rightField={get("consensusDisadvantageWeight")} active={isActive(get("consensusAdvantageWeight")) || isActive(get("consensusDisadvantageWeight"))} compact />
        </div>
      </div>

      <ChoicePills field={get("implementationReadiness")} options={READINESS_OPTIONS} label="Q6 · Decision" active={isActive(get("implementationReadiness"))} />

      <div className="rounded-panel border border-border bg-surface-subtle/60 p-3 sm:p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">Action Plan</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <WorksheetCell field={get("proposedActions")} q="—" label="Proposed actions" list borderless active={isActive(get("proposedActions"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <WorksheetCell field={get("possibleObstacles")} q="—" label="Possible obstacles" list borderless active={isActive(get("possibleObstacles"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <WorksheetCell field={get("obstacleSolutions")} q="—" label="Solutions" list borderless active={isActive(get("obstacleSolutions"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <WorksheetCell field={get("implementationPlan")} q="—" label="When and how" list borderless active={isActive(get("implementationPlan"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <WorksheetCell field={get("supportPeople")} q="—" label="Who can support me" list borderless active={isActive(get("supportPeople"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <WorksheetCell field={get("followUpPlan")} q="—" label="Follow-up" list borderless active={isActive(get("followUpPlan"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
      </div>
    </div>
  );
}

function TugOfWar({ leftLabel, rightLabel, leftField, rightField, active, compact }: { leftLabel: string; rightLabel: string; leftField?: WorksheetFieldView; rightField?: WorksheetFieldView; active: boolean; compact?: boolean }) {
  if (!leftField && !rightField) return null;
  const leftValue = Math.max(0, Math.min(100, Number(leftField?.value?.value) || 0));
  const rightValue = Math.max(0, Math.min(100, Number(rightField?.value?.value) || 0));
  return (
    <div className={`rounded-panel border p-3 transition ${active ? "ring-2 ring-clinical-blue border-clinical-blue" : "border-border bg-surface"}`}>
      {!compact && <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">Which side is heavier?</div>}
      <div className="flex items-center gap-2 text-sm">
        <span className="w-16 shrink-0 text-right font-semibold text-text-primary">{leftLabel}</span>
        <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-surface-subtle">
          <div className="h-full bg-warning" style={{ width: `${leftValue}%`, marginLeft: `${Math.max(0, 50 - leftValue)}%` }} />
        </div>
        <span className="w-10 shrink-0 text-xs font-semibold text-text-primary">{leftField?.value?.displayValue ?? "—"}%</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-sm">
        <span className="w-16 shrink-0 text-right font-semibold text-text-primary">{rightLabel}</span>
        <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-surface-subtle">
          <div className="h-full bg-clinical-blue" style={{ width: `${rightValue}%`, marginLeft: `${Math.max(0, 50 - rightValue)}%` }} />
        </div>
        <span className="w-10 shrink-0 text-xs font-semibold text-text-primary">{rightField?.value?.displayValue ?? "—"}%</span>
      </div>
    </div>
  );
}

function EmptyChairDialogue({ field, speakersField, active, onConfirm }: { field?: WorksheetFieldView; speakersField?: WorksheetFieldView; active: boolean; onConfirm: (worksheetFieldKey: string) => void }) {
  if (!field) return null;
  const lines = Array.isArray(field.value?.value) ? (field.value?.value as unknown[]) : [];
  // Recorded at capture time (runtime-context.ts). Index parity is only the
  // fallback for dialogues captured before speakers were tracked.
  const speakers = Array.isArray(speakersField?.value?.value) ? (speakersField?.value?.value as unknown[]).map(String) : [];
  const filled = lines.length > 0;
  const draftPending = field.value?.status === "draft_extracted";

  return (
    <div className={`rounded-panel border p-3 sm:p-4 transition ${active ? "ring-2 ring-clinical-blue border-clinical-blue" : "border-border bg-surface"} ${!filled ? "border-dashed opacity-70" : ""}`}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">The empty-chair dialogue</div>
      {filled ? (
        <div className="space-y-2">
          {lines.map((line, index) => {
            const fromEmotion = speakers[index] ? speakers[index] === "emotion" : index % 2 === 0;
            return (
              <div key={index} className={`flex ${fromEmotion ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${fromEmotion ? "rounded-tl-sm bg-warning-light text-text-primary" : "rounded-tr-sm bg-clinical-blue-light text-text-primary"}`}>
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-text-muted">{fromEmotion ? "Emotion" : "Reason"}</div>
                  {String(line)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-sm text-text-muted">&hellip;</div>
      )}
      {draftPending && (
        <button type="button" className="mt-2 rounded-panel border border-clinical-blue px-3 py-1 text-xs font-semibold text-clinical-blue" onClick={() => onConfirm(field.definition.worksheetFieldKey)}>
          Confirm
        </button>
      )}
    </div>
  );
}
