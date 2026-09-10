"use client";

import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import { CycleArrow, FocusLine, SessionSignals, WorksheetCell, capturedStatus, listCount } from "@/components/runtime/worksheet-renderers/shared";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Recreates the TBCT Session 1 "Conceptualization Diagram" (three-person
// teaching example): the participant's own situation and initial thought
// (captured in Opening, before the example), then one shared Situation
// feeding three parallel Thought -> Emotion -> Behavior branches (people
// 1-3), then the participant's own Emotion/Behavior/Body -- reusing the
// same situation+thought already captured above rather than a separate
// discrete quad. See tbct-s01.ts's header for the full field mapping.
//
// Labels say "Person N" (not "Candidate N") to match the dialogue's own
// wording; the underlying field names (candidateOneEmotion, etc.) are
// unchanged -- see .claude/TASK_SCOPE.json's note2026_08_17b entry.

const CANDIDATES = [
  { n: "1", tone: "Person 1", thought: "candidateOneThought", emotion: "candidateOneEmotion", behavior: "candidateOneBehavior" },
  { n: "2", tone: "Person 2", thought: "candidateTwoThought", emotion: "candidateTwoEmotion", behavior: "candidateTwoBehavior" },
  { n: "3", tone: "Person 3", thought: "candidateThreeThought", emotion: "candidateThreeEmotion", behavior: "candidateThreeBehavior" },
] as const;

export function S01Worksheet({
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
  const isFilled = (field?: WorksheetFieldView) => field?.value?.value !== undefined && field?.value?.value !== null && field?.value?.value !== "";

  // S01 has no belief/emotion-intensity percent fields at all (see
  // tbct-s01.ts) -- its signals are structural completion counts instead of
  // ratings, sourced only from fields already bound above.
  const candidatesComplete = CANDIDATES.filter((c) => isFilled(get(c.thought)) && isFilled(get(c.emotion)) && isFilled(get(c.behavior))).length;
  const personalComplete = [get("personalEmotion"), get("personalBehavior"), get("personalBodySensations")].filter(isFilled).length;

  return (
    <div className="space-y-5 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <FocusLine text={get("situationThoughtDistinction")?.value?.displayValue} />
      <SessionSignals
        items={[
          { label: "People explored", value: `${candidatesComplete} of 3` },
          { label: "My own emotion/behavior/body", value: `${personalComplete} of 3` },
          { label: "Summary", value: capturedStatus(get("participantSummary")) },
          { label: "Distortions recognized", value: listCount(get("participantSelectedDistortions")) },
        ]}
      />

      {/* Situation and the first, uncertainty-tolerant look at the thought,
          both captured in Opening before the three-person example */}
      <WorksheetCell field={get("situationThoughtDistinction")} q="1" active={isActive(get("situationThoughtDistinction"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} label="My situation" />
      <WorksheetCell field={get("openingInitialThought")} q="1" active={isActive(get("openingInitialThought"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} label="My first thought about it" />

      <div className="space-y-3">
        {CANDIDATES.map((candidate) => (
          <div key={candidate.n} className="rounded-panel border border-border/70 bg-surface/60 p-2 sm:p-3">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-clinical-blue/30 bg-clinical-blue-light/30 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-clinical-blue">
              {candidate.tone}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch">
              <WorksheetCell field={get(candidate.thought)} q="2" label="Thought" compact active={isActive(get(candidate.thought))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
              <CycleArrow reducedMotion={reducedMotion} />
              <WorksheetCell field={get(candidate.emotion)} q="2" label="Emotion" compact active={isActive(get(candidate.emotion))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
              <CycleArrow reducedMotion={reducedMotion} />
              <WorksheetCell field={get(candidate.behavior)} q="2" label="Behavior" compact active={isActive(get(candidate.behavior))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
            </div>
          </div>
        ))}
      </div>

      <WorksheetCell field={get("threePersonModelInsight")} q="2" label="What the three-person example showed me" active={isActive(get("threePersonModelInsight"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />

      {/* Personal cycle -- same situation+thought as above, now the
          participant's own emotion/behavior/body */}
      <div className="rounded-panel border border-dashed border-clinical-blue/40 p-3 sm:p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">My own experience</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <WorksheetCell field={get("personalEmotion")} q="3" label="Emotion" compact active={isActive(get("personalEmotion"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <WorksheetCell field={get("personalBehavior")} q="3" label="Behavior" compact active={isActive(get("personalBehavior"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
          <CycleArrow reducedMotion={reducedMotion} />
          <WorksheetCell field={get("personalBodySensations")} q="3" label="Body" compact active={isActive(get("personalBodySensations"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
      </div>

      <div className="rounded-panel border-2 border-clinical-blue/40 bg-clinical-blue-light/20 p-1">
        <WorksheetCell field={get("participantSummary")} q="4" label="My summary" borderless active={isActive(get("participantSummary"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>

      <WorksheetCell field={get("participantSelectedDistortions")} q="5" label="Distortions I recognized" list active={isActive(get("participantSelectedDistortions"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
    </div>
  );
}
