import type { PromptSessionFieldSet } from "@/shared/runtime/prompt-driven-sessions";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { cdQuestScore, type CdQuestGrade } from "@/patient/sessions/s02/cdquest-score";

// The values S02's session prompt may record (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02). Names are the ones the S02 worksheet
// (worksheet-binding.ts), the CD-Quest homework baseline and the clinician
// progress panel (distortionExamples + cdQuestScores) already read.
//
// The model records only what the participant said -- how often and how
// strongly, or a score they stated. The program works out each score from the
// two grades, and the total once all fifteen are scored, and tells the model on
// its next turn (the session prompt says the program does the arithmetic).

const PATTERNS = COGNITIVE_DISTORTIONS.length;

export const S02_PROMPT_FIELDS: PromptSessionFieldSet = {
  sessionDefinitionId: "tbct-s02",
  fields: [
    { name: "homeworkReport", label: "How the week's practice went, in their words", kind: "text" },
    { name: "sessionAgendaAgreed", label: "Their answer to today's order, as said", kind: "text" },
    { name: "sessionAgendaConcern", label: "What did not feel right about today's order, if they declined", kind: "text" },
    { name: "distortionExamples", label: `Their own example for each of the ${PATTERNS} patterns, in the order of the list; "—" when nothing came to mind`, kind: "text_list", length: PATTERNS },
    { name: "cdQuestFrequency", label: "How often each pattern came up: 0 not at all, 1 = 1-2 days, 2 = 3-5 days, 3 = 6-7 days", kind: "number_list", min: 0, max: 3, length: PATTERNS },
    { name: "cdQuestIntensity", label: "How strongly it was believed: 0 did not occur, 1 a little, 2 quite, 3 very much", kind: "number_list", min: 0, max: 3, length: PATTERNS },
    { name: "cdQuestStatedScores", label: "Only a score (0-5) the participant stated directly for a pattern; null otherwise. The program works out every other score", kind: "number_list", min: 0, max: 5, length: PATTERNS },
    { name: "cdQuestReflection", label: "What thoughts came up for them looking at the total", kind: "text" },
    { name: "cdQuestPriorityTypes", label: "The patterns they want to work on, by the names in the list", kind: "text_list" },
    { name: "homeworkCommitment", label: "Their answer to whether they can do the practice, as said", kind: "text" },
  ],
  derive: (fields) => {
    const grades = (name: string) => (Array.isArray(fields[name]) ? (fields[name] as unknown[]) : []);
    const frequency = grades("cdQuestFrequency");
    const intensity = grades("cdQuestIntensity");
    // Kept apart from cdQuestScores (the worked-out list the worksheet shows),
    // so a later correction of a grade is never masked by an earlier result.
    const stated = grades("cdQuestStatedScores");
    const scores: Array<number | null> = Array.from({ length: PATTERNS }, (_, index) => {
      const direct = stated[index];
      if (typeof direct === "number") return direct;
      const f = frequency[index];
      const i = intensity[index];
      if (f === 0 || i === 0) return typeof f === "number" || typeof i === "number" ? 0 : null;
      if (typeof f === "number" && typeof i === "number") return cdQuestScore(f as CdQuestGrade, i as CdQuestGrade);
      return null;
    });
    // Keep the list as long as the furthest pattern scored, so the worksheet
    // shows the rows in progress and nothing beyond them.
    const lastScored = scores.reduce<number>((last, score, index) => (score === null ? last : index), -1);
    const next: Record<string, unknown> = { ...fields };
    const facts: string[] = [];
    if (lastScored >= 0) next.cdQuestScores = scores.slice(0, lastScored + 1);
    const scoredCount = scores.filter((score) => score !== null).length;
    if (scoredCount === PATTERNS) {
      const complete = scores as number[];
      next.cdQuestTotal = complete.reduce((sum, value) => sum + value, 0);
      next.cdQuestHighCount = complete.filter((value) => value >= 4).length;
      facts.push(`All ${PATTERNS} patterns are scored. Total: ${next.cdQuestTotal} out of 75. Patterns at 4 or above: ${next.cdQuestHighCount}.`);
    } else if (scoredCount > 0) {
      facts.push(`CD-Quest: ${scoredCount} of ${PATTERNS} patterns scored so far.`);
    }
    return { fields: next, facts };
  },
};
