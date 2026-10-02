// How S02's recorded values become memory chunks (src/shared/memory/
// chunk-builder.ts). Names are those of s02/prompt-fields.ts. One chunk per
// pattern the participant gave an example for, carrying its CD-Quest score;
// then the patterns they want to work on, what they made of the total, and
// the homework report.

import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { clean, distortionIdsFromNames, distortionName, isKoreanLocale, type ChunkDraft, type WorksheetChunker } from "@/shared/memory/chunk-builder";
import { OPENING_STEP, type RetrievalSlots } from "@/shared/memory/chunk-scorer";

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
 * The S02 steps that are about something specific from before
 * (chunk-scorer.ts, retrieval-v2), keyed by the field the conversation is on
 * (s02/prompt-fields.ts). The session opens by asking about last week's
 * practice and then hears the homework report: last week's homework is what
 * those two moments are about, so it is offered whatever was said. The
 * opening also gets the participant's own S01 moment (the level-1 diagram),
 * because the book's Session 2 opens by going back to that diagram ("Did that
 * diagram I showed you…", de Oliveira 2015, PDF p.52 / pr.36). Every
 * other step -- the fifteen-pattern walkthrough included -- gets only what
 * the participant's words or the current themes point to. The basic bridge
 * (previousS01*, session-continuity.ts) carries the S01 problems and goal
 * to every S02 call regardless.
 * Replaces the v1 step-affinity table (kept in eval/scorer-v1.ts for
 * comparison), note2026_10_02_memory_rag_v2_phase_a.
 */
export const s02RetrievalSlots: RetrievalSlots = {
  [OPENING_STEP]: ["homework", "homework_report", "own_case"],
  homeworkReport: ["homework", "homework_report"],
};
