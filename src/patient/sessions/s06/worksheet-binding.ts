import type { WorksheetBinding } from "@/types/worksheet";

// Session 6 (Color-Coded Symptoms Hierarchy / CCSH) worksheet binding
// registry. symptomItems is an array; symptomItemScores is the parallel
// 0-5 array (same color scale as S02's CCPH). greenHomeworkItems is the
// participant-chosen 2-3 item subset -- the runtime already enforces
// TBCT-S06-NO-YELLOW-RED-HOMEWORK, so this binding is descriptive, not a
// second gate.
export const TBCT_S06_BINDINGS: WorksheetBinding[] = [
  { sessionDefinitionId: "tbct-s06", canonicalFieldKey: "symptomItems", worksheetFieldKey: "symptomItems", visualElementId: "list-symptoms", valueType: "text_list", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "list", label: "Situations", labelKo: "상황 목록", sourceSection: "Step 1", displayOrder: 0 },
  { sessionDefinitionId: "tbct-s06", canonicalFieldKey: "symptomItemScores", worksheetFieldKey: "symptomItemScores", visualElementId: "chip-symptom-scores", valueType: "text_list", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "list", label: "Scores", labelKo: "점수", sourceSection: "Step 2", displayOrder: 1 },
  { sessionDefinitionId: "tbct-s06", canonicalFieldKey: "greenHomeworkItems", worksheetFieldKey: "greenHomeworkItems", visualElementId: "chip-green-items", valueType: "text_list", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "list", label: "This week's practice (green only)", labelKo: "이번 주 연습 항목 (초록만)", sourceSection: "Step 4", displayOrder: 2 },
  { sessionDefinitionId: "tbct-s06", canonicalFieldKey: "accountabilityPartner", worksheetFieldKey: "accountabilityPartner", visualElementId: "box-partner", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Accountability partner", labelKo: "함께할 사람", sourceSection: "Step 4", displayOrder: 3 },
  { sessionDefinitionId: "tbct-s06", canonicalFieldKey: "fallbackPlan", worksheetFieldKey: "fallbackPlan", visualElementId: "box-fallback", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "Plan B", labelKo: "대안 계획", sourceSection: "Step 4", displayOrder: 4 },
  { sessionDefinitionId: "tbct-s06", canonicalFieldKey: "safetyBehaviors", worksheetFieldKey: "safetyBehaviors", visualElementId: "chip-safety-behaviors", valueType: "text_list", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "list", label: "Safety behaviors I've noticed", labelKo: "내가 알아차린 안전행동", sourceSection: "Step 7", displayOrder: 5 },
  { sessionDefinitionId: "tbct-s06", canonicalFieldKey: "underlyingAssumption", worksheetFieldKey: "underlyingAssumption", visualElementId: "box-assumption", valueType: "text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: false, displayMode: "verbatim", label: "My underlying assumption (\"If...then...\")", labelKo: "내 기저 가정 (\"만약... 그러면...\")", sourceSection: "Step 7", displayOrder: 6 },
  { sessionDefinitionId: "tbct-s06", canonicalFieldKey: "circuitTwoSummary", worksheetFieldKey: "circuitTwoSummary", visualElementId: "box-circuit-summary", valueType: "long_text", participantOwned: true, assistantMustNotSupply: true, confirmationRequired: true, displayMode: "confirmed_summary", label: "My summary", labelKo: "내 요약", sourceSection: "Step 7", displayOrder: 7 },
];
