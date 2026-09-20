import type { WorksheetBinding } from "@/types/worksheet";

// Session 2 (Cognitive Distortions) worksheet binding
// (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions).
//
// One field: distortionExamples, a list with one row per pattern in the order
// of shared/protocol/cognitive-distortions.ts. The row is the participant's own
// example for that pattern, or the empty marker when nothing came to mind, so
// the row count is also how far the walkthrough has got.
//
// participantOwned + assistantMustNotSupply: the guide never writes an example
// on their behalf and never decides which pattern an example belongs to.
//
// The CCPH/CCGH bindings this file used to carry (problems, problemRatings,
// goals, goalRatings, totalProblemScore, totalGoalsScore) are gone with the
// session that used them. Those field NAMES remain elsewhere in the codebase --
// the clinician progress view, the homework UI and the score aggregation read
// them as raw strings -- and are deliberately left alone.
export const TBCT_S02_BINDINGS: WorksheetBinding[] = [
  {
    sessionDefinitionId: "tbct-s02",
    canonicalFieldKey: "distortionExamples",
    worksheetFieldKey: "distortionExamples",
    visualElementId: "list-distortion-examples",
    valueType: "text_list",
    participantOwned: true,
    assistantMustNotSupply: true,
    confirmationRequired: false,
    displayMode: "list",
    label: "My examples",
    labelKo: "내 예시",
    sourceSection: "Cognitive Distortions List",
    displayOrder: 0,
  },
];
