// How S01's recorded values become memory chunks (src/shared/memory/
// chunk-builder.ts). Names are those of s01/prompt-fields.ts. Grouped the way
// a later session would want them back: each difficulty with its example, the
// goal, the participant's own moment as one piece, the cycle, and each thing
// they worked out in their own words. The three-person scene is the program's
// example, not the participant's life, and is left out.

import { clean, distortionIdsFromNames, distortionName, isKoreanLocale, type ChunkDraft, type WorksheetChunker } from "@/shared/memory/chunk-builder";

type Part = { field: string; ko: string; en: string; suffix?: (fields: Record<string, unknown>, ko: boolean) => string };

function percent(field: string) {
  return (fields: Record<string, unknown>) => (typeof fields[field] === "number" ? ` (${fields[field]})` : "");
}

function group(fields: Record<string, unknown>, ko: boolean, parts: Part[]): { content: string; fieldNames: string[] } {
  const lines: string[] = [];
  const fieldNames: string[] = [];
  for (const part of parts) {
    const value = clean(fields[part.field]);
    if (!value) continue;
    lines.push(`${ko ? part.ko : part.en}: ${value}${part.suffix?.(fields, ko) ?? ""}`);
    fieldNames.push(part.field);
  }
  return { content: lines.join("\n"), fieldNames };
}

const OWN_CASE: Part[] = [
  { field: "situationLine", ko: "상황", en: "Situation" },
  { field: "personalEmotion", ko: "감정", en: "Feeling", suffix: percent("personalEmotionIntensity") },
  { field: "personalSecondEmotion", ko: "감정", en: "Feeling", suffix: percent("personalSecondEmotionIntensity") },
  { field: "personalThirdEmotion", ko: "감정", en: "Feeling", suffix: percent("personalThirdEmotionIntensity") },
  { field: "thoughtLine", ko: "자동적 사고", en: "Automatic thought", suffix: (fields, ko) => (typeof fields.s01ThoughtBeliefPercent === "number" ? ` (${ko ? "믿음" : "belief"} ${fields.s01ThoughtBeliefPercent}%)` : "") },
  { field: "personalBehavior", ko: "행동", en: "Behavior" },
  { field: "personalSecondBehavior", ko: "행동", en: "Behavior" },
  { field: "personalBodySensations", ko: "신체", en: "Body" },
  { field: "ownCaseActualOutcome", ko: "실제로 일어난 일", en: "What actually happened" },
];

const CYCLE: Part[] = [
  { field: "cycleAfterBehaviorEmotion", ko: "행동 후 감정", en: "Feeling after the behavior" },
  { field: "cycleReinforcedThought", ko: "더 강해지는 생각", en: "Thought that gets stronger" },
  { field: "cycleSafetyStrategy", ko: "다시 일어나지 않게 하려고 하는 것", en: "What they do to keep it from happening again" },
  { field: "cycleProblemLink", ko: "어려움과의 연결", en: "Link to the difficulty" },
  { field: "cycleShortLongTermEffect", ko: "당장과 시간이 지난 뒤", en: "Right away and over time" },
];

const GOAL: Part[] = [
  { field: "s01Goal", ko: "목표", en: "Goal" },
  { field: "s01GoalBenefit", ko: "이루어지면 달라질 일상", en: "What would change day to day" },
  { field: "s01GoalFeeling", ko: "이루어지면 느낄 감정", en: "How they would feel" },
];

const OWN_WORDS: Array<{ field: string; ko: string; en: string }> = [
  { field: "participantSummary", ko: "인지 모델을 자기 말로 정리", en: "Their own summary of the cognitive model" },
  { field: "ownCasePatternInsight", ko: "자기 감정을 만든 것", en: "What made their own feeling" },
  { field: "ownCaseOutcomeMeaning", ko: "걱정한 일이 일어나지 않았다는 것의 의미", en: "What it means that the feared outcome did not happen" },
  { field: "threePersonModelInsight", ko: "세 사람의 차이를 만든 것", en: "What made the difference between the three people" },
  { field: "distortionMeaning", ko: "그 생각이 왜곡이라면 달라질 것", en: "What would differ if the thought were a distortion" },
];

export const s01MemoryChunks: WorksheetChunker = (fields, locale) => {
  const ko = isKoreanLocale(locale);
  const drafts: ChunkDraft[] = [];

  const problems = Array.isArray(fields.s01Problems) ? fields.s01Problems : [];
  const examples = Array.isArray(fields.s01ProblemExample) ? fields.s01ProblemExample : [];
  problems.forEach((problem, index) => {
    const text = clean(problem);
    if (!text) return;
    const example = clean(examples[index]);
    drafts.push({
      key: `s01:problem:${index}`,
      elementKind: "problem",
      content: `${ko ? "어려움" : "Difficulty"}: ${text}${example ? `\n${ko ? "예" : "Example"}: ${example}` : ""}`,
      fieldNames: example ? ["s01Problems", "s01ProblemExample"] : ["s01Problems"],
    });
  });
  const representative = clean(fields.s01RepresentativeProblem);
  if (representative) {
    drafts.push({ key: "s01:representative", elementKind: "problem", content: `${ko ? "다른 어려움들 밑에 있는 어려움" : "The difficulty underneath the others"}: ${representative}`, fieldNames: ["s01RepresentativeProblem"] });
  }

  const goal = group(fields, ko, GOAL);
  if (goal.content) drafts.push({ key: "s01:goal", elementKind: "goal", ...goal });

  // Their own words for the situation and thought if the one-line versions
  // were never written.
  const ownCaseFields = { ...fields, situationLine: fields.situationLine ?? fields.situationThoughtDistinction, thoughtLine: fields.thoughtLine ?? fields.openingInitialThought };
  const ownCase = group(ownCaseFields, ko, OWN_CASE);
  const recognized = distortionIdsFromNames(fields.participantSelectedDistortions);
  if (ownCase.content) {
    const recognizedLine = recognized.length ? `\n${ko ? "알아차린 왜곡" : "Distortions they recognized"}: ${recognized.map((id) => distortionName(id, locale)).join(", ")}` : "";
    drafts.push({
      key: "s01:own-case",
      elementKind: "own_case",
      content: `${ownCase.content}${recognizedLine}`,
      fieldNames: [...ownCase.fieldNames, ...(recognized.length ? ["participantSelectedDistortions"] : [])],
      distortionIds: recognized,
    });
  }

  const cycle = group(fields, ko, CYCLE);
  if (cycle.content) drafts.push({ key: "s01:cycle", elementKind: "cycle", ...cycle });

  const friend = clean(fields.friendThought);
  if (friend) drafts.push({ key: "s01:friend-thought", elementKind: "alternative_thought", content: `${ko ? "가까운 친구라면 했을 생각" : "What a close friend might have thought"}: ${friend}`, fieldNames: ["friendThought"] });

  for (const item of OWN_WORDS) {
    const value = clean(fields[item.field]);
    if (value) drafts.push({ key: `s01:${item.field}`, elementKind: "reflection", content: `${ko ? item.ko : item.en}: ${value}`, fieldNames: [item.field] });
  }
  return drafts;
};
