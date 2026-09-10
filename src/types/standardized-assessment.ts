// Standardized clinical screening check-ins -- see
// src/shared/standardized-assessments/instruments.ts for item text/scoring
// (PHQ-9, GAD-7) and sql/011_standardized_assessments.sql for the schema.

export type StandardizedInstrumentId = "phq9" | "gad7";

export type SeverityBand = "minimal" | "mild" | "moderate" | "moderately_severe" | "severe";

export interface StandardizedAssessmentResponse {
  id: string;
  participantId: string;
  instrument: StandardizedInstrumentId;
  /** One 0-3 answer per item, in item order -- see the instrument's own
   * `items` array for what each index means. */
  answers: number[];
  totalScore: number;
  severity: SeverityBand;
  /** True only for PHQ-9 when item 9 (self-harm ideation) scored > 0 --
   * see submitStandardizedAssessment's own doc comment for what this
   * triggers. Absent for GAD-7, which has no equivalent item. */
  selfHarmFlag?: boolean;
  submittedAt: string;
  createdAt: string;
}
