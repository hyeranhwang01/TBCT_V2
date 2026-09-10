"use client";

import { ArrowDown, ChoicePills, CycleArrow, FocusLine, SessionSignals, WorksheetCell, capturedStatus, directionalValue } from "@/components/runtime/worksheet-renderers/shared";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Recreates the original TBCT Intra-TR figure (Session 3 manual, Annex):
// a top box-cycle (Situation -> Automatic Thought -> Emotion -> Behavior &
// Body, looping back), the pros/cons/distortion/evidence strip beneath it,
// a conclusion, and a final-check row -- rather than a flat field-status
// list, and rather than a coordinate-mapped photo overlay of the scanned
// figure. This restores the original "recreate the figure in real
// HTML/CSS" approach (see git history d23b913 -> 69b13d3 -> 4de4c2c) so
// S03 is composed the same way as every other session
// (worksheet-renderers/s0N-worksheet.tsx). Every cell is a live projection
// of a canonical runtime field (see worksheet-projection.ts); nothing here
// is decorative-only data.
//
// Not yet represented as boxes (see tbct-s03.ts's binding-registry header
// for why): the original figure's "New emotion(s)" row (11a/11b) needs a
// multi-emotion evaluation_matrix renderer this pass doesn't build yet --
// omitted rather than faked with an always-empty box.

const HOW_AM_I_NOW_OPTIONS = [
  { value: "same", label: "The same" },
  { value: "a little better", label: "A little better" },
  { value: "much better", label: "Much better" },
];

export function S03Worksheet({
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

  const primaryEmotionText = get("primaryEmotion")?.value?.displayValue;
  const primaryEmotionIntensity = get("primaryEmotionIntensityPercent")?.value?.displayValue;
  const primaryEmotionSignal = primaryEmotionText ? (primaryEmotionIntensity ? `${primaryEmotionText} · ${primaryEmotionIntensity}%` : String(primaryEmotionText)) : "—";

  return (
    <div className="space-y-5 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <FocusLine text={get("situation")?.value?.displayValue} />
      <SessionSignals
        items={[
          { label: "Original belief", value: directionalValue(get("automaticThoughtBeliefPercent"), get("revisedAutomaticThoughtBeliefPercent")) },
          { label: "Primary emotion", value: primaryEmotionSignal },
          { label: "Balanced conclusion", value: capturedStatus(get("balancedConclusion")) },
          { label: "Intended actions", value: capturedStatus(get("intendedActions")) },
        ]}
      />

      {/* Top cycle: Situation -> Automatic Thought -> Emotion -> Behavior & Body, looping back */}
      <div className="relative">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-stretch">
          <WorksheetCell field={get("situation")} q="1" active={isActive(get("situation"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <WorksheetCell field={get("automaticThought")} q="2a" gauge={get("automaticThoughtBeliefPercent")} gaugeQ="2b" active={isActive(get("automaticThought")) || isActive(get("automaticThoughtBeliefPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <WorksheetCell field={get("primaryEmotion")} q="3a" gauge={get("primaryEmotionIntensityPercent")} gaugeQ="3b" active={isActive(get("primaryEmotion")) || isActive(get("primaryEmotionIntensityPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <div className="grid gap-2">
            <WorksheetCell field={get("behavior")} q="4a" active={isActive(get("behavior"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} compact />
            <WorksheetCell field={get("bodySensations")} q="4b" active={isActive(get("bodySensations"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} compact />
          </div>
        </div>
        <LoopBackArrow />
      </div>

      {/* Pros / cons, distortion, evidence -- the "turning the thought over" strip */}
      <div className="grid gap-3 sm:grid-cols-2">
        <WorksheetCell field={get("behaviorPros")} q="5" active={isActive(get("behaviorPros"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} tone="neutral" />
        <WorksheetCell field={get("behaviorCons")} q="6" active={isActive(get("behaviorCons"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} tone="neutral" />
      </div>
      <WorksheetCell field={get("cognitiveDistortion")} q="7" active={isActive(get("cognitiveDistortion"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} chip />
      <div className="grid gap-3 sm:grid-cols-2">
        <WorksheetCell field={get("evidenceFor")} q="8" active={isActive(get("evidenceFor"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} list />
        <WorksheetCell field={get("evidenceAgainst")} q="9" active={isActive(get("evidenceAgainst"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} list emphasized />
      </div>

      {/* Conclusion, leading into what's felt/done/noticed now */}
      <div className="rounded-panel border-2 border-clinical-blue/40 bg-clinical-blue-light/20 p-1">
        <WorksheetCell field={get("balancedConclusion")} q="10a" gauge={get("conclusionBeliefPercent")} gaugeQ="10b" active={isActive(get("balancedConclusion")) || isActive(get("conclusionBeliefPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} borderless label="Conclusion" />
      </div>
      <div className="flex items-center justify-center text-text-muted" aria-hidden>
        <ArrowDown reducedMotion={reducedMotion} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <WorksheetCell field={get("intendedActions")} q="12a" active={isActive(get("intendedActions"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} list />
        <WorksheetCell field={get("newBodySensations")} q="12b" active={isActive(get("newBodySensations"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>

      {/* Final check */}
      <div className="grid gap-3 rounded-panel border border-border bg-surface p-4 sm:grid-cols-2">
        <WorksheetCell field={get("revisedAutomaticThoughtBeliefPercent")} q="13" active={isActive(get("revisedAutomaticThoughtBeliefPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} borderless label="Belief in the original thought now" />
        <ChoicePills field={get("globalEvaluation")} options={HOW_AM_I_NOW_OPTIONS} label="Q14 · How am I now?" active={isActive(get("globalEvaluation"))} />
      </div>

      <div className="rounded-panel border-2 border-clinical-blue/40 bg-clinical-blue-light/20 p-1">
        <WorksheetCell field={get("participantSummary")} q="4" label="My summary" borderless active={isActive(get("participantSummary"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>
    </div>
  );
}

function LoopBackArrow() {
  // Decorative echo of the original figure's dashed "loops back" arrow
  // running from Behavior & Body back to Situation. Static/CSS-only --
  // doesn't need per-box coordinates since it's illustrative, not data-bound.
  return (
    <div className="mt-1 hidden items-center gap-2 text-[11px] text-text-muted sm:flex" aria-hidden>
      <span className="h-px flex-1 border-t border-dashed border-clinical-blue/30" />
      <span>the pattern loops back and feeds itself again</span>
      <span className="h-px flex-1 border-t border-dashed border-clinical-blue/30" />
    </div>
  );
}
