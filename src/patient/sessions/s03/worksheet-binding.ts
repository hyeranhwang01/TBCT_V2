import type { WorksheetBinding } from "@/types/worksheet";

// Session 3 (Intrapersonal Thought Record) worksheet binding registry.
// PILOT SCOPE: every canonicalFieldKey here is a real
// PromptItem.outputFields[0] value from source-fidelity-catalog.ts's
// tbct-s03 spec (verified against nodes q1-situation through
// q12-q14-final-evaluation) -- nothing here is invented. Fields NOT bound
// yet (positiveEmotions, originalEmotionRerating, newEmotionIntensities --
// the multi-emotion "new emotion" row of the original Intra-TR figure --
// plus closingReview, actionPlanOffer, and the conditional
// factualThoughtConfirmed/workingAutomaticThought branch) are intentionally
// out of scope for this pass (they need a proper multi-emotion/evaluation_matrix
// renderer, not a text field) and should be flagged review_required if a
// later pass extends the worksheet to cover them.
//
// FIXED (Patient Authorship Invariant, .claude/TASK_SCOPE.json
// note2026_09_05): every field below except participantSummary used to
// declare assistantMustNotSupply: false while participantOwned stayed true
// -- "the participant owns this, but the assistant may supply it" is not a
// coherent state, and it silently defeated dialogue-contract-compiler.ts's
// ownershipFor() conservative default (assistantMustNotSupply: true) for
// this entire session. The values originated in this file's original pilot
// commit and were never revisited; participantSummary's comment below shows
// the flag was read narrowly, as "the manual marks THIS prompt," rather than
// as the general authorship rule every other session (S01, S04-S08) already
// applies by default. All 19 fields are corrected to true here, and
// dialogue-contract-compiler.ts's ownership resolution now makes this class
// of binding error structurally impossible to reintroduce.
export const TBCT_S03_BINDINGS: WorksheetBinding[] = [
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "situation", worksheetFieldKey: "situation", visualElementId: "box-situation", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Situation", labelKo: "상황", sourceSection: "Q1", displayOrder: 0 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "automaticThought", worksheetFieldKey: "automaticThought", visualElementId: "box-automatic-thought", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Automatic Thought", labelKo: "자동적 사고", sourceSection: "Q2a", displayOrder: 1 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "automaticThoughtBeliefPercent", worksheetFieldKey: "automaticThoughtBeliefPercent", visualElementId: "gauge-at-belief", valueType: "percentage", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "number", label: "Belief in Thought", labelKo: "생각에 대한 믿음 정도", sourceSection: "Q2b", displayOrder: 2 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "primaryEmotion", worksheetFieldKey: "primaryEmotion", visualElementId: "chip-emotion", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Emotion", labelKo: "감정", sourceSection: "Q3", displayOrder: 3 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "primaryEmotionIntensityPercent", worksheetFieldKey: "primaryEmotionIntensityPercent", visualElementId: "gauge-emotion-intensity", valueType: "percentage", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "number", label: "Emotion Intensity", labelKo: "감정 강도", sourceSection: "Q3", displayOrder: 4 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "behavior", worksheetFieldKey: "behavior", visualElementId: "box-behavior", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Behavior", labelKo: "행동", sourceSection: "Q4", displayOrder: 5 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "bodySensations", worksheetFieldKey: "bodySensations", visualElementId: "box-body", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Body Sensations", labelKo: "신체 감각", sourceSection: "Q4", displayOrder: 6 },
  // participant_summary_required in the catalog (source-fidelity-catalog.ts
  // "participant-summary" prompt) -- the one field a prior pass already
  // read correctly as requiring the participant, not the assistant, to
  // produce it. The rule above generalizes this to every field in this file.
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "participantSummary", worksheetFieldKey: "participantSummary", visualElementId: "box-summary", valueType: "long_text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: true, displayMode: "confirmed_summary", label: "Your Summary So Far", labelKo: "지금까지의 요약", sourceSection: "Q4", displayOrder: 7 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "behaviorPros", worksheetFieldKey: "behaviorPros", visualElementId: "note-pros", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Pros of Reacting This Way", labelKo: "이렇게 반응했을 때의 장점", sourceSection: "Q5", displayOrder: 8 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "behaviorCons", worksheetFieldKey: "behaviorCons", visualElementId: "note-cons", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Cons of Reacting This Way", labelKo: "이렇게 반응했을 때의 단점", sourceSection: "Q6", displayOrder: 9 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "cognitiveDistortion", worksheetFieldKey: "cognitiveDistortion", visualElementId: "chip-distortion", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Cognitive Distortion", labelKo: "인지 왜곡", sourceSection: "Q7", displayOrder: 10 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "evidenceFor", worksheetFieldKey: "evidenceFor", visualElementId: "list-evidence-for", valueType: "text_list", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "list", label: "Evidence For", labelKo: "지지하는 근거", sourceSection: "Q8", displayOrder: 11 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "evidenceAgainst", worksheetFieldKey: "evidenceAgainst", visualElementId: "list-evidence-against", valueType: "text_list", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "list", label: "Evidence Against", labelKo: "반대되는 근거", sourceSection: "Q9", displayOrder: 12 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "balancedConclusion", worksheetFieldKey: "balancedConclusion", visualElementId: "box-conclusion", valueType: "long_text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Balanced Conclusion", labelKo: "균형 잡힌 결론", sourceSection: "Q10a", displayOrder: 13 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "conclusionBeliefPercent", worksheetFieldKey: "conclusionBeliefPercent", visualElementId: "gauge-conclusion-belief", valueType: "percentage", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "number", label: "Belief in Conclusion", labelKo: "결론에 대한 믿음 정도", sourceSection: "Q10b", displayOrder: 14 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "intendedActions", worksheetFieldKey: "intendedActions", visualElementId: "list-action-plan", valueType: "text_list", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "list", label: "Intended Actions", labelKo: "하려는 행동", sourceSection: "Q12a", displayOrder: 15 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "newBodySensations", worksheetFieldKey: "newBodySensations", visualElementId: "box-new-body", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Body Now", labelKo: "지금의 신체 감각", sourceSection: "Q12b", displayOrder: 16 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "revisedAutomaticThoughtBeliefPercent", worksheetFieldKey: "revisedAutomaticThoughtBeliefPercent", visualElementId: "gauge-revised-belief", valueType: "percentage", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "number", label: "Belief in Original Thought Now", labelKo: "원래 생각에 대한 지금의 믿음 정도", sourceSection: "Q13", displayOrder: 17 },
  { sessionDefinitionId: "tbct-s03", canonicalFieldKey: "globalEvaluation", worksheetFieldKey: "globalEvaluation", visualElementId: "chip-global-evaluation", valueType: "choice", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "How Am I Now?", labelKo: "지금 나는 어떤가요?", sourceSection: "Q14", displayOrder: 18 },
];
