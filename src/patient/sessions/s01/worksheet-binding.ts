import type { WorksheetBinding } from "@/types/worksheet";

// Session 1 (Introduction to the TBCT Model / CCD Level 1) worksheet
// binding registry -- backs the composed s01-worksheet.tsx (the "recreate
// the figure in real components" approach, not a photo overlay). Every
// canonicalFieldKey here is a real PromptItem.outputFields[0] value from
// source-fidelity-catalog.ts's tbct-s01 spec.
//
// User-facing labels say "Person 1/2/3" (not "Candidate 1/2/3") to match
// the dialogue's own wording -- internal canonicalFieldKey/worksheetFieldKey
// values (candidateOneEmotion, etc.) are NOT renamed; only the label/labelKo
// strings shown to a user changed. See .claude/TASK_SCOPE.json's
// note2026_08_17b entry.
//
// The personal-cycle boxes (displayOrder 12-14) now bind to the discrete
// personalEmotion/personalBehavior/personalBodySensations fields the Opening
// redesign introduced, replacing the old personalThoughtEmotionLink/
// personalEmotionBehaviorLink/personalBehaviorSituationLink "link
// recognition" fields (situation and thought are captured once, in Opening,
// and reused here rather than re-asked -- see s01.ts's personal-returning-arrows
// node).
export const TBCT_S01_BINDINGS: WorksheetBinding[] = [
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "situationThoughtDistinction", worksheetFieldKey: "situationThoughtDistinction", visualElementId: "box-situation", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "My situation", labelKo: "내 상황", sourceSection: "Step 1", displayOrder: 0 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "openingInitialThought", worksheetFieldKey: "openingInitialThought", visualElementId: "box-initial-thought", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "My first thought about it", labelKo: "그때 떠오른 생각", sourceSection: "Step 1", displayOrder: 1 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateOneEmotion", worksheetFieldKey: "candidateOneEmotion", visualElementId: "box-c1-emotion", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 1 · Emotion", labelKo: "사람 1 · 감정", sourceSection: "Step 2", displayOrder: 2 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateOneThought", worksheetFieldKey: "candidateOneThought", visualElementId: "box-c1-thought", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 1 · Thought", labelKo: "사람 1 · 생각", sourceSection: "Step 2", displayOrder: 3 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateOneBehavior", worksheetFieldKey: "candidateOneBehavior", visualElementId: "box-c1-behavior", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 1 · Behavior", labelKo: "사람 1 · 행동", sourceSection: "Step 2", displayOrder: 4 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateTwoEmotion", worksheetFieldKey: "candidateTwoEmotion", visualElementId: "box-c2-emotion", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 2 · Emotion", labelKo: "사람 2 · 감정", sourceSection: "Step 2", displayOrder: 5 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateTwoThought", worksheetFieldKey: "candidateTwoThought", visualElementId: "box-c2-thought", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 2 · Thought", labelKo: "사람 2 · 생각", sourceSection: "Step 2", displayOrder: 6 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateTwoBehavior", worksheetFieldKey: "candidateTwoBehavior", visualElementId: "box-c2-behavior", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 2 · Behavior", labelKo: "사람 2 · 행동", sourceSection: "Step 2", displayOrder: 7 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateThreeEmotion", worksheetFieldKey: "candidateThreeEmotion", visualElementId: "box-c3-emotion", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 3 · Emotion", labelKo: "사람 3 · 감정", sourceSection: "Step 2", displayOrder: 8 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateThreeThought", worksheetFieldKey: "candidateThreeThought", visualElementId: "box-c3-thought", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 3 · Thought", labelKo: "사람 3 · 생각", sourceSection: "Step 2", displayOrder: 9 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "candidateThreeBehavior", worksheetFieldKey: "candidateThreeBehavior", visualElementId: "box-c3-behavior", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Person 3 · Behavior", labelKo: "사람 3 · 행동", sourceSection: "Step 2", displayOrder: 10 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "threePersonModelInsight", worksheetFieldKey: "threePersonModelInsight", visualElementId: "box-insight", valueType: "long_text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "What the three-person example showed me", labelKo: "세 사람 예시를 통해 알게 된 것", sourceSection: "Step 2", displayOrder: 11 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "personalEmotion", worksheetFieldKey: "personalEmotion", visualElementId: "box-personal-emotion", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "My emotion", labelKo: "내 감정", sourceSection: "Step 3", displayOrder: 12 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "personalBehavior", worksheetFieldKey: "personalBehavior", visualElementId: "box-personal-behavior", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "My behavior", labelKo: "내 행동", sourceSection: "Step 3", displayOrder: 13 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "personalBodySensations", worksheetFieldKey: "personalBodySensations", visualElementId: "box-personal-body", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "My body", labelKo: "내 몸의 반응", sourceSection: "Step 3", displayOrder: 14 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "participantSummary", worksheetFieldKey: "participantSummary", visualElementId: "box-summary", valueType: "long_text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: true, displayMode: "confirmed_summary", label: "My summary", labelKo: "내 요약", sourceSection: "Step 4", displayOrder: 15 },
  { sessionDefinitionId: "tbct-s01", canonicalFieldKey: "participantSelectedDistortions", worksheetFieldKey: "participantSelectedDistortions", visualElementId: "chip-distortions", valueType: "text_list", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "list", label: "Distortions I recognized", labelKo: "내가 알아차린 인지 왜곡", sourceSection: "Step 5", displayOrder: 16 },
];
