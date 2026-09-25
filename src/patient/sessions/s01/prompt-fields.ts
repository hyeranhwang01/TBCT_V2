import type { PromptSessionFieldSet } from "@/shared/runtime/prompt-driven-sessions";

// The values S01's session prompt may record (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02). Names are the ones the S01 worksheet
// (worksheet-binding.ts), the S02 bridge (shared/runtime/session-continuity.ts:
// s01Problems, s01RepresentativeProblem, s01Goal) and the clinician views
// already read, so none of them change. The labels are what the model is told
// each field holds.
export const S01_PROMPT_FIELDS: PromptSessionFieldSet = {
  sessionDefinitionId: "tbct-s01",
  fields: [
    { name: "sessionAgendaAgreed", label: "Their answer to today's order, as said", kind: "text" },
    { name: "sessionAgendaConcern", label: "What did not feel right about today's order, if they declined", kind: "text" },
    { name: "s01Problems", label: "The difficulties they want help with, one item each, in their words", kind: "text_list" },
    { name: "s01ProblemExample", label: "A concrete example for each difficulty, in the same order as s01Problems", kind: "text_list" },
    { name: "s01RepresentativeProblem", label: "The difficulty they chose as sitting underneath the others", kind: "text" },
    { name: "s01Goal", label: "How they would like that difficulty to be when counseling ends", kind: "text" },
    { name: "s01GoalBenefit", label: "What would change in their daily life if it happened", kind: "text" },
    { name: "s01GoalFeeling", label: "How they would feel if it happened", kind: "text" },
    { name: "treatmentCommitment", label: "Their answer to working together this way, as said", kind: "text" },
    { name: "situationThoughtDistinction", label: "Their situation: their first words, exactly as said however long", kind: "text" },
    { name: "situationLine", label: "Their situation in one line, written by them when asked", kind: "text" },
    { name: "personalEmotion", label: "The first feeling they named", kind: "text" },
    { name: "personalEmotionIntensity", label: "Its strength, 0-100", kind: "number", min: 0, max: 100 },
    { name: "personalSecondEmotion", label: "A second feeling, if any", kind: "text" },
    { name: "personalSecondEmotionIntensity", label: "Its strength, 0-100", kind: "number", min: 0, max: 100 },
    { name: "personalThirdEmotion", label: "A third feeling, if any", kind: "text" },
    { name: "personalThirdEmotionIntensity", label: "Its strength, 0-100", kind: "number", min: 0, max: 100 },
    { name: "openingInitialThought", label: "The thought that went through their mind: first words, exactly as said", kind: "text" },
    { name: "thoughtLine", label: "The thought in one line, written by them when asked", kind: "text" },
    { name: "s01ThoughtBeliefPercent", label: "How strongly they believed the thought at the time, 0-100", kind: "number", min: 0, max: 100 },
    { name: "personalBehavior", label: "What they did", kind: "text" },
    { name: "personalSecondBehavior", label: "Anything else they did", kind: "text" },
    { name: "personalBodySensations", label: "What they noticed in their body", kind: "text" },
    { name: "cycleLinkRecognized", label: "Their answer to whether they can see how it connects, as said", kind: "text" },
    { name: "friendThought", label: "What a close friend might have thought instead", kind: "text" },
    { name: "cycleAfterBehaviorEmotion", label: "How they felt after what they did", kind: "text" },
    { name: "cycleReinforcedThought", label: "The thought that gets stronger then", kind: "text" },
    { name: "cycleSafetyStrategy", label: "What they usually do to keep it from happening again", kind: "text" },
    { name: "cycleProblemLink", label: "Whether and how that connects to their difficulty", kind: "text" },
    { name: "cycleShortLongTermEffect", label: "How it feels right away, and how it works out over time (both answers as said)", kind: "text" },
    { name: "candidateOneEmotion", label: "Person 1: feeling", kind: "text" },
    { name: "candidateOneThought", label: "Person 1: thought", kind: "text" },
    { name: "candidateOneBehavior", label: "Person 1: behavior", kind: "text" },
    { name: "candidateOneBodySensations", label: "Person 1: body", kind: "text" },
    { name: "candidateTwoThought", label: "Person 2 (suspicion): thought", kind: "text" },
    { name: "candidateTwoBehavior", label: "Person 2: behavior", kind: "text" },
    { name: "candidateTwoBodySensations", label: "Person 2: body", kind: "text" },
    { name: "candidateThreeThought", label: "Person 3 (anger): thought", kind: "text" },
    { name: "candidateThreeBehavior", label: "Person 3: behavior", kind: "text" },
    { name: "candidateThreeBodySensations", label: "Person 3: body", kind: "text" },
    { name: "threePersonModelInsight", label: "What made the difference between the three, in their words", kind: "text" },
    { name: "ownCasePatternInsight", label: "What made their own feeling, in their words", kind: "text" },
    { name: "ownCaseActualOutcome", label: "What actually happened afterwards", kind: "text" },
    { name: "ownCaseOutcomeMeaning", label: "What it tells them that the feared outcome did not happen, if asked", kind: "text" },
    { name: "participantSummary", label: "Their own summary of how thought, feeling and behavior connected", kind: "text" },
    { name: "participantSelectedDistortions", label: "The distortions they recognized, by the names in the list", kind: "text_list" },
    { name: "distortionMeaning", label: "What difference it would make if the thought were a distortion", kind: "text" },
    { name: "homeworkCommitment", label: "Their answer to whether they can do the practice, as said", kind: "text" },
  ],
  // The fixed scene and the feelings given to persons 2 and 3 are the
  // program's, not the participant's, so they are written here rather than
  // offered to the model as fields.
  derive: (fields, locale) => {
    const isKorean = (locale ?? "").toLowerCase().startsWith("ko");
    const given = fields.candidateTwoThought !== undefined || fields.candidateTwoBehavior !== undefined;
    const next = { ...fields };
    if (given && next.candidateTwoEmotion === undefined) next.candidateTwoEmotion = isKorean ? "의심" : "suspicion";
    if ((fields.candidateThreeThought !== undefined || fields.candidateThreeBehavior !== undefined) && next.candidateThreeEmotion === undefined) next.candidateThreeEmotion = isKorean ? "화" : "anger";
    if ((fields.candidateOneEmotion !== undefined || given) && next.threePersonScene === undefined) {
      next.threePersonScene = isKorean
        ? "상담자가 처음 만난 세 사람에게 헤어질 때 똑같이 말합니다. “만나서 반가웠어요. 좋으신 분 같아요. 다음 주에 뵙겠습니다.”"
        : "As they say goodbye, a counselor says the same thing to three people they have just met: “It was nice to meet you. You seem like a good person. See you next week.”";
    }
    return { fields: next, facts: [] };
  },
};
