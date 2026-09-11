"use client";

// Visual-QA preview for the TBCT Session 1 (two worksheets from the real
// first session), Session 2 (CCPH/CCGH 0-5 color scale) and Session 3
// (Intra-TR figure) worksheets. Renders the real, unmodified
// S01Worksheet/S02Worksheet/S03Worksheet components against local mock data
// instead of a live runtime session -- so this page needs no
// Postgres/Supabase-backed session to view, only `npm run dev`. It is purely
// additive: it imports existing components/bindings and never touches
// session runtime logic, worksheet-binding registries, or any other
// session's code.
//
// Not linked from the app's own navigation/router (src/app/studio-app.tsx) --
// visit directly at /preview/worksheets.

import { useEffect, useState } from "react";
import { S01Worksheet } from "@/patient/sessions/s01/worksheet";
import { DistortionHomeworkTable, type DistortionExample } from "@/patient/sessions/s01/distortion-table";
import { S02Worksheet } from "@/patient/sessions/s02/worksheet";
import { S03Worksheet } from "@/patient/sessions/s03/worksheet";
import { ScoreChip } from "@/patient/components/worksheet-renderers/shared";
import { TBCT_S01_BINDINGS } from "@/patient/sessions/s01/worksheet-binding";
import { TBCT_S02_BINDINGS } from "@/patient/sessions/s02/worksheet-binding";
import { TBCT_S03_BINDINGS } from "@/patient/sessions/s03/worksheet-binding";
import type { WorksheetBinding, WorksheetFieldStatus, WorksheetFieldView, WorksheetView } from "@/types/worksheet";

function makeField(binding: WorksheetBinding, value: unknown, status: WorksheetFieldStatus = "participant_confirmed"): WorksheetFieldView {
  const displayValue = Array.isArray(value) ? value.map(String).join(", ") : value === undefined || value === null ? undefined : String(value);
  return {
    definition: {
      id: `preview-${binding.worksheetFieldKey}`,
      templateVersionId: "preview",
      canonicalFieldKey: binding.canonicalFieldKey,
      worksheetFieldKey: binding.worksheetFieldKey,
      valueType: binding.valueType,
      participantOwned: binding.participantOwned,
      assistantMustNotSupply: binding.assistantMustNotSupply,
      confirmationRequired: binding.confirmationRequired,
      visualElementId: binding.visualElementId,
      displayOrder: binding.displayOrder,
      sourceSection: binding.sourceSection,
    },
    binding,
    value: {
      id: `preview-value-${binding.worksheetFieldKey}`,
      instanceId: "preview-instance",
      fieldDefinitionId: `preview-${binding.worksheetFieldKey}`,
      status,
      provenance: "participant_verbatim",
      value,
      displayValue,
      updatedAt: new Date().toISOString(),
    },
  };
}

function bindingByKey(bindings: WorksheetBinding[], worksheetFieldKey: string): WorksheetBinding {
  const binding = bindings.find((entry) => entry.worksheetFieldKey === worksheetFieldKey);
  if (!binding) throw new Error(`No preview binding for ${worksheetFieldKey}`);
  return binding;
}

function makeView(bindings: WorksheetBinding[], values: Record<string, unknown>, statuses: Record<string, WorksheetFieldStatus> = {}): WorksheetView {
  return {
    instance: { id: "preview-instance", runtimeSessionId: "preview-session", templateVersionId: "preview", status: "in_progress", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    templateVersion: { id: "preview", templateId: "preview", version: 1, sourceTextHash: "preview", status: "published", createdAt: new Date().toISOString() },
    fields: Object.entries(values).map(([worksheetFieldKey, value]) => makeField(bindingByKey(bindings, worksheetFieldKey), value, statuses[worksheetFieldKey])),
  };
}

// S01 mock answers, in session order. "mid" stops at the returning arrows;
// "done" runs to the distortions step.
const S01_SAMPLE: Record<"ko" | "en", Array<[string, unknown]>> = {
  ko: [
    ["s01Problems", ["불안이 심해요", "계획대로 안 되면 견디기 힘들어요", "사람들 의견이 다르면 위축돼요"]],
    ["s01RepresentativeProblem", "불안이 심해요"],
    ["s01Goal", "불안해도 할 일을 해내는 것"],
    ["s01GoalBenefit", "하고 싶은 일을 미루지 않을 것 같아요"],
    ["situationThoughtDistinction", "팀 회의에서 팀원이 제 의견에 반대하면서 다른 방향으로 가자고 했는데, 그 뒤로 계속 그 장면이 떠올랐어요"],
    ["situationLine", "팀원이 회의에서 내 의견에 반대했을 때"],
    ["personalEmotion", "배신감"],
    ["personalEmotionIntensity", 50],
    ["personalSecondEmotion", "공포감"],
    ["personalSecondEmotionIntensity", 45],
    ["openingInitialThought", "나를 무시하는 거야"],
    ["s01ThoughtBeliefPercent", 75],
    ["personalBehavior", "혼자 울었어요"],
    ["personalSecondBehavior", "나를 자책했어요"],
    ["personalBodySensations", "손이 떨렸어요"],
    ["friendThought", "그냥 의견이 다를 수 있지"],
    ["cycleAfterBehaviorEmotion", "더 불안해졌어요"],
    ["cycleReinforcedThought", "역시 나는 무시당하는 사람이야"],
    ["cycleSafetyStrategy", "회의에서 말을 아껴요"],
    ["cycleProblemLink", "불안이 더 커져요"],
    ["cycleShortLongTermEffect", "당장은 편한데 길게 보면 더 위축돼요"],
    ["threePersonScene", "상담자가 처음 만난 세 사람에게 헤어질 때 똑같이 말합니다. “만나서 반가웠어요. 좋으신 분 같아요. 다음 주에 뵙겠습니다.”"],
    ["candidateTwoEmotion", "의심"],
    ["candidateThreeEmotion", "화"],
    ["candidateOneEmotion", "기쁨"],
    ["candidateOneThought", "좋게 봐주셨구나"],
    ["candidateOneBehavior", "웃으면서 인사한다"],
    ["candidateOneBodySensations", "어깨가 가벼워진다"],
    ["candidateTwoThought", "빈말이겠지"],
    ["candidateTwoBehavior", "고개만 끄덕인다"],
    ["candidateTwoBodySensations", "표정이 굳는다"],
    ["candidateThreeThought", "나를 쉽게 보나?"],
    ["candidateThreeBehavior", "대꾸 없이 나간다"],
    ["candidateThreeBodySensations", "얼굴이 달아오른다"],
    ["threePersonModelInsight", "같은 말을 들어도 어떻게 생각하느냐에 따라 감정이 달라져요"],
    ["ownCaseActualOutcome", "다음 회의에서 그 팀원이 먼저 말을 걸어 줬어요"],
    ["participantSummary", "상황보다 내가 어떻게 생각했는지가 감정을 만들었어요"],
    ["participantSelectedDistortions", ["감정적 추론", "미래예측 / 파국화"]],
  ],
  en: [
    ["s01Problems", ["I get very anxious", "I can't stand it when plans change", "I shrink back when people disagree"]],
    ["s01RepresentativeProblem", "I get very anxious"],
    ["s01Goal", "Getting things done even when I'm anxious"],
    ["s01GoalBenefit", "I'd stop putting off what I want to do"],
    ["situationThoughtDistinction", "In a team meeting a teammate disagreed with my idea and pushed another direction, and I kept replaying it afterwards"],
    ["situationLine", "A teammate disagreed with me in a meeting"],
    ["personalEmotion", "betrayed"],
    ["personalEmotionIntensity", 50],
    ["personalSecondEmotion", "scared"],
    ["personalSecondEmotionIntensity", 45],
    ["openingInitialThought", "They're dismissing me"],
    ["s01ThoughtBeliefPercent", 75],
    ["personalBehavior", "I cried alone"],
    ["personalSecondBehavior", "I blamed myself"],
    ["personalBodySensations", "My hands shook"],
    ["friendThought", "People just disagree sometimes"],
    ["cycleAfterBehaviorEmotion", "More anxious"],
    ["cycleReinforcedThought", "People really do dismiss me"],
    ["cycleSafetyStrategy", "I keep quiet in meetings"],
    ["cycleProblemLink", "The anxiety grows"],
    ["cycleShortLongTermEffect", "Easier now, smaller over time"],
    ["threePersonScene", "A counselor says the same thing to three people they have just met: \"It was nice to meet you. You seem like a good person. See you next week.\""],
    ["candidateTwoEmotion", "suspicion"],
    ["candidateThreeEmotion", "anger"],
    ["candidateOneEmotion", "happy"],
    ["candidateOneThought", "They liked me"],
    ["candidateOneBehavior", "Smiles and says goodbye"],
    ["candidateOneBodySensations", "Shoulders relax"],
    ["candidateTwoThought", "They say that to everyone"],
    ["candidateTwoBehavior", "Just nods"],
    ["candidateTwoBodySensations", "Face goes still"],
    ["candidateThreeThought", "Are they talking down to me?"],
    ["candidateThreeBehavior", "Leaves without a word"],
    ["candidateThreeBodySensations", "Face gets hot"],
    ["threePersonModelInsight", "The same words felt different depending on what each person thought"],
    ["ownCaseActualOutcome", "At the next meeting the teammate talked to me first"],
    ["participantSummary", "It was what I thought about the situation that made me feel that way"],
    ["participantSelectedDistortions", ["Emotional reasoning", "Fortune telling"]],
  ],
};

type S01Stage = "empty" | "mid" | "done";
const S01_STAGE_END: Record<S01Stage, string | null> = { empty: null, mid: "cycleReinforcedThought", done: "participantSelectedDistortions" };
const S01_STAGE_ACTIVE: Record<S01Stage, string> = { empty: "s01Problems", mid: "cycleSafetyStrategy", done: "distortionListRead" };

function s01View(locale: "ko" | "en", stage: S01Stage): WorksheetView {
  const end = S01_STAGE_END[stage];
  const entries = S01_SAMPLE[locale];
  const cut = end ? entries.findIndex(([key]) => key === end) + 1 : 0;
  return makeView(TBCT_S01_BINDINGS, Object.fromEntries(entries.slice(0, cut)), {});
}

const initialS02View = makeView(TBCT_S02_BINDINGS, {
  problems: ["집중이 안 돼요", "잠을 잘 못 자요", "사람들과 있으면 불안해요", "매사에 의욕이 없어요", "작은 일에도 화가 나요", "혼자 있으면 우울해요"],
  problemRatings: [0, 1, 2, 3, 4, 5],
  totalProblemScore: 15,
  goals: ["숙면 취하기", "사람들과 편하게 지내기", "집중력 회복하기", "화내지 않고 대화하기", "외출을 편하게 하기", "활력 되찾기"],
  goalRatings: [0, 1, 2, 3, 4, 5],
  totalGoalsScore: 15,
});

const initialS03View = makeView(TBCT_S03_BINDINGS, {
  situation: "친구가 문자에 답장을 하지 않았다",
  automaticThought: "내가 뭔가 잘못한 게 틀림없어",
  automaticThoughtBeliefPercent: 80,
  primaryEmotion: "불안",
  primaryEmotionIntensityPercent: 70,
  behavior: "문자를 여러 번 다시 확인했다",
  bodySensations: "가슴이 답답했다",
  participantSummary: "친구 문자에 답이 없어서 불안했고, 내가 뭔가 잘못했다고 생각했다.",
  behaviorPros: "빨리 확인해서 안심하고 싶었다",
  behaviorCons: "계속 확인하느라 다른 일에 집중하지 못했다",
  cognitiveDistortion: "성급한 결론 (마음 읽기)",
  evidenceFor: ["예전에도 답장이 늦은 적 있었다"],
  evidenceAgainst: ["친구가 바쁘다고 미리 말했었다", "평소에는 늘 답장을 잘 해줬다"],
  balancedConclusion: "친구가 바빠서 답장이 늦어지는 것일 수도 있다. 내 잘못이라고 단정할 근거는 부족하다.",
  conclusionBeliefPercent: 75,
  intendedActions: ["조금 더 기다려보기", "필요하면 먼저 안부 문자 보내기"],
  newBodySensations: "가슴 답답함이 줄어들었다",
  revisedAutomaticThoughtBeliefPercent: 30,
  globalEvaluation: "a little better",
});

function updateField(view: WorksheetView, worksheetFieldKey: string, patch: Partial<NonNullable<WorksheetFieldView["value"]>>): WorksheetView {
  return {
    ...view,
    fields: view.fields.map((field) =>
      field.binding.worksheetFieldKey === worksheetFieldKey && field.value
        ? { ...field, value: { ...field.value, ...patch } }
        : field,
    ),
  };
}

function ScaleLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-panel border border-border bg-surface p-3 text-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">0-5 Color Scale</span>
      {[0, 1, 2, 3, 4, 5].map((score) => (
        <span key={score} className="inline-flex items-center gap-1.5">
          <ScoreChip score={score} />
        </span>
      ))}
    </div>
  );
}

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (next: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-panel border border-border text-xs">
      {options.map(([key, label]) => (
        <button key={key} type="button" onClick={() => onChange(key)} className={`px-2.5 py-1 ${value === key ? "bg-clinical-blue text-white" : "bg-surface text-text-secondary"}`}>{label}</button>
      ))}
    </div>
  );
}

export default function WorksheetPreviewPage() {
  const [s01Locale, setS01Locale] = useState<"ko" | "en">("ko");
  const [s01Stage, setS01Stage] = useState<S01Stage>("mid");
  const [s01Mode, setS01Mode] = useState<"patient" | "clinician">("patient");
  const [s01Edits, setS01Edits] = useState<WorksheetView | null>(null);
  const [homeworkEntries, setHomeworkEntries] = useState<DistortionExample[]>([
    { id: "preview-1", distortionId: "emotional-reasoning", date: "2026-09-13", text: "불안하니까 발표가 잘못될 게 분명해" },
  ]);
  const [s02View, setS02View] = useState(initialS02View);
  const [s03View, setS03View] = useState(initialS03View);
  const busy = false;

  // ?s01=empty|mid|done&lang=ko|en&mode=patient|clinician opens a state
  // directly (handy for screenshots).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stage = params.get("s01");
    const lang = params.get("lang");
    const mode = params.get("mode");
    if (stage === "empty" || stage === "mid" || stage === "done") setS01Stage(stage);
    if (lang === "ko" || lang === "en") setS01Locale(lang);
    if (mode === "patient" || mode === "clinician") setS01Mode(mode);
  }, []);

  const baseS01View = s01View(s01Locale, s01Stage);
  const currentS01View = s01Edits ?? baseS01View;
  const resetS01 = <T,>(setter: (next: T) => void) => (next: T) => { setter(next); setS01Edits(null); };
  const editS01 = (worksheetFieldKey: string, value: unknown) =>
    setS01Edits(updateField(currentS01View, worksheetFieldKey, { value, displayValue: Array.isArray(value) ? value.map(String).join(", ") : String(value), status: "participant_edited" }));
  const confirmS01 = (worksheetFieldKey: string) => setS01Edits(updateField(currentS01View, worksheetFieldKey, { status: "participant_confirmed", confirmedAt: new Date().toISOString() }));
  const editS02 = (worksheetFieldKey: string, value: unknown) =>
    setS02View((view) => updateField(view, worksheetFieldKey, { value, displayValue: Array.isArray(value) ? value.map(String).join(", ") : String(value), status: "participant_edited" }));
  const confirmS02 = (worksheetFieldKey: string) => setS02View((view) => updateField(view, worksheetFieldKey, { status: "participant_confirmed", confirmedAt: new Date().toISOString() }));
  const editS03 = (worksheetFieldKey: string, value: unknown) =>
    setS03View((view) => updateField(view, worksheetFieldKey, { value, displayValue: Array.isArray(value) ? value.map(String).join(", ") : String(value), status: "participant_edited" }));
  const confirmS03 = (worksheetFieldKey: string) => setS03View((view) => updateField(view, worksheetFieldKey, { status: "participant_confirmed", confirmedAt: new Date().toISOString() }));

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-text-primary">Session 1, 2 &amp; 3 Worksheet Visual Preview</h1>
        <p className="text-sm text-text-muted">
          Mock-data preview of the real S01Worksheet / S02Worksheet / S03Worksheet components (no runtime session, database, or login required).
          Edit/Confirm buttons work against local state so you can exercise the same interactions a live session drives.
        </p>
      </div>

      <section className="space-y-3" data-testid="preview-s01">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-text-secondary">Session 1 · My Cognitive Model &amp; Three-Person Example</h2>
        <div className="flex flex-wrap gap-2">
          <Toggle value={s01Mode} options={[["patient", "Participant (read-only)"], ["clinician", "Clinician"]]} onChange={resetS01(setS01Mode)} />
          <Toggle value={s01Locale} options={[["ko", "한국어"], ["en", "English"]]} onChange={resetS01(setS01Locale)} />
          <Toggle value={s01Stage} options={[["empty", "Empty"], ["mid", "In progress"], ["done", "Done"]]} onChange={resetS01(setS01Stage)} />
        </div>
        {/* Roughly the width of the panel beside the chat. */}
        <div className="max-w-md rounded-panel border border-border bg-surface p-4">
          <S01Worksheet
            view={currentS01View}
            activeCanonicalFieldKey={S01_STAGE_ACTIVE[s01Stage]}
            onConfirm={confirmS01}
            onEdit={editS01}
            busy={busy}
            locale={s01Mode === "patient" ? s01Locale : undefined}
            readOnly={s01Mode === "patient"}
          />
        </div>
      </section>

      <section className="space-y-3" data-testid="preview-s01-homework">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-text-secondary">Session 1 · Homework (15 distortions, 내 예시)</h2>
        <p className="text-sm text-text-muted">Uses the app language (top-right toggle), like the real homework page. Saving adds to local state only.</p>
        <DistortionHomeworkTable entries={homeworkEntries} onAdd={(input) => setHomeworkEntries((list) => [...list, { id: `preview-${list.length + 1}`, ...input }])} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-text-secondary">Session 2 · Color-Coded Problem/Goal Hierarchy (CCPH/CCGH)</h2>
        <ScaleLegend />
        <S02Worksheet view={s02View} onConfirm={confirmS02} onEdit={editS02} busy={busy} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-text-secondary">Session 3 · Intra-TR</h2>
        <S03Worksheet view={s03View} onConfirm={confirmS03} onEdit={editS03} busy={busy} />
      </section>
    </div>
  );
}
