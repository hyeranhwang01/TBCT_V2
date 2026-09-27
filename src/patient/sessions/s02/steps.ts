// S02's steps, in the order of docs/prompts/TBCT_AI_Prompt_S02.md section 4,
// with the fields of s02/prompt-fields.ts that each step records
// (src/shared/trial/steps.ts). Steps 1, 3, 4, 6, 8 and 10 record nothing by
// design; sessionAgendaAgreed / homeworkCommitment are kept as evidence where
// the model records them. Keep in step with the prompt document.
import type { StepTable } from "@/shared/trial/steps";

export const S02_STEPS: StepTable = {
  sessionDefinitionId: "tbct-s02",
  steps: [
    { number: 1, name: "Bridge from the first session", evidence: [] },
    { number: 2, name: "Homework review", evidence: ["homeworkReport"] },
    { number: 3, name: "Today's order", evidence: ["sessionAgendaAgreed", "sessionAgendaConcern"] },
    { number: 4, name: "Why we look at these", evidence: [] },
    { number: 5, name: "The fifteen patterns, one at a time", evidence: ["distortionExamples"] },
    { number: 6, name: "The CD-Quest grid", evidence: [] },
    { number: 7, name: "Scoring the fifteen", evidence: ["cdQuestFrequency", "cdQuestIntensity", "cdQuestStatedScores"] },
    { number: 8, name: "The total and what it means", evidence: ["cdQuestReflection"] },
    { number: 9, name: "What to work on", evidence: ["cdQuestPriorityTypes"] },
    { number: 10, name: "Recap, homework and closing", evidence: ["homeworkCommitment"] },
  ],
};
