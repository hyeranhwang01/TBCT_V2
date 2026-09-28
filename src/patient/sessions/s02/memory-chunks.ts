// How S02's recorded values become memory chunks (src/shared/memory/
// chunk-builder.ts). Names are those of s02/prompt-fields.ts. One chunk per
// pattern the participant gave an example for, carrying its CD-Quest score;
// then the patterns they want to work on, what they made of the total, and
// the homework report.

import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { clean, distortionIdsFromNames, distortionName, isKoreanLocale, type ChunkDraft, type WorksheetChunker } from "@/shared/memory/chunk-builder";
import { OPENING_STEP, type RetrievalAffinity } from "@/shared/memory/chunk-scorer";

function at(list: unknown, index: number): unknown {
  return Array.isArray(list) ? list[index] : undefined;
}

export const s02MemoryChunks: WorksheetChunker = (fields, locale) => {
  const ko = isKoreanLocale(locale);
  const drafts: ChunkDraft[] = [];

  COGNITIVE_DISTORTIONS.forEach((distortion, index) => {
    const example = clean(at(fields.distortionExamples, index));
    if (!example || example === "—") return;
    const score = at(fields.cdQuestScores, index);
    const frequency = at(fields.cdQuestFrequency, index);
    const intensity = at(fields.cdQuestIntensity, index);
    const scoreText = typeof score === "number"
      ? ko
        ? ` · CD-Quest ${score}점${typeof frequency === "number" && typeof intensity === "number" ? ` (빈도 ${frequency}, 확신 ${intensity})` : ""}`
        : ` · CD-Quest ${score}${typeof frequency === "number" && typeof intensity === "number" ? ` (frequency ${frequency}, belief ${intensity})` : ""}`
      : "";
    drafts.push({
      key: `s02:example:${distortion.id}`,
      elementKind: "distortion_example",
      content: `${distortionName(distortion.id, locale)} ${ko ? "예시" : "example"}: ${example}${scoreText}`,
      fieldNames: ["distortionExamples", ...(typeof score === "number" ? ["cdQuestScores"] : [])],
      distortionIds: [distortion.id],
    });
  });

  const priority = distortionIdsFromNames(fields.cdQuestPriorityTypes);
  if (priority.length) {
    drafts.push({
      key: "s02:priority",
      elementKind: "distortion_priority",
      content: `${ko ? "앞으로 다루고 싶은 패턴" : "Patterns they want to work on"}: ${priority.map((id) => distortionName(id, locale)).join(", ")}`,
      fieldNames: ["cdQuestPriorityTypes"],
      distortionIds: priority,
    });
  }

  const reflection = clean(fields.cdQuestReflection);
  if (reflection) {
    const total = typeof fields.cdQuestTotal === "number" ? (ko ? ` (총점 ${fields.cdQuestTotal}/75)` : ` (total ${fields.cdQuestTotal}/75)`) : "";
    drafts.push({ key: "s02:reflection", elementKind: "reflection", content: `${ko ? "CD-Quest 총점을 보고 든 생각" : "What they thought, looking at the CD-Quest total"}${total}: ${reflection}`, fieldNames: ["cdQuestReflection"] });
  }

  const homework = clean(fields.homeworkReport);
  if (homework) drafts.push({ key: "s02:homework-report", elementKind: "homework_report", content: `${ko ? "지난 과제에 대해" : "About last week's practice"}: ${homework}`, fieldNames: ["homeworkReport"] });
  return drafts;
};

/**
 * Which earlier chunks matter at each S02 step (chunk-scorer.ts), keyed by the
 * field the conversation is on (s02/prompt-fields.ts). At the opening the
 * participant's own S01 moment and last week's homework are what the bridge
 * can pick up; in the fifteen-pattern walkthrough their own S01 moment,
 * homework rows and conversation are where an example of theirs may already
 * be. Problems and goal are background everywhere, so they only come up when
 * what the participant says or the themes point to them.
 */
export const s02RetrievalAffinity: RetrievalAffinity = {
  [OPENING_STEP]: { own_case: 0.6, homework: 0.6 },
  // A counsellor's note is meant to carry across sessions: at every step it
  // comes up when what is being said matches it, never on its own.
  "*": { problem: 0.25, goal: 0.25, clinician_note: 0.35 },
  homeworkReport: { homework: 1, homework_report: 1 },
  // Only their own S01 moment qualifies here on its own; homework rows,
  // conversation and the rest need what they are saying, or the pattern
  // being discussed (themes), to point to them -- otherwise every row of
  // every pattern would crowd in.
  distortionExamples: { own_case: 1, homework: 0.35, conversation: 0.3, cycle: 0.3, problem: 0.3, distortion_example: 0.3, alternative_thought: 0.3 },
  cdQuestFrequency: { own_case: 0.4, homework: 0.4 },
  cdQuestIntensity: { own_case: 0.4, homework: 0.4 },
  cdQuestStatedScores: { own_case: 0.4, homework: 0.4 },
  cdQuestReflection: { goal: 0.6, problem: 0.6 },
  cdQuestPriorityTypes: { problem: 1, goal: 1, own_case: 0.6 },
  homeworkCommitment: { homework: 0.5 },
};
