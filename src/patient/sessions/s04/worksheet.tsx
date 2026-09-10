"use client";

import { ArrowDown, ChoicePills, CycleArrow, FocusLine, SessionSignals, WorksheetCell, capturedStatus, directionalValue } from "@/components/runtime/worksheet-renderers/shared";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Recreates the TBCT Session 4 Interpersonal Thought Record (Inter-TR,
// Fig. A7): "Me" half (Situation -> Thought(%) -> Emotion(%) -> Behavior &
// Body) sits above "The other person" half (their likely Thought ->
// Emotion -> Behavior), joined by a feedback arrow -- then the leverage
// point, a final check, and the lettered Action Plan.

const FINAL_EVALUATION_OPTIONS = [
  { value: "same", label: "The same" },
  { value: "a little better", label: "A little better" },
  { value: "much better", label: "Much better" },
];

export function S04Worksheet({
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

  const myEmotionText = get("patientEmotion")?.value?.displayValue;
  const myEmotionIntensity = get("patientEmotionIntensityPercent")?.value?.displayValue;
  const myEmotionSignal = myEmotionText ? (myEmotionIntensity ? `${myEmotionText} · ${myEmotionIntensity}%` : String(myEmotionText)) : "—";

  return (
    <div className="space-y-5 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <FocusLine text={get("interpersonalSituation")?.value?.displayValue} />
      <SessionSignals
        items={[
          { label: "My initial belief", value: directionalValue(get("patientAutomaticThoughtBeliefPercent"), get("revisedPatientAutomaticThoughtBeliefPercent")) },
          { label: "My emotion", value: myEmotionSignal },
          { label: "Leverage point", value: capturedStatus(get("locusOfControlRecognition")) },
          { label: "Action plan", value: capturedStatus(get("plannedActions")) },
        ]}
      />

      <div className="rounded-panel border border-clinical-blue/30 bg-clinical-blue-light/10 p-2 sm:p-3">
        <div className="mb-2 inline-flex items-center rounded-full bg-clinical-blue px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-white">Me</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <WorksheetCell field={get("interpersonalSituation")} q="1" label="Situation" active={isActive(get("interpersonalSituation"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <WorksheetCell field={get("patientAutomaticThought")} q="2a" gauge={get("patientAutomaticThoughtBeliefPercent")} gaugeQ="2b" label="My thought" active={isActive(get("patientAutomaticThought")) || isActive(get("patientAutomaticThoughtBeliefPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <WorksheetCell field={get("patientEmotion")} q="3a" gauge={get("patientEmotionIntensityPercent")} gaugeQ="3b" label="My emotion" active={isActive(get("patientEmotion")) || isActive(get("patientEmotionIntensityPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <WorksheetCell field={get("patientBehavior")} q="4a" label="My behavior" compact active={isActive(get("patientBehavior"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <WorksheetCell field={get("patientBodySensations")} q="4b" label="In my body" compact active={isActive(get("patientBodySensations"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 text-text-muted" aria-hidden>
        <ArrowDown reducedMotion={reducedMotion} />
        <span className="text-[11px] italic">what I imagine is happening for them</span>
        <ArrowDown reducedMotion={reducedMotion} />
      </div>

      <div className="rounded-panel border border-border bg-surface p-2 sm:p-3">
        <div className="mb-2 inline-flex items-center rounded-full bg-text-secondary px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-white">The other person</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <WorksheetCell field={get("otherPersonLikelyThought")} q="5" label="Their likely thought" compact inferred active={isActive(get("otherPersonLikelyThought"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <WorksheetCell field={get("otherPersonLikelyEmotion")} q="6" label="Their likely emotion" compact inferred active={isActive(get("otherPersonLikelyEmotion"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <WorksheetCell field={get("otherPersonLikelyBehavior")} q="7" label="Their likely behavior" compact inferred active={isActive(get("otherPersonLikelyBehavior"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
      </div>

      <div className="rounded-panel border-2 border-clinical-blue/40 bg-clinical-blue-light/20 p-1">
        <WorksheetCell field={get("locusOfControlRecognition")} q="—" label="The part I can change" borderless active={isActive(get("locusOfControlRecognition"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>

      <div className="grid gap-3 rounded-panel border border-border bg-surface p-4 sm:grid-cols-2">
        <WorksheetCell field={get("revisedPatientAutomaticThoughtBeliefPercent")} q="8" label="Belief in my thought now" borderless active={isActive(get("revisedPatientAutomaticThoughtBeliefPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <ChoicePills field={get("finalEvaluation")} options={FINAL_EVALUATION_OPTIONS} label="Q9 · How I'm feeling now" active={isActive(get("finalEvaluation"))} />
      </div>

      <div className="rounded-panel border border-border bg-surface-subtle/60 p-3 sm:p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">Action Plan</div>
        <div className="space-y-2">
          <LetteredRow letter="a" field={get("plannedActions")} label="Proposed actions" active={isActive(get("plannedActions"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <LetteredRow letter="b" field={get("actionObstacles")} label="Possible obstacles" active={isActive(get("actionObstacles"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <LetteredRow letter="c" field={get("obstacleSolutions")} label="Solutions" active={isActive(get("obstacleSolutions"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <LetteredRow letter="d" field={get("implementationTiming")} label="When" active={isActive(get("implementationTiming"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
      </div>
    </div>
  );
}

function LetteredRow({
  letter,
  field,
  label,
  active,
  onConfirm,
  onEdit,
  busy,
  reducedMotion,
}: {
  letter: string;
  field?: WorksheetFieldView;
  label: string;
  active: boolean;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div className="flex gap-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-text-muted">{letter}</div>
      <div className="flex-1">
        <WorksheetCell field={field} q="—" label={label} list borderless active={active} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>
    </div>
  );
}
