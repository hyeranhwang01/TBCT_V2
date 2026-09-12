"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";
import { WorksheetCell } from "@/patient/components/worksheet-renderers/shared";
import { DistortionTable } from "@/patient/sessions/s01/distortion-table";
import { CcdLevel1Diagram, Placeholder, S01Box, fieldText, scrollWithinPanel } from "@/patient/sessions/s01/worksheet-diagram";
import { S01_LABELS, s01Locale } from "@/patient/sessions/s01/worksheet-labels";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Session 1 worksheets, rebuilt to match the two paper worksheets filled
// together with the participant in the real first session
// (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign):
//   1. problems and goals, then "my cognitive model" -- the TBCT
//      Conceptualization Diagram Phase 1 Level 1 for the participant's own
//      moment (worksheet-diagram.tsx);
//   2. the three-person example -- Level 1 repeated three times for one
//      shared scene;
// followed by the participant's summary, the distortions they picked, and
// (from the distortions step on) the read-only list of 15 distortions.
//
// The participant sees this read-only beside the chat (readOnly, in their
// session locale). The clinician view keeps a review/edit list for every
// participant-owned field underneath, as the previous S01 worksheet did.
// Labels say "Person N"; the field names (candidateOneEmotion, ...) are
// unchanged -- see note2026_08_17b.

const PROBLEM_KEYS = ["s01Problems", "s01ProblemExample", "s01RepresentativeProblem", "s01Goal", "s01GoalBenefit"];

const PERSONS = [
  { n: 1, thought: "candidateOneThought", emotion: "candidateOneEmotion", behavior: "candidateOneBehavior", body: "candidateOneBodySensations", givenEmotion: false },
  { n: 2, thought: "candidateTwoThought", emotion: "candidateTwoEmotion", behavior: "candidateTwoBehavior", body: "candidateTwoBodySensations", givenEmotion: true },
  { n: 3, thought: "candidateThreeThought", emotion: "candidateThreeEmotion", behavior: "candidateThreeBehavior", body: "candidateThreeBodySensations", givenEmotion: true },
] as const;

// Active prompts (outputFields[0]) of the steps that send the participant to
// the list -- the drawer opens itself on these.
const DISTORTION_LIST_FOCUS_KEYS = ["distortionListPresented", "distortionListRead", "participantSelectedDistortions"];

function isFilled(field?: WorksheetFieldView): boolean {
  const value = field?.value?.value;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

function listValue(field?: WorksheetFieldView): string[] {
  const value = field?.value?.value;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = fieldText(field);
  return text ? [text] : [];
}

function SectionTitle({ n, children }: { n: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-clinical-blue-light/50 text-xs text-clinical-blue">{n}</span>
      {children}
    </div>
  );
}

function Row({ label, value, tag, empty }: { label: string; value?: string; tag?: string; empty: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2">
      <span className="text-xs font-semibold text-text-muted">{label}</span>
      <span className="min-w-0 font-serif">
        {value ?? <Placeholder text={empty} />}
        {value && tag && <span className="ml-1.5 rounded-full border border-border px-1.5 py-px align-middle font-sans text-[10px] text-text-muted">{tag}</span>}
      </span>
    </div>
  );
}

/** The 15 distortions live at the bottom of the panel as a closed drawer:
 * the participant can open them at any time, and the distortions step opens
 * them automatically. Kept closed by default so the two worksheets above
 * stay visible without scrolling past fifteen entries. The same list is the
 * homework sheet, which only exists after the session completes -- hence the
 * note rather than a link. */
function DistortionReference({ title, note, locale, focused, reducedMotion, autoScroll }: { title: string; note: string; locale?: string; focused: boolean; reducedMotion: boolean; autoScroll: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(focused);
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    if (autoScroll && ref.current) scrollWithinPanel(ref.current, reducedMotion);
  }, [focused, autoScroll, reducedMotion]);
  return (
    <details
      ref={ref}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-testid="s01-distortion-drawer"
      className={`rounded-panel border p-3 ${focused ? "border-clinical-blue ring-2 ring-clinical-blue" : "border-border"}`}
      aria-current={focused ? "step" : undefined}
    >
      <summary className="cursor-pointer text-sm font-semibold text-text-primary">{title}</summary>
      <DistortionTable locale={locale} />
      <p className="mt-2 text-xs text-text-muted">{note}</p>
    </details>
  );
}

export function S01Worksheet({
  view,
  activeCanonicalFieldKey,
  onConfirm,
  onEdit,
  busy,
  locale,
  readOnly,
}: {
  view: WorksheetView;
  activeCanonicalFieldKey?: string;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
  locale?: string;
  readOnly?: boolean;
}) {
  const reducedMotion = Boolean(useReducedMotionPreference());
  const labels = S01_LABELS[s01Locale(locale)];
  const byKey = new Map(view.fields.map((field) => [field.binding.worksheetFieldKey, field]));
  const get = (key: string) => byKey.get(key);
  const isActive = (keys: readonly string[]) => Boolean(activeCanonicalFieldKey && keys.includes(activeCanonicalFieldKey));
  // Only the participant's panel follows the conversation; the clinician
  // scrolls on their own.
  const autoScroll = Boolean(readOnly);
  const box = { reducedMotion, autoScroll };

  const problems = listValue(get("s01Problems"));
  const representative = fieldText(get("s01RepresentativeProblem"));
  const goal = fieldText(get("s01Goal"));
  const goalBenefit = fieldText(get("s01GoalBenefit"));
  const scene = fieldText(get("threePersonScene"));
  const summary = fieldText(get("participantSummary"));
  const chosen = listValue(get("participantSelectedDistortions"));
  const editable = readOnly ? [] : [...view.fields].filter((field) => field.binding.participantOwned).sort((a, b) => a.binding.displayOrder - b.binding.displayOrder);

  return (
    <div className="space-y-5" data-testid="s01-worksheet">
      <section className="space-y-2">
        <SectionTitle n="1">{labels.problemsTitle}</SectionTitle>
        <S01Box title={labels.problems} active={isActive(PROBLEM_KEYS)} filled={problems.length > 0} {...box}>
          {problems.length ? (
            <ol className="list-decimal space-y-0.5 pl-5 font-serif">
              {problems.map((problem, index) => <li key={index}>{problem}</li>)}
            </ol>
          ) : <Placeholder text={labels.empty} />}
          {representative && <Row label={labels.representative} value={representative} empty={labels.empty} />}
          {goal && <Row label={labels.goal} value={goal} empty={labels.empty} />}
          {goalBenefit && <Row label={labels.goalBenefit} value={goalBenefit} empty={labels.empty} />}
        </S01Box>
      </section>

      <section className="space-y-2">
        <SectionTitle n="2">{labels.ccdTitle}</SectionTitle>
        <CcdLevel1Diagram get={get} isActive={isActive} labels={labels} {...box} />
      </section>

      <section className="space-y-2">
        <SectionTitle n="3">{labels.threeTitle}</SectionTitle>
        <S01Box title={labels.scene} active={false} filled={Boolean(scene)} {...box}>
          <div className="font-serif">{scene ?? <Placeholder text={labels.empty} />}</div>
        </S01Box>
        <div className="space-y-2">
          {PERSONS.map((person) => {
            const emotion = fieldText(get(person.emotion));
            const own = [person.thought, person.behavior, person.body, ...(person.givenEmotion ? [] : [person.emotion])];
            return (
              <S01Box key={person.n} title={labels.person(person.n)} active={isActive([person.thought, person.emotion, person.behavior, person.body])} filled={own.some((key) => isFilled(get(key)))} {...box}>
                <Row label={labels.thought} value={fieldText(get(person.thought))} empty={labels.empty} />
                <Row label={labels.feeling} value={emotion} tag={person.givenEmotion ? labels.given : undefined} empty={labels.empty} />
                <Row label={labels.behavior} value={fieldText(get(person.behavior))} empty={labels.empty} />
                <Row label={labels.body} value={fieldText(get(person.body))} empty={labels.empty} />
              </S01Box>
            );
          })}
        </div>
        <S01Box title={labels.insight} active={isActive(["threePersonModelInsight"])} filled={isFilled(get("threePersonModelInsight"))} {...box}>
          <div className="font-serif">{fieldText(get("threePersonModelInsight")) ?? <Placeholder text={labels.empty} />}</div>
        </S01Box>
      </section>

      <section className="space-y-2">
        <SectionTitle n="4">{labels.summary}</SectionTitle>
        <S01Box title={labels.summary} active={isActive(["participantSummary"])} filled={Boolean(summary)} {...box}>
          <div className="font-serif">{summary ?? <Placeholder text={labels.empty} />}</div>
        </S01Box>
        <S01Box title={labels.distortionsChosen} active={isActive(["participantSelectedDistortions"])} filled={chosen.length > 0} {...box}>
          {chosen.length ? (
            <div className="flex flex-wrap gap-1.5">
              {chosen.map((item, index) => <span key={index} className="rounded-full border border-clinical-blue/40 bg-clinical-blue-light/30 px-2 py-0.5 text-xs font-semibold text-clinical-blue">{item}</span>)}
            </div>
          ) : <Placeholder text={labels.empty} />}
        </S01Box>
      </section>

      <DistortionReference title={labels.distortionListTitle} note={labels.distortionListHomeworkNote} locale={locale} focused={isActive(DISTORTION_LIST_FOCUS_KEYS)} {...box} />

      {editable.length > 0 && (
        <details className="rounded-panel border border-border bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold text-text-primary">{labels.reviewTitle}</summary>
          <div className="mt-3 space-y-2">
            {editable.map((field) => (
              <WorksheetCell key={field.definition.id} field={field} q={String(field.binding.displayOrder + 1)} label={field.binding.label} list={field.binding.valueType === "text_list"} active={field.binding.canonicalFieldKey === activeCanonicalFieldKey} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
