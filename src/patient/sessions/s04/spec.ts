import { sourceText } from "@/lib/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/lib/protocol/source-fidelity-catalog";

const metadata: SessionSourceMetadata = {
  number: 4,
  id: "tbct-s04",
  title: "Interpersonal Thought Record (Inter-TR)",
  titleKo: "대인관계 사고 기록 (Inter-TR)",
  techniqueName: "Interpersonal Thought Record (Inter-TR)",
  acronym: "Inter-TR",
  sourceLineStart: 746,
  sourceLineEnd: 803,
  sourceSessionHash: "0f9d9ba505f420b1bc7bdd78d5491dd07267ed6fa41cea56b0253c511037f573",
  contextRange: [746, 762],
  roleRange: [746, 762],
  languageRange: [746, 762],
  openingRange: [746, 762],
  requiredActionsRange: [763, 786],
  restrictionsRange: [787, 803],
  safetyRange: [787, 803],
};

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "situation",
      title: "Step 1 - Interpersonal Situation",
      titleKo: "1단계 - 대인관계 상황",
      type: "session_start",
      source: [746, 762],
      requiredFields: ["interpersonalSituation"],
      safetyRuleIds: ["TBCT-S04-CRISIS-SUSPEND"],
      prompts: [
        { slug: "describe-situation", type: "question", source: [746, 762], marker: "What is happening", patientText: "What is happening in the interpersonal situation you would like to examine?", outputFields: ["interpersonalSituation"] },
      ],
    },
    {
      slug: "pathway-determination",
      title: "Pathway Determination",
      titleKo: "진행 경로 결정",
      type: "condition",
      source: [763, 769],
      requiredFields: ["interpersonalPathway"],
      nextSlug: "patient-thought-belief",
      restrictions: [sourceText([763, 769])],
      prompts: [
        { slug: "recognize-pathway", type: "instruction", source: [763, 769], patientText: "We will map your perspective and the other person's possible perspective, without assuming that either interpretation is certain.", outputFields: ["interpersonalPathway"], validation: { kind: "enum", values: ["standard_conflict", "social_anxiety_feared_evaluation"] } },
      ],
    },
    {
      slug: "patient-thought-belief",
      title: "Step 2 - Patient Automatic Thought and Belief",
      titleKo: "2단계 - 나의 자동적 사고와 믿음",
      type: "assessment",
      source: [746, 762],
      requiredFields: ["patientAutomaticThought", "patientAutomaticThoughtBeliefPercent"],
      prompts: [
        { slug: "patient-automatic-thought", type: "question", source: [746, 762], marker: "What is going through your mind", patientText: "What is going through your mind in that situation?", outputFields: ["patientAutomaticThought"] },
        { slug: "patient-thought-belief", type: "rating", source: [746, 762], marker: "How much do you believe that thought", patientText: "From 0 to 100%, how much do you believe that thought?", outputFields: ["patientAutomaticThoughtBeliefPercent"], validation: { kind: "rating", min: 0, max: 100 } },
      ],
    },
    {
      slug: "patient-emotion",
      title: "Step 3 - Patient Emotion and Intensity",
      titleKo: "3단계 - 나의 감정과 강도",
      type: "assessment",
      source: [746, 762],
      requiredFields: ["patientEmotion", "patientEmotionIntensityPercent"],
      prompts: [
        { slug: "patient-emotion", type: "question", source: [746, 762], marker: "Believing that, what do you feel", patientText: "When you believe that thought, what emotion do you feel?", outputFields: ["patientEmotion"] },
        { slug: "patient-emotion-intensity", type: "rating", source: [746, 762], marker: "How strong is that feeling", patientText: "From 0 to 100%, how strong is that emotion?", outputFields: ["patientEmotionIntensityPercent"], validation: { kind: "rating", min: 0, max: 100 } },
      ],
    },
    {
      slug: "patient-behavior-body",
      title: "Step 4 - Patient Behavior and Body",
      titleKo: "4단계 - 나의 행동과 신체 반응",
      type: "assessment",
      source: [746, 762],
      requiredFields: ["patientBehavior", "patientBodySensations", "interpersonalSummaryConfirmed"],
      prompts: [
        { slug: "patient-behavior", type: "question", source: [746, 762], marker: "What do you do when you believe", patientText: "What do you do when you believe that thought and feel that emotion?", outputFields: ["patientBehavior"] },
        { slug: "patient-body", type: "question", source: [746, 762], marker: "Do you notice anything in your body", patientText: "Do you notice anything happening in your body in that moment?", outputFields: ["patientBodySensations"] },
        { slug: "confirm-summary", type: "confirmation", source: [746, 762], patientText: "Does that summary of your thought, emotion, behavior, and body response fit your experience?", outputFields: ["interpersonalSummaryConfirmed"], validation: { kind: "summary_confirmation" } },
      ],
    },
    {
      slug: "other-thought",
      title: "Step 5 - Other Person's Automatic Thought",
      titleKo: "5단계 - 상대방의 자동적 사고",
      type: "question",
      source: [746, 769],
      requiredFields: ["otherPersonLikelyThought"],
      prompts: [
        { slug: "other-person-thought", type: "question", source: [746, 769], marker: "What might be going through the other person's mind", outputFields: ["otherPersonLikelyThought"] },
        { slug: "plausible-possibility", type: "clarification", source: [746, 803], marker: "not expected to read the other person's mind", activationCondition: { field: "interpersonalPathway", operator: "equals", value: "social_anxiety_feared_evaluation" } },
      ],
    },
    {
      slug: "other-emotion",
      title: "Step 6 - Other Person's Emotion",
      titleKo: "6단계 - 상대방의 감정",
      type: "question",
      source: [746, 762],
      requiredFields: ["otherPersonLikelyEmotion"],
      prompts: [
        { slug: "other-person-emotion", type: "question", source: [746, 762], marker: "What might they feel", outputFields: ["otherPersonLikelyEmotion"] },
      ],
    },
    {
      slug: "other-behavior",
      title: "Step 7 - Other Person's Behavior",
      titleKo: "7단계 - 상대방의 행동",
      type: "question",
      source: [746, 762],
      requiredFields: ["otherPersonLikelyBehavior"],
      prompts: [
        { slug: "other-person-behavior", type: "question", source: [746, 762], marker: "And what might they do", outputFields: ["otherPersonLikelyBehavior"] },
      ],
    },
    {
      slug: "feedback-loop",
      title: "Feedback Loop Discovery",
      titleKo: "상호작용 고리 발견",
      type: "dialogue",
      source: [770, 771],
      requiredFields: ["feedbackLoopRecognition"],
      restrictions: [sourceText([770, 771])],
      prompts: [
        { slug: "notice-cycle", type: "question", source: [770, 771], marker: "What do you notice about this cycle", outputFields: ["feedbackLoopRecognition"] },
        { slug: "behavior-influences-response", type: "question", source: [770, 771], marker: "How does your behavior influence", outputFields: ["feedbackLoopRecognition"] },
        { slug: "response-influences-participant", type: "question", source: [770, 771], marker: "How does their response", outputFields: ["feedbackLoopRecognition"] },
        { slug: "cycle-self-perpetuation", type: "question", source: [770, 771], marker: "How might this cycle keep", outputFields: ["feedbackLoopRecognition"], validation: { kind: "recognition_required" } },
      ],
    },
    {
      slug: "locus-of-control",
      title: "Locus of Control",
      titleKo: "통제 소재",
      type: "dialogue",
      source: [772, 777],
      requiredFields: ["locusOfControlRecognition"],
      restrictions: [sourceText([772, 777])],
      prompts: [
        { slug: "outside-control", type: "question", source: [772, 777], marker: "Which parts of this cycle are outside", outputFields: ["outsideControl"] },
        { slug: "other-person-control", type: "question", source: [772, 777], marker: "Can you control what the other person", outputFields: ["outsideControl"] },
        { slug: "own-leverage", type: "question", source: [772, 777], marker: "What part of this cycle do you have", outputFields: ["locusOfControlRecognition"], validation: { kind: "own_behavior_leverage_required" } },
      ],
    },
    {
      slug: "final-at-rerating",
      title: "Step 8 - Final Automatic Thought Re-rating",
      titleKo: "8단계 - 자동적 사고 재평가",
      type: "assessment",
      source: [772, 783],
      requiredFields: ["revisedPatientAutomaticThoughtBeliefPercent"],
      prompts: [
        { slug: "final-at-belief", type: "rating", source: [772, 783], marker: "Now that you can see this cycle", outputFields: ["revisedPatientAutomaticThoughtBeliefPercent"], validation: { kind: "rating", min: 0, max: 100 } },
      ],
    },
    {
      slug: "action-plan",
      title: "Action Plan",
      titleKo: "실천 계획",
      type: "activity",
      source: [778, 783],
      requiredFields: ["plannedActions", "actionObstacles", "obstacleSolutions", "implementationTiming"],
      restrictions: [sourceText([778, 783])],
      prompts: [
        { slug: "own-behavior-action", type: "question", source: [778, 783], marker: "Since your own behavior", outputFields: ["plannedActions"] },
        { slug: "all-actions-first", type: "worksheet_instruction", source: [778, 783], outputFields: ["plannedActions"], validation: { kind: "all_actions_before_obstacles" } },
        { slug: "obstacles", type: "question", source: [778, 783], outputFields: ["actionObstacles"] },
        { slug: "solutions", type: "question", source: [778, 783], outputFields: ["obstacleSolutions"] },
        { slug: "implementation-timing", type: "question", source: [778, 783], outputFields: ["implementationTiming"] },
      ],
    },
    {
      slug: "final-check-in",
      title: "Final Check-in",
      titleKo: "마무리 확인",
      type: "session_complete",
      source: [784, 803],
      safetyRuleIds: ["TBCT-S04-CRISIS-SUSPEND"],
      restrictions: [sourceText([787, 803])],
      terminal: true,
      prompts: [
        { slug: "final-belief-check", type: "rating", source: [784, 786], outputFields: ["revisedPatientAutomaticThoughtBeliefPercent"], validation: { kind: "rating", min: 0, max: 100 } },
        // This prompt carries completionEffect: complete_session, so an answer it
        // cannot match leaves the session unable to end. The choices are English
        // only, and matchEnumChoice compares against `values` plus these aliases
        // -- without them a Korean participant answering "그대로" burned the
        // clarification budget instead of closing the session (same class of
        // defect as S07's readiness enum, which carries aliases for this reason).
        { slug: "final-emotional-check", type: "question", source: [784, 786], outputFields: ["finalEvaluation"], validation: { kind: "enum", values: ["same", "a little better", "much better"], aliases: { "same": ["그대로", "그대로예요", "똑같아요", "같아요", "비슷해요", "변화 없어요", "변함없어요", "그대로인 것 같아요"], "a little better": ["조금 나아졌어요", "조금 나아짐", "약간 나아졌어요", "조금 괜찮아졌어요", "조금 나아진 것 같아요", "약간 좋아졌어요"], "much better": ["많이 나아졌어요", "많이 나아짐", "훨씬 나아졌어요", "훨씬 좋아졌어요", "많이 괜찮아졌어요", "많이 좋아졌어요"] } }, completionEffect: { type: "complete_session" } },
      ],
    },
    {
      slug: "social-anxiety-guidance",
      title: "Social Anxiety / Feared-Evaluation Guidance",
      titleKo: "사회 불안 · 평가에 대한 두려움 안내",
      type: "condition",
      source: [763, 769],
      nextSlug: "patient-thought-belief",
      restrictions: [sourceText([763, 769])],
      prompts: [
        { slug: "test-feared-prediction", type: "instruction", source: [763, 769], outputFields: ["fearedPredictionTestPlan"] },
      ],
    },
  ],
  extraEdges: [
    { sourceSlug: "pathway-determination", targetSlug: "social-anxiety-guidance", edgeType: "conditional", source: [763, 769], label: "Social anxiety / feared evaluation", condition: { field: "interpersonalPathway", operator: "equals", value: "social_anxiety_feared_evaluation" }, priority: 1 },
  ],
};
