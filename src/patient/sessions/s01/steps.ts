// S01's steps, in the order of docs/prompts/TBCT_AI_Prompt_S01.md section 4,
// with the fields of s01/prompt-fields.ts that each step records
// (src/shared/trial/steps.ts). Keep in step with the prompt document.
import type { StepTable } from "@/shared/trial/steps";

export const S01_STEPS: StepTable = {
  sessionDefinitionId: "tbct-s01",
  steps: [
    { number: 1, name: "Opening and today's order", evidence: ["sessionAgendaAgreed", "sessionAgendaConcern"] },
    { number: 2, name: "Identifying the problems", evidence: ["s01Problems", "s01ProblemExample", "s01RepresentativeProblem"] },
    { number: 3, name: "Setting a goal", evidence: ["s01Goal", "s01GoalBenefit", "s01GoalFeeling"] },
    { number: 4, name: "How this work goes", evidence: ["treatmentCommitment"] },
    { number: 5, name: "Their own moment", evidence: ["situationThoughtDistinction", "situationLine", "personalEmotion", "openingInitialThought", "thoughtLine", "personalBehavior", "personalBodySensations"] },
    { number: 6, name: "The returning arrows", evidence: ["cycleAfterBehaviorEmotion", "cycleReinforcedThought", "cycleSafetyStrategy", "cycleProblemLink", "cycleShortLongTermEffect", "cycleLinkRecognized"] },
    { number: 7, name: "The three-person example", evidence: ["candidateOneEmotion", "candidateOneThought", "candidateTwoThought", "candidateThreeThought", "threePersonModelInsight"] },
    { number: 8, name: "Back to their own moment", evidence: ["ownCasePatternInsight", "ownCaseActualOutcome", "ownCaseOutcomeMeaning", "friendThought"] },
    { number: 9, name: "The participant's summary", evidence: ["participantSummary"] },
    { number: 10, name: "Introducing cognitive distortions", evidence: ["participantSelectedDistortions", "distortionMeaning"] },
    { number: 11, name: "Homework, recap and closing", evidence: ["homeworkCommitment"] },
  ],
};
