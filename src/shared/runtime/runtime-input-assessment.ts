import { getAssessmentModel } from "@/shared/assessment/assessment-providers";
import { assessmentResultSchema, type AssessmentRequest } from "@/shared/assessment/assessment-contract";
import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { PatientInput } from "@/types/runtime-session";
import { runtimeFetch } from "@/shared/runtime/resolve-store-url";

type TurnAction = "accept_answer" | "clarification_request" | "collection_stop" | "unresolved" | "current_item_correction";
type InputAssessmentResult = { accepted: boolean; confidence: number; reason: "meaningful_response" | "needs_clarification"; extractedFields?: Record<string, unknown>; safetyLevel?: "none" | "low" | "moderate" | "high" | "critical"; safetySignals?: string[]; intent?: "answer" | "clarification_request" | "refusal" | "topic_shift" | "distress_disclosure" | "other"; turnAction?: TurnAction; error?: string };

/**
 * S02's problems/goals collection is the one open-ended-list prompt shape
 * this runtime currently has, and the only consumer of the optional
 * turnAction disposition (see assessment-contract.ts's turnActionSchema).
 * Named explicitly (not an inline field-name check at the call site) so the
 * "why does this field need semantic interpretation" intent is legible where
 * it's decided, not buried in a boolean expression.
 */
export function isS02CollectionField(input: { promptItem?: PromptItem; field: string }) {
  return input.promptItem?.sessionId === "tbct-s02" && (input.field === "problems" || input.field === "goals");
}

/**
 * Falls back to an equivalent derived from the always-present `intent`/
 * `accepted` when the provider didn't populate `turnAction` directly (e.g. a
 * cloud provider that hasn't been prompted for this session's guidance yet,
 * or an older cached response). "collection_stop" has no equivalent in
 * `intent` -- if the provider didn't say collection_stop explicitly, this
 * fallback can never invent it, which is the correct conservative default
 * for a signal that removes text from a growing list rather than merely
 * skipping it.
 */
export function deriveS02CollectionTurnAction(assessment: Pick<InputAssessmentResult, "turnAction" | "intent" | "accepted">): TurnAction {
  if (assessment.turnAction) return assessment.turnAction;
  if (assessment.intent === "clarification_request") return "clarification_request";
  if (assessment.intent === "topic_shift" || assessment.intent === "other") return "unresolved";
  return assessment.accepted ? "accept_answer" : "unresolved";
}

/**
 * Phase 3: the rating-one-item-at-a-time equivalent of
 * isS02CollectionField/deriveS02CollectionTurnAction above, for
 * problemRatings/goalRatings. Named explicitly for the same legibility
 * reason. Not gated on sessionId the way isS02CollectionField is, since
 * these two field names are already S02-exclusive (verified: no other
 * session's catalog uses them) and the field name alone is what
 * distinguishes "rate this one item" from every other rating-kind prompt.
 */
export function isS02RatingCorrectionField(field: string) {
  return field === "problemRatings" || field === "goalRatings";
}

/**
 * "current_item_correction" has no equivalent in the generic `intent` enum
 * (like "collection_stop", nothing there names it), so a provider that
 * doesn't populate turnAction can never have this fallback invent a
 * correction -- the conservative default is to treat the turn as an
 * ordinary rating attempt (or ask again, if intent itself is unclear/
 * clarification-shaped), never to silently remove an item.
 */
export function deriveS02RatingTurnAction(assessment: Pick<InputAssessmentResult, "turnAction" | "intent" | "accepted">): TurnAction {
  if (assessment.turnAction) return assessment.turnAction;
  if (assessment.intent === "clarification_request") return "clarification_request";
  if (assessment.intent === "topic_shift" || assessment.intent === "other") return "unresolved";
  return assessment.accepted ? "accept_answer" : "unresolved";
}

/**
 * validation.kind values whose whole clinical point is "did the patient
 * articulate a specific realization in their own words" rather than "did
 * they answer something" -- e.g. distinguishing a situation from a thought,
 * recognizing an interpersonal feedback loop, naming their own leverage
 * point, or summarizing a step back accurately. The catalog already tags
 * these prompts this way; before this, the single-field shortcut below
 * skipped semantic assessment for every one of them, so a generic non-answer
 * ("one clear example from this week") could satisfy a completion gate that
 * was specifically meant to check for a real insight.
 */
const INSIGHT_VALIDATION_KINDS = new Set([
  "participant_articulated_distinction",
  "recognition_required",
  "own_behavior_leverage_required",
  "participant_summary_required",
  "participant_generated_core_belief",
  "participant_owned_text",
]);

export function requiresSemanticInputAssessment(input: { patientInput: PatientInput; promptItem?: PromptItem; field: string }) {
  if (input.patientInput.kind !== "text" || typeof input.patientInput.value !== "string" || !input.promptItem) return false;
  if ((input.field === "evidenceFor" || input.field === "evidenceAgainst") && /^(?:none|nothing else|no more|more none|\uC5C6\uC5B4\uC694)$/i.test(input.patientInput.value.trim())) return false;
  if (/\b(?:disappear(?: forever)?|everything to end|all of this to end|not wake up|better off without me|better off dead|no reason to live|say(?:ing)? goodbye|can(?:not|'t) go on|cannot cope|hopeless|desperate)\b/i.test(input.patientInput.value)) return true;
  const validationKind = typeof (input.promptItem.validation as { kind?: unknown } | null)?.kind === "string"
    ? String((input.promptItem.validation as { kind: string }).kind)
    : "";
  // Phase 2 (runtime orchestration simplification): S02's problems/goals are
  // ordinary single-output-field "array" kind prompts, so the shortcut just
  // below would otherwise skip semantic assessment for them entirely
  // (INSIGHT_VALIDATION_KINDS doesn't include "array") -- these are exactly
  // the S02 clinical collection fields that need "is this a real
  // problem/goal candidate?" judged, unlike an ordinary verbatim single-field
  // prompt (a plain free-text reflection) where the shortcut below is still
  // correct and untouched for every other field/session.
  if (isS02CollectionField(input)) return true;
  // Ordinary single-field free-text questions are recorded verbatim after the
  // local meaningful-text check. They do not need a cloud model to decide that
  // "I'm doing well" is a valid candidate thought -- except the insight-style
  // checkpoints above, where "did they answer something" isn't the same
  // question as "did they reach the specific realization this step exists for".
  if (input.promptItem.outputFields.length <= 1) return INSIGHT_VALIDATION_KINDS.has(validationKind);
  return !["boolean", "enum", "rating"].includes(validationKind);
}

export async function assessRuntimePatientInput(input: { patientInput: PatientInput; promptItem: PromptItem; locale?: string }): Promise<InputAssessmentResult> {
  try {
    const allowedFields = input.promptItem.requiredFields?.length ? input.promptItem.requiredFields : input.promptItem.outputFields;
    const request: AssessmentRequest = { locale: input.locale ?? "en-US", inputType: input.promptItem.type, patientInput: String(input.patientInput.value), nodeGoal: input.promptItem.editableText || input.promptItem.verbatimText || "Assess relevance to the active question", expectedAnswerDescription: input.promptItem.modelGuidance || input.promptItem.aiInstruction || undefined, allowedFields, allowedTransitions: [], safetyCategories: input.promptItem.safetyRuleIds };
    const result = typeof window === "undefined" || process.env.NODE_ENV === "test"
      ? await getAssessmentModel().assessInput(request)
      : await (async () => { const response = await runtimeFetch("/api/assessment/input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }); const payload = await response.json().catch(() => null); if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? "Assessment failed"); return assessmentResultSchema.parse(payload.data); })();
    // A partially complete answer can still contain valid clinical fields. Keep
    // those fields and let runtime-context identify exactly what remains missing.
    // Previously, needs_clarification discarded every extracted field and caused
    // the same generic prompt to be repeated.
    const accepted = result.inputValid && result.relevance !== "irrelevant";
    // Surface the model's classified intent (this is what already lets it
    // recognize "the patient wants to stop" or "the patient is disclosing
    // distress" in whatever language the session runs in, via the same
    // locale-aware assessment used for every other field) -- previously this
    // was computed by the model but discarded here, so callers had no way to
    // act on a refusal/distress-disclosure intent that wasn't also caught by
    // the English-only isExplicitPatientRefusal keyword check.
    return { accepted, confidence: result.relevance === "relevant" ? 0.9 : 0.6, reason: accepted ? "meaningful_response" : "needs_clarification", extractedFields: result.extractedFields, safetyLevel: result.safetyLevel, safetySignals: result.safetySignals, intent: result.intent, turnAction: result.turnAction };
  } catch (error) {
    return { accepted: false, confidence: 0, reason: "needs_clarification", error: error instanceof Error ? error.message : "Input assessment failed" };
  }
}
