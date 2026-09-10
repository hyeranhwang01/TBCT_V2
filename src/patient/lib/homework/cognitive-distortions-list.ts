// Verbatim from the TBCT source manual's "Cognitive Distortions Reference
// List" (Chapters 16-17; see src/lib/protocol/tbct-source-text.generated.ts
// lines ~203-220), reused here for S1's "Weekly Examples" homework so the
// participant picks a distortion for each new example from the SAME list
// introduced in Session 1 -- Claude/the app never selects it for them.
export interface CognitiveDistortion {
  id: number;
  name: string;
  definition: string;
}

export const COGNITIVE_DISTORTIONS: CognitiveDistortion[] = [
  { id: 1, name: "Dichotomous thinking (all-or-nothing)", definition: "Viewing a situation, person, or event in only all-or-nothing terms, without a continuum" },
  { id: 2, name: "Fortune telling (catastrophizing)", definition: "Predicting the future in negative terms and believing it will be so awful as to be unbearable" },
  { id: 3, name: "Discounting or disqualifying the positive", definition: "Disqualifying positive experiences or events, insisting they do not count" },
  { id: 4, name: "Emotional reasoning", definition: "Believing emotions reflect reality and letting them guide attitudes and judgments" },
  { id: 5, name: "Labeling", definition: "Putting a fixed, global, usually negative label on oneself or others" },
  { id: 6, name: "Magnification / minimization", definition: "Evaluating situations by magnifying negatives and/or minimizing positives" },
  { id: 7, name: "Selective abstraction (mental filter)", definition: "Paying attention to one or a few details and failing to see the whole picture" },
  { id: 8, name: "Mind reading", definition: "Believing one knows the thoughts or intentions of others without sufficient evidence" },
  { id: 9, name: "Overgeneralization", definition: "Taking isolated cases and generalizing widely using \"always,\" \"never,\" \"everyone\"" },
  { id: 10, name: "Personalizing", definition: "Assuming others' behaviors concern oneself without considering other explanations" },
  { id: 11, name: "Should statements", definition: "Telling oneself that events \"should\" be as expected rather than as they are" },
  { id: 12, name: "Jumping to conclusions", definition: "Drawing conclusions from little or no confirmatory evidence" },
  { id: 13, name: "Blaming", definition: "Directing attention to others as sources of negative feelings, or taking responsibility for others' behaviors" },
  { id: 14, name: "What if?", definition: "Persistently asking \"what if something happens?\"" },
  { id: 15, name: "Unfair comparisons", definition: "Comparing oneself with others who seem to do better, placing oneself at a disadvantage" },
];
