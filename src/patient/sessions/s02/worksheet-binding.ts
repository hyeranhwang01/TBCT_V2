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
  {
    // CD-Quest score per pattern, index-matched to distortionExamples
    // (note2026_09_21_s02_cognitive_distortions, stage 2). Written by
    // s02/turn-rules.ts, not by the prompt: the scoring prompt's output field is
    // the single item score, because a field named in outputFields is
    // overwritten with the raw answer text by the shared extraction.
    sessionDefinitionId: "tbct-s02",
    canonicalFieldKey: "cdQuestScores",
    worksheetFieldKey: "cdQuestScores",
    visualElementId: "chip-cdquest-scores",
    valueType: "text_list",
    participantOwned: true,
    assistantMustNotSupply: true,
    confirmationRequired: false,
    displayMode: "list",
    label: "Scores",
    labelKo: "점수",
    sourceSection: "CD-Quest",
    displayOrder: 1,
  },
  {
    // The score's two halves. Bound rather than passed through as runtime
    // fields so the worksheet needs no extra prop on the shared
    // ComposedWorksheetProps -- and so a clinician reading the worksheet can
    // see what a score was built from.
    sessionDefinitionId: "tbct-s02",
    canonicalFieldKey: "cdQuestFrequency",
    worksheetFieldKey: "cdQuestFrequency",
    visualElementId: "list-cdquest-frequency",
    valueType: "text_list",
    participantOwned: true,
    assistantMustNotSupply: true,
    confirmationRequired: false,
    displayMode: "list",
    label: "How often",
    labelKo: "빈도",
    sourceSection: "CD-Quest",
    displayOrder: 2,
  },
  {
    sessionDefinitionId: "tbct-s02",
    canonicalFieldKey: "cdQuestIntensity",
    worksheetFieldKey: "cdQuestIntensity",
    visualElementId: "list-cdquest-intensity",
    valueType: "text_list",
    participantOwned: true,
    assistantMustNotSupply: true,
    confirmationRequired: false,
    displayMode: "list",
    label: "How strongly",
    labelKo: "강도",
    sourceSection: "CD-Quest",
    displayOrder: 3,
  },
  {
    // Computed by s02/turn-rules.ts when the fifteenth score lands, so it is
    // system-owned and projects as system_calculated.
    sessionDefinitionId: "tbct-s02",
    canonicalFieldKey: "cdQuestTotal",
    worksheetFieldKey: "cdQuestTotal",
    visualElementId: "chip-cdquest-total",
    valueType: "integer",
    participantOwned: false,
    assistantMustNotSupply: false,
    confirmationRequired: false,
    displayMode: "number",
    label: "Total",
    labelKo: "총점",
    sourceSection: "CD-Quest",
    displayOrder: 4,
  },
];
