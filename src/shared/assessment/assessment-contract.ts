import { z } from "zod";

export const assessmentProviderNames = ["groq", "ollama", "gemini", "deterministic"] as const;
export type AssessmentProviderName = typeof assessmentProviderNames[number];

export const assessmentRequestSchema = z.object({
  locale: z.string().min(1), inputType: z.string().min(1), patientInput: z.string(), nodeGoal: z.string().min(1),
  expectedAnswerDescription: z.string().optional(), allowedFields: z.array(z.string()), allowedTransitions: z.array(z.string()), safetyCategories: z.array(z.string()),
});
// Phase 2 (runtime orchestration simplification): an OPTIONAL disposition,
// alongside the existing `intent`, for prompts that collect an open-ended
// list (S02's problems/goals today; any future open-list collection prompt
// could reuse it). `intent` alone can't express "the participant says the
// list is complete" (collection_stop) -- that's a different dimension from
// "what kind of speech act is this relative to the active question", which
// is what `intent` already captures. Optional so providers/callers that
// don't need list-collection semantics are unaffected; when a provider
// (including the deterministic fallback) doesn't populate it, callers fall
// back to deriving an equivalent from `intent`/`inputValid` -- see
// runtime-input-assessment.ts's deriveS02CollectionTurnAction.
// Phase 3 (runtime orchestration simplification): "current_item_correction"
// extends the same disposition for a different prompt shape -- rating a
// list one item at a time (S02's problemRatings/goalRatings today). The
// participant isn't answering the rating question; they're asserting the
// item currently being rated isn't a valid problem/goal at all (wrong
// construct, duplicate, or was never meant as an item -- the runtime action
// is the same in every case: remove it, don't record a rating). Deliberately
// NOT split into reject/duplicate/wrong-construct sub-actions -- see
// runtime-context.ts's applyCurrentRatingItemCorrection, which only ever
// does one thing regardless of the participant's stated reason.
export const turnActionSchema = z.enum(["accept_answer", "clarification_request", "collection_stop", "unresolved", "current_item_correction"]);
export type TurnAction = z.infer<typeof turnActionSchema>;

export const assessmentResultSchema = z.object({
  inputValid: z.boolean(), relevance: z.enum(["relevant", "partially_relevant", "irrelevant", "unclear"]),
  intent: z.enum(["answer", "clarification_request", "refusal", "topic_shift", "distress_disclosure", "other"]),
  extractedFields: z.record(z.unknown()), completionStatus: z.enum(["complete", "incomplete", "needs_clarification"]),
  safetyLevel: z.enum(["none", "low", "moderate", "high", "critical"]), safetySignals: z.array(z.string()),
  recommendedTransition: z.string().nullable(), internalSummary: z.string().nullable(),
  turnAction: turnActionSchema.optional(),
}).strict();
export type AssessmentRequest = z.infer<typeof assessmentRequestSchema>;
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;
export type AssessmentProviderHealth = { ok: boolean; provider: AssessmentProviderName; model?: string; message?: string };
export type AssessmentProviderMetadata = { provider: AssessmentProviderName; model?: string; privacyBoundary: "local" | "cloud" | "none" };
export interface AssessmentModel {
  assessInput(request: AssessmentRequest): Promise<AssessmentResult>;
  healthCheck(): Promise<AssessmentProviderHealth>;
  getProviderMetadata(): AssessmentProviderMetadata;
}

export function sanitizeAssessmentResult(raw: unknown, request: AssessmentRequest): AssessmentResult {
  const parsed = assessmentResultSchema.parse(raw);
  const allowed = new Set(request.allowedFields);
  const extractedFields = Object.fromEntries(Object.entries(parsed.extractedFields).filter(([field]) => allowed.has(field)));
  const recommendedTransition = parsed.recommendedTransition && request.allowedTransitions.includes(parsed.recommendedTransition) ? parsed.recommendedTransition : null;
  const supportedFields = request.allowedFields.filter((field) => extractedFields[field] !== undefined && extractedFields[field] !== "");
  const completionStatus = request.allowedFields.length > 1
    ? supportedFields.length === request.allowedFields.length
      ? "complete" as const
      : supportedFields.length > 0
        ? "incomplete" as const
        : "needs_clarification" as const
    : parsed.completionStatus;
  return { ...parsed, extractedFields, recommendedTransition, completionStatus };
}
