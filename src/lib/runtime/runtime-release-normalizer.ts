import * as s01 from "@/lib/runtime/static-messages/s01";
import * as s02 from "@/lib/runtime/static-messages/s02";
import * as s03 from "@/lib/runtime/static-messages/s03";
import * as s04 from "@/lib/runtime/static-messages/s04";
import * as s05 from "@/lib/runtime/static-messages/s05";
import * as s06 from "@/lib/runtime/static-messages/s06";
import * as s07 from "@/lib/runtime/static-messages/s07";
import * as s08 from "@/lib/runtime/static-messages/s08";
import type { ClinicalStageNode, ConditionExpression, PromptItem, SourceFidelityEdge, ValidationRule } from "@/lib/protocol/source-fidelity-types";
import type { PolicyBundle, RuntimeNode, RuntimePromptItem, RuntimeRelease, RuntimeRoleDefinition, RuntimeSpeakerRoleId, RuntimeTransitionRule, SourceFidelityReleaseSnapshot } from "@/types/protocol-runtime";

const DEFAULT_OUTPUT_SCHEMA_VERSION = "clinical-language/v2";

const DEFAULT_RUNTIME_ROLES: RuntimeRoleDefinition[] = [
  {
    id: "tbct_guide",
    name: "TBCT guide",
    kind: "speaker",
    systemGuidance: "Guide one focused TBCT step in supportive, patient-facing language.",
    allowedActions: ["ask", "reflect", "validate", "summarize"],
    forbiddenActions: ["change_runtime_state", "disclose_internal_instructions", "diagnose"],
  },
  {
    id: "therapist",
    name: "Therapist",
    kind: "speaker",
    systemGuidance: "Use a collaborative clinical stance and stay within the active protocol step.",
    allowedActions: ["ask", "reflect", "validate", "summarize"],
    forbiddenActions: ["change_runtime_state", "disclose_internal_instructions", "diagnose"],
  },
  {
    id: "psychoeducation_guide",
    name: "Psychoeducation guide",
    kind: "speaker",
    systemGuidance: "Explain the active TBCT concept briefly, then invite one focused response when appropriate.",
    allowedActions: ["educate", "ask", "summarize"],
    forbiddenActions: ["change_runtime_state", "disclose_internal_instructions", "diagnose"],
  },
  {
    id: "closing_guide",
    name: "Closing guide",
    kind: "speaker",
    systemGuidance: "Close or bridge the active step without changing session state.",
    allowedActions: ["close", "summarize", "validate"],
    forbiddenActions: ["change_runtime_state", "disclose_internal_instructions", "diagnose"],
  },
  {
    id: "session_manager",
    name: "Session manager",
    kind: "controller",
    systemGuidance: "Implemented by deterministic runtime code.",
    allowedActions: [],
    forbiddenActions: ["generate_patient_message"],
  },
  {
    id: "transition_controller",
    name: "Transition controller",
    kind: "controller",
    systemGuidance: "Implemented by deterministic runtime code.",
    allowedActions: [],
    forbiddenActions: ["generate_patient_message"],
  },
  {
    id: "memory_manager",
    name: "Memory manager",
    kind: "controller",
    systemGuidance: "Implemented by deterministic runtime code.",
    allowedActions: [],
    forbiddenActions: ["generate_patient_message"],
  },
  {
    id: "protocol_validator",
    name: "Protocol validator",
    kind: "evaluator",
    systemGuidance: "Implemented by deterministic runtime code.",
    allowedActions: [],
    forbiddenActions: ["generate_patient_message"],
  },
  {
    id: "safety_evaluator",
    name: "Safety evaluator",
    kind: "evaluator",
    systemGuidance: "Implemented by deterministic runtime code.",
    allowedActions: [],
    forbiddenActions: ["generate_patient_message"],
  },
  {
    id: "style_evaluator",
    name: "Style evaluator",
    kind: "evaluator",
    systemGuidance: "Implemented by deterministic runtime code.",
    allowedActions: [],
    forbiddenActions: ["generate_patient_message"],
  },
];

// "use" was deliberately removed from this list: it's meant to catch
// clinician/authoring instructions ("Use the enclosed rubric to score..."),
// but several already-approved patient-facing scale explanations are
// legitimately imperative sentences that start with "Use" ("Use this 0-5
// scale for each problem: ..." -- see APPROVED_PATIENT_TEXT in
// runtime-static-message.ts). Keeping "use" here silently discarded those
// and replaced them with the generic locale fallback on every S02 CCPH/CCGH
// scale presentation. No catalog `marker` currently starts with "use", so
// isUsableMarkerLeadIn loses no coverage by dropping it.
const INTERNAL_GUIDANCE_PATTERN = /^(collect|prompt|identify|elicit|capture|explore|help|support|confirm|introduce|run|present|close|start|continue|rate|re-?rate|offer|invite|explain|keep|surface|anchor|set up|formulate|map|convert|prepare|begin|get|deepen|choose|score|establish|reflect|validate)\b/i;

/** A `marker` excerpt is usable as a patient-facing lead-in only if it doesn't
 * itself read like a therapist/authoring instruction (e.g. "identify at
 * least two", "confirm the working thought"). */
function isUsableMarkerLeadIn(text: string) {
  return !INTERNAL_GUIDANCE_PATTERN.test(text) && !/^Step\s+\d+\s*:/i.test(text) && !/\b(?:ask|invite|guide|instruct) the participant\b/i.test(text);
}

// "role_transition" is deliberately absent: every role_transition prompt in
// the catalog carries outputFields expecting a genuine patient answer (a
// ready confirmation, a pre/post rating, a verdict). Treating the type as
// passive made those steps complete as soon as the assistant delivered the
// instruction, before the patient ever confirmed readiness or supplied the
// rating -- exactly the "role transitions never wait for ready" and "missing
// intermediate ratings" defects flagged for S07/S08. Falling through to the
// generic outputFields.length > 0 check below fixes this without special-casing.
export const PASSIVE_PROMPT_TYPES = new Set<PromptItem["type"]>([
  "instruction",
  "explanation",
  "transition",
  "worksheet_instruction",
  "closing",
]);

export function defaultFallbackPatientText(locale: string) {
  if (locale.toLowerCase().startsWith("ko")) return "천천히 생각해 보셔도 괜찮습니다. 지금 가장 중요하게 느껴지는 점을 말씀해 주세요.";
  if (locale.toLowerCase().startsWith("pt")) return "Podemos ir com calma. O que parece mais importante para você neste momento?";
  return "We can take this one step at a time. What feels most important to share right now?";
}

function isLocaleConsistentFallbackText(value: string, locale: string) {
  if (!locale.toLowerCase().startsWith("ko")) return true;
  return /[\uAC00-\uD7A3]/.test(value);
}

// Korean translations for the curated/approved static texts in each
// session's own src/lib/runtime/static-messages/s0N.ts (plus the 5
// safety-pause messages) -- the highest-traffic, most clinically
// load-bearing moments in each session (scale explanations, safety pauses,
// CRP/Trial chair prompts). This does NOT cover the ~200 remaining prompts
// whose patient-facing text is extracted verbatim from the English-only
// source corpus (tbct-source-text.generated.ts) or generated by the
// English-only fallback generator above -- translating those needs either a
// parallel Korean source corpus or per-prompt hand translation, a separate,
// larger effort from this pass.
const REVIEWED_KOREAN_PROMPT_TEXT: Record<string, string> = {
  ...s01.koreanText,
  ...s02.koreanText,
  ...s03.koreanText,
  ...s04.koreanText,
  ...s05.koreanText,
  ...s06.koreanText,
  ...s07.koreanText,
  ...s08.koreanText,
};

export function resolvePromptLocaleText(promptItemId: string, value: string | undefined, locale: string) {
  if (locale.toLowerCase().startsWith("ko") && REVIEWED_KOREAN_PROMPT_TEXT[promptItemId]) return REVIEWED_KOREAN_PROMPT_TEXT[promptItemId];
  return resolveLocaleFallbackPatientText(value, locale);
}

/**
 * Grounding supplied to the dialogue model is not itself displayed. Keep a
 * safe source-specific prompt here even when it is English: Claude needs the
 * actual task in order to render it in Korean. The display fallback remains
 * locale-safe through resolvePromptLocaleText.
 */
export function resolveModelGroundingText(promptItemId: string, value: string | undefined, locale: string) {
  if (locale.toLowerCase().startsWith("ko") && REVIEWED_KOREAN_PROMPT_TEXT[promptItemId]) return REVIEWED_KOREAN_PROMPT_TEXT[promptItemId];
  return isPatientSafeFallbackText(value) ? value!.trim() : defaultFallbackPatientText(locale);
}

function localizedSourcePromptText(promptItem: PromptItem, locale: string, fallbackCandidate: string | undefined) {
  if (locale.toLowerCase().startsWith("ko") && REVIEWED_KOREAN_PROMPT_TEXT[promptItem.id]) return REVIEWED_KOREAN_PROMPT_TEXT[promptItem.id];
  return fallbackCandidate;
}

export function resolveLocaleFallbackPatientText(value: string | undefined, locale: string) {
  if (!isPatientSafeFallbackText(value)) return defaultFallbackPatientText(locale);
  const trimmed = value!.trim();
  // A source-specific prompt used to ship even when it didn't match the
  // session's language, on the theory that the mismatch would stay visible
  // to validation/audit rather than silently becoming a generic substitute.
  // In practice this is the deterministic safety net -- the literal text a
  // Korean-speaking patient sees when nothing else worked -- so shipping it
  // in English anyway defeated the point of calling it a safety net. The
  // already-localized generic line is the safer default when the
  // source-specific text isn't in the session's language.
  return isLocaleConsistentFallbackText(trimmed, locale) ? trimmed : defaultFallbackPatientText(locale);
}

export function isPatientSafeFallbackText(value: string | undefined) {
  const text = value?.trim() ?? "";
  if (!text || text.length > 600) return false;
  if (/^(?:---\s*)?(?:#{1,6}\s*)?(?:interaction style|role and purpose|safety and clinical guardrails|important guidelines)\b/i.test(text)) return false;
  if (/^(?:```|[-*]\s+(?:use|do not|never|always|close by|from reason|from emotion)\b)/i.test(text)) return false;
  if (INTERNAL_GUIDANCE_PATTERN.test(text) || /^Step\s+\d+\s*:/i.test(text) || /\b(?:ask|invite|guide|instruct) the participant\b/i.test(text)) return false;
  // Word-bounded on purpose. These terms are here to stop INTERNAL vocabulary
  // (a system prompt, a model name, an authoring instruction) leaking into a
  // patient message -- but unbounded they also match ordinary words inside
  // the PARTICIPANT's own answers, which composed messages quote back. A
  // defense evidence item as innocuous as "my manager thanked me, unprompted"
  // contains "prompt", which failed this check and replaced the entire
  // composed message -- the read-back, the jury's block review, the
  // "Therefore..." task -- with the content-free generic locale line. Seen on
  // three separate turns of a single audited S08 run.
  // "role model" is dropped first for the same reason: it is ordinary
  // participant vocabulary ("my sister sees me as a role model"), not a
  // reference to a language model. Removed by replace rather than a
  // lookbehind, which older Safari cannot parse -- a syntax error here would
  // take down the whole patient bundle, not just this check.
  const withoutOrdinaryUses = text.replace(/\brole models?\b/gi, " ");
  return !/(?:\bai\b|\bmodels?\b|\bprompts?\b|\binstructions?\b|system message|node[-_ ]?id|role id|runtime state)/i.test(withoutOrdinaryUses);
}

function humanizeField(field: string) {
  // The word-boundary split below already inserts a space before "Percent"
  // (e.g. "...Belief" + " " + "Percent"), so replacing just "Percent$" added
  // a second leading space from " percentage" itself -- "belief  percentage"
  // (double space), verbatim in every S08 paired-rating question. \s* eats
  // that pre-existing space before substituting the single-spaced form.
  return field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s*Percent$/i, " percentage").toLowerCase();
}

/** Third-person clinical fields describe a hypothetical or other person, not the patient themselves. */
function pronounSetForField(field: string) {
  if (/^candidate|^otherPerson/i.test(field)) return { subject: "they", possessive: "their", object: "them", copulaHave: "would" };
  return { subject: "you", possessive: "your", object: "you", copulaHave: "do" };
}

function fieldCompletionClause(field: string) {
  const p = pronounSetForField(field);
  if (/emotion/i.test(field)) return `what emotion comes up for ${p.object}`;
  if (/thought/i.test(field)) return `what thought goes through ${p.possessive} mind`;
  if (/behavior/i.test(field)) return `what ${p.subject} ${p.subject === "they" ? "would do" : "do"}`;
  if (/reaction/i.test(field)) return `how ${p.subject} ${p.subject === "they" ? "would respond" : "respond"}`;
  if (/belief/i.test(field)) return `how much ${p.subject} ${p.subject === "they" ? "would believe" : "believe"} that`;
  if (/weight/i.test(field)) return "what percentage feels right to you";
  if (/intensity|percent/i.test(field)) return "how strong that feels";
  if (/summary/i.test(field)) return "how you would summarize that in your own words";
  if (/insight|meaning/i.test(field)) return "what that means to you";
  return `what comes to mind for ${p.object}`;
}

/** Turns an authoring `marker` fragment (a real clinical-script excerpt) into a
 * natural patient-facing question. Prefer the marker verbatim when it already
 * reads as a question; otherwise complete it with a clause built from the
 * output field so the result still asks something concrete instead of an
 * instruction like "Please describe your X for this step." */
function naturalMarkerQuestion(marker: string | undefined, field: string) {
  const cleaned = marker?.trim().replace(/\s+/g, " ").replace(/^(?:and|so|now|then)\s+/i, "");
  if (!cleaned || !isUsableMarkerLeadIn(cleaned)) return undefined;
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  const looksLikeQuestion = /[?]$/.test(capitalized) || /^(?:what|how|why|when|where|who|which|is|are|do|does|did|can|could|would|should|will)\b/i.test(capitalized);
  if (looksLikeQuestion) return /[?]$/.test(capitalized) ? capitalized : `${capitalized}?`;
  if (!field) return `${capitalized}?`;
  return `${capitalized}, ${fieldCompletionClause(field)}?`;
}

/** Formats the actual configured rating range instead of assuming 0-100%. */
function scaleRangeText(validation: { min?: unknown; max?: unknown } | null | undefined) {
  const min = Number(validation?.min ?? 0);
  const max = Number(validation?.max ?? 100);
  return max <= 5 ? `On a scale from ${min} to ${max}` : `From ${min} to ${max}%`;
}

function returningArrowQuestion(promptItem: PromptItem) {
  if (/thought-arrow$/.test(promptItem.id)) return naturalMarkerQuestion(promptItem.markerHint, "") ? `${naturalMarkerQuestion(promptItem.markerHint, "")!.replace(/\?$/, "")}, does the original thought get stronger, weaker, or stay the same?` : undefined;
  if (/emotion-arrow$/.test(promptItem.id)) return naturalMarkerQuestion(promptItem.markerHint, "") ? `${naturalMarkerQuestion(promptItem.markerHint, "")!.replace(/\?$/, "")}, what happens to the emotion?` : undefined;
  if (/behavior-arrow$/.test(promptItem.id)) return naturalMarkerQuestion(promptItem.markerHint, "") ? `${naturalMarkerQuestion(promptItem.markerHint, "")!.replace(/\?$/, "")}, what happens to the behavior?` : undefined;
  return undefined;
}

/** Last-resort role naming for a role_transition prompt with no approved text:
 * the authored slug already says which chair the step moves into. */
const ROLE_NAMES_BY_SLUG_FRAGMENT: Array<[RegExp, string]> = [
  [/defendant/, "the defendant's chair"],
  [/prosecutor/, "the prosecutor's chair"],
  [/defense/, "the defense attorney's chair"],
  [/jury|juror/, "the jury's seat"],
  [/verdict/, "the court officer's position"],
  [/consensus/, "the Consensus chair"],
  [/emotion/, "the Emotion chair"],
  [/reason/, "the Reason chair"],
];

function roleNameFromPromptSlug(promptItemId: string) {
  const slug = promptItemId.replace(/^.*-p\d+-/, "");
  return ROLE_NAMES_BY_SLUG_FRAGMENT.find(([pattern]) => pattern.test(slug))?.[1];
}

function sourceSpecificRuntimeFallback(promptItem: PromptItem) {
  const fields = promptItem.outputFields;
  const subject = fields[0] ? humanizeField(fields[0]) : "this step";
  const sourceStepSubject = promptItem.id.replace(/^.*-p\d+-/, "").replace(/-/g, " ") || subject;
  const validation = (promptItem.validation as { kind?: unknown; min?: unknown; max?: unknown } | null) ?? null;
  const validationKind = String(validation?.kind ?? "");
  const arrowQuestion = returningArrowQuestion(promptItem);
  if (arrowQuestion) return arrowQuestion;
  // Must precede the generic /^paired_ratings/ branch, which this kind also
  // matches: the source requires reading the argument just made back to the
  // defendant BEFORE they re-rate, and being swallowed by the generic branch
  // turned those steps into a bare double-rating question. The read-back
  // itself needs runtime fields, which don't exist at release-compile time,
  // so this is only the frame -- static-messages/s08.ts fills in the actual
  // quoted evidence at delivery.
  if (validationKind === "paired_ratings_after_readback" && fields.length >= 2) {
    return `Back in the defendant's chair, I will first read back what was just argued. Then, ${scaleRangeText(validation).toLowerCase()}, how would you rate both ${humanizeField(fields[0])} and ${humanizeField(fields[1])} right now?`;
  }
  if (/^paired_ratings/.test(validationKind) && fields.length >= 2) {
    return `${scaleRangeText(validation)}, how would you rate both ${humanizeField(fields[0])} and ${humanizeField(fields[1])} right now?`;
  }
  if (promptItem.type === "rating" && fields[0]) {
    const lead = naturalMarkerQuestion(promptItem.markerHint, fields[0]);
    return lead ?? `${scaleRangeText(validation)}, how would you rate your ${humanizeField(fields[0])} right now?`;
  }
  if (promptItem.type === "role_transition") {
    const marker = promptItem.markerHint?.trim();
    if (marker && /^(?:please|take a moment)/i.test(marker)) return marker.endsWith(".") ? marker : `${marker}.`;
    // Naming the role is the whole point of a slow, explicit transition (S08
    // Key Principle 2), so derive it from the prompt's own slug rather than
    // shipping a line that names no role at all. The slug is authored, not
    // participant data, so this stays deterministic.
    const roleName = roleNameFromPromptSlug(promptItem.id);
    if (roleName) return `Let's move into ${roleName} now. Take a moment to settle there before we continue, and tell me when you are ready.`;
    return "Let's move into that role now. Take a moment to settle there before we continue.";
  }
  if (fields[0] && /evidence/i.test(fields[0])) {
    const marker = promptItem.markerHint?.trim();
    const usableMarker = marker && isUsableMarkerLeadIn(marker) ? marker : undefined;
    return usableMarker ? `${usableMarker.replace(/\.$/, "")} — what is one specific example that comes to mind?` : `What is one specific example of ${humanizeField(fields[0])}?`;
  }
  if (fields[0] && ["question", "clarification", "follow_up", "confirmation", "reflection"].includes(promptItem.type)) {
    return naturalMarkerQuestion(promptItem.markerHint, fields[0]) ?? `What would you say about ${humanizeField(fields[0])} right now?`;
  }
  if (promptItem.type === "reflection") return "Thank you for sharing that. We will keep it in view as we continue.";
  if (["instruction", "explanation", "transition", "worksheet_instruction"].includes(promptItem.type)) {
    return naturalMarkerQuestion(promptItem.markerHint, "") ?? `Let's continue with ${sourceStepSubject}, one step at a time.`;
  }
  return naturalMarkerQuestion(promptItem.markerHint, subject) ?? `What would you say about ${subject} right now?`;
}

function toConditionExpression(value: Record<string, unknown> | ConditionExpression | null | undefined) {
  if (!value || typeof value !== "object") return undefined;
  if (value.kind === "always") return { kind: "always" } satisfies ConditionExpression;
  if (typeof value.field !== "string" || typeof value.operator !== "string") return undefined;
  return {
    kind: "field",
    field: value.field,
    operator: value.operator as ConditionExpression["operator"],
    value: value.value as ConditionExpression["value"],
  } satisfies ConditionExpression;
}

/** validation.kind values that occur on a PASSIVE_PROMPT_TYPES-typed prompt
 * (instruction/explanation/transition/worksheet_instruction/closing) but
 * genuinely check something the PATIENT must supply this turn, verified
 * against each one's own source text/context rather than assumed from the
 * name alone (see the fix commit for the read-distortions/participation
 * cases this was written against). Kept as a narrow allowlist rather than
 * "any validation present" because most passive-typed validations
 * (exact_scale_anchors, courtroom_roles_understood, ccsh_summary, ...)
 * check the ASSISTANT's own delivered content, not a patient answer --
 * treating those as input-requiring would recreate the exact class of
 * deadlock this fix is for, just on different prompts. */
const PASSIVE_TYPE_REAL_ANSWER_VALIDATION_KINDS = new Set([
  "min_items",
  "exact_circuit_structure",
  "reject_non_green_homework",
  "defer_new_contributor_to_next_round",
  "boolean",
]);

/** completionEffect kinds that resolve on assistant delivery by design --
 * a safety pause and a session-completing summary must never wait for a
 * patient answer, even if their prompt happens to declare outputFields. */
const IMMEDIATE_COMPLETION_EFFECTS = new Set(["pause_session", "complete_session"]);

// Exact-ID exceptions to the type-based rules below, for a prompt whose
// TYPE would normally force requiresPatientInput=true (or the generic
// outputFields.length > 0 fallback would) but is actually a passive
// acknowledgment of something the PREVIOUS turn already recorded, not a new
// question. tbct-s02-n11-p02-recorded-summary was the original case
// (calculated_*_totals kinds cover it via validationKind instead, but the
// same reasoning applies); tbct-s02-n02-p06-problem-confirmation is the
// same defect for type "confirmation": "Got it -- I'll add that to your
// list." has no question in it, but "confirmation" is unconditionally
// forced true below regardless of outputFields (unlike the passive types),
// so a real S02 run had the participant's "네" rejected as filler and
// re-asked with the generic "give a short concrete example" clarification.
// Scoped by exact id, not by loosening the type rule for every
// "confirmation"-typed prompt session-wide -- several other confirmations
// (S03's redirection-contract, confirm-working-thought) ARE real yes/no
// questions that must keep waiting for an answer.
// tbct-s02-n03-p02-acknowledge-private-placeholder is the identical defect:
// "Thank you for letting me know it's there..." has no question either, and
// blocked the task's own required final-verification scenario (add one X
// placeholder, then answer the rating-card question) at this exact step.
// tbct-s02-n07-p07-goal-confirmation ("That's a wonderful goal -- I'll add
// that.") is the same pattern on the goals side, checked and fixed
// alongside problem-confirmation per an explicit follow-up request. The six
// rating/total reflections below are also statements with no question and
// no output field; a transcript-level S02 run showed that treating the
// generic "reflection" type as input-required inserted otherwise invisible
// filler turns after the final problem/goal rating and both total summaries.
// Keep the exception exact-ID scoped so genuine reflective questions in
// other sessions still wait for the participant.
const PASSIVE_ACKNOWLEDGMENT_PROMPT_IDS = new Set([
  "tbct-s02-n11-p02-recorded-summary",
  "tbct-s02-n02-p06-problem-confirmation",
  "tbct-s02-n03-p02-acknowledge-private-placeholder",
  "tbct-s02-n07-p07-goal-confirmation",
  "tbct-s02-n05-p02-acknowledge-distress",
  "tbct-s02-n05-p03-acknowledge-manageable",
  "tbct-s02-n06-p02-problem-total-personal",
  "tbct-s02-n09-p02-acknowledge-difficult-goal",
  "tbct-s02-n09-p03-acknowledge-achieved-goal",
  "tbct-s02-n10-p02-goal-total-personal",
]);

export function promptRequiresPatientInput(promptItem: PromptItem) {
  const validationKind = String((promptItem.validation as { kind?: unknown } | null)?.kind ?? "");
  if (["calculated_problem_totals", "calculated_goal_totals"].includes(validationKind) || PASSIVE_ACKNOWLEDGMENT_PROMPT_IDS.has(promptItem.id)) return false;
  if (["question", "clarification", "follow_up", "confirmation", "reflection", "rating"].includes(promptItem.type)) return true;
  if (PASSIVE_PROMPT_TYPES.has(promptItem.type)) {
    const completionEffectType = (promptItem as { completionEffect?: { type?: unknown } | null }).completionEffect?.type;
    if (typeof completionEffectType === "string" && IMMEDIATE_COMPLETION_EFFECTS.has(completionEffectType)) return false;
    return promptItem.outputFields.length > 0 && PASSIVE_TYPE_REAL_ANSWER_VALIDATION_KINDS.has(validationKind);
  }
  return promptItem.outputFields.length > 0;
}

/**
 * Fields a prompt records simply by being delivered.
 *
 * A prompt that never waits for an answer and has no field-writing effect can
 * only mean one thing by its outputFields: "this content was delivered". Any
 * such field had no writer anywhere in the runtime and stayed undefined for
 * the whole programme -- S07's psychoeducation acknowledgements and plan
 * summary, S08's courtroom orientation and appeal homework, and the
 * equivalent scale-presented / worksheet-delivered flags in S01-S06 -- while
 * the catalog claimed the step captured them.
 *
 * Deliberately narrow: an input-requiring prompt that fails to capture its
 * field is a real defect and must keep surfacing as missing.
 */
export function acknowledgedOnDeliveryFields(promptItem: PromptItem): string[] {
  if (promptRequiresPatientInput(promptItem)) return [];
  const effect = promptItem.completionEffect as { type?: unknown; to?: unknown; field?: unknown } | null;
  const writtenByEffect = new Set([effect?.to, effect?.field].filter((value): value is string => typeof value === "string"));
  return promptItem.outputFields.filter((field) => !writtenByEffect.has(field));
}

function defaultCompletionCondition(promptItem: PromptItem): ConditionExpression {
  return promptRequiresPatientInput(promptItem)
    ? { kind: "field", field: "turn.patient_input_validated", operator: "equals", value: true }
    : { kind: "field", field: "turn.assistant_message_delivered", operator: "equals", value: true };
}

function defaultRoleId(promptItem: PromptItem, node: ClinicalStageNode): RuntimeSpeakerRoleId {
  if (node.speakerRoleId === "therapist" || node.speakerRoleId === "psychoeducation_guide" || node.speakerRoleId === "closing_guide" || node.speakerRoleId === "tbct_guide") return node.speakerRoleId;
  if (promptItem.type === "closing") return "closing_guide";
  if (["explanation", "instruction", "worksheet_instruction"].includes(promptItem.type)) return "psychoeducation_guide";
  return "tbct_guide";
}

function defaultAllowedActions(promptItem: PromptItem) {
  if (promptItem.type === "closing") return ["close", "summarize", "validate"];
  if (["explanation", "instruction", "worksheet_instruction"].includes(promptItem.type)) return ["educate", "ask"];
  if (["reflection", "summary"].includes(promptItem.type)) return ["reflect", "summarize"];
  return ["ask"];
}

function normalizeValidationRules(promptItem: PromptItem): ValidationRule[] {
  if (promptItem.validationRules?.length) return promptItem.validationRules.map((rule) => ({ ...rule }));
  if (promptItem.validation && typeof promptItem.validation.kind === "string") {
    return [{ id: `${promptItem.id}-validation`, kind: promptItem.validation.kind, ...promptItem.validation }];
  }
  return [];
}

export function normalizeRuntimePromptItem(input: {
  promptItem: PromptItem;
  node: ClinicalStageNode;
  locale: string;
  sequenceIndex?: number;
}): RuntimePromptItem {
  const { promptItem, node, locale } = input;
  const activationCondition = toConditionExpression(promptItem.activationCondition);
  const sourceCandidate = promptItem.fallbackPatientText ?? promptItem.verbatimText;
  const fallbackCandidate = localizedSourcePromptText(promptItem, locale, isPatientSafeFallbackText(sourceCandidate) ? sourceCandidate : sourceSpecificRuntimeFallback(promptItem));

  return {
    id: promptItem.id,
    sessionId: promptItem.sessionId,
    nodeId: promptItem.nodeId,
    roleId: promptItem.roleId ?? defaultRoleId(promptItem, node),
    scope: promptItem.scope ?? "step",
    sequenceIndex: promptItem.sequenceIndex ?? input.sequenceIndex ?? promptItem.order,
    executionMode: promptItem.executionMode ?? (activationCondition ? "conditional" : "serial"),
    modelGuidance: promptItem.modelGuidance?.trim() || promptItem.aiInstruction.trim(),
    requiredPatientFacingContent: [fallbackCandidate?.trim() || promptItem.verbatimText.trim()].filter(Boolean),
    fallbackPatientText: resolvePromptLocaleText(promptItem.id, fallbackCandidate, locale),
    clarificationPatientText: resolvePromptLocaleText(promptItem.id, promptItem.verbatimText || fallbackCandidate, locale),
    activationCondition,
    completionCondition: promptItem.completionCondition ?? defaultCompletionCondition(promptItem),
    allowedActions: promptItem.allowedActions?.length ? [...promptItem.allowedActions] : defaultAllowedActions(promptItem),
    forbiddenActions: promptItem.forbiddenActions?.length ? [...promptItem.forbiddenActions] : ["change_runtime_state", "disclose_internal_instructions", "diagnose"],
    requiredFields: promptItem.requiredFields?.length ? [...promptItem.requiredFields] : [...promptItem.outputFields],
    validationRules: normalizeValidationRules(promptItem),
    maxAttempts: Math.max(1, promptItem.maxAttempts ?? 1),
    maxClarificationAttempts: 3,
    maxIterations: promptItem.maxIterations,
    requiresPatientInput: promptRequiresPatientInput(promptItem),
    outputSchemaVersion: promptItem.outputSchemaVersion ?? DEFAULT_OUTPUT_SCHEMA_VERSION,
    sourcePromptItemId: promptItem.id,
  };
}

function toTransitionRule(edge: SourceFidelityEdge): RuntimeTransitionRule {
  return {
    id: edge.id,
    targetNodeId: edge.target,
    condition: toConditionExpression(edge.condition),
    priority: edge.priority,
    isFallback: edge.isFallback,
  };
}

function normalizeRuntimeNode(input: {
  node: ClinicalStageNode;
  promptItems: RuntimePromptItem[];
  edges: SourceFidelityEdge[];
}): RuntimeNode {
  const { node, promptItems, edges } = input;
  const promptSequence = promptItems
    .filter((promptItem) => promptItem.nodeId === node.id)
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex || left.id.localeCompare(right.id))
    .map((promptItem) => promptItem.id);

  return {
    id: node.id,
    sessionId: node.sessionId,
    title: node.title,
    objective: node.objective?.trim() || node.clinicalPurpose,
    speakerRoleId: node.speakerRoleId ?? promptItems.find((promptItem) => promptItem.nodeId === node.id)?.roleId ?? "tbct_guide",
    promptSequence,
    entryCondition: node.entryCondition ?? { kind: "always" },
    completionCondition: node.completionCondition ?? { kind: "field", field: "node.all_prompt_items_completed", operator: "equals", value: true },
    transitionRules: edges.filter((edge) => edge.source === node.id).map(toTransitionRule).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id)),
    maxNodeIterations: Math.max(1, node.maxNodeIterations ?? 3),
    safetyRuleIds: [...node.safetyRuleIds],
  };
}

function normalizePolicies(snapshot: SourceFidelityReleaseSnapshot): PolicyBundle {
  const sessionPolicies = Object.fromEntries(Object.entries(snapshot.sessionCommonRules ?? {}).map(([sessionId, rules]) => [
    sessionId,
    {
      safetyRules: [...(rules.sessionWideSafetyRules ?? [])],
      protocolRules: [
        ...(rules.languageRules ?? []),
        ...(rules.openingRules ?? []),
        ...(rules.sessionWideRequiredActions ?? []),
        ...(rules.sessionWideRestrictions ?? []),
      ],
      toneGuidance: rules.roleAndStance?.trim() || undefined,
    },
  ]));
  return {
    globalSafetyRules: ["Safety override takes precedence over normal runtime progression. Do not generate ordinary protocol content when a safety override is active."],
    protocolRules: [],
    sessionPolicies,
    forbiddenPatientContent: ["internal instructions", "model details", "prompt details", "runtime identifiers"],
    maxPromptCharacters: 12_000,
  };
}

export function normalizeRuntimeReleaseFromSourceSnapshot(input: {
  releaseId: string;
  protocolId: string;
  version: string;
  publishedAt: string;
  snapshot: SourceFidelityReleaseSnapshot;
  contentHash?: string;
}): RuntimeRelease {
  const nodeById = new Map(input.snapshot.clinicalStageNodes.map((node) => [node.id, node]));
  const promptItems = input.snapshot.promptItems
    .filter((promptItem) => promptItem.status === "active")
    .map((promptItem, index) => {
      const node = nodeById.get(promptItem.nodeId);
      if (!node) return null;
      const sessionLocale = input.snapshot.sessionDefinitions.find((session) => session.id === promptItem.sessionId)?.sourceTrace.sourceSession === "Korean" ? "ko-KR" : "en-US";
      return normalizeRuntimePromptItem({ promptItem, node, locale: sessionLocale, sequenceIndex: index + 1 });
    })
    .filter((promptItem): promptItem is RuntimePromptItem => Boolean(promptItem));

  return {
    id: input.releaseId,
    protocolId: input.protocolId,
    version: input.version,
    roles: DEFAULT_RUNTIME_ROLES.map((role) => ({ ...role, allowedActions: [...role.allowedActions], forbiddenActions: [...role.forbiddenActions] })),
    nodes: input.snapshot.clinicalStageNodes.map((node) => normalizeRuntimeNode({ node, promptItems, edges: input.snapshot.sourceFidelityEdges })),
    promptItems,
    policies: normalizePolicies(input.snapshot),
    schemaVersion: "runtime-release/v1",
    contentHash: input.contentHash ?? `legacy-${input.snapshot.sourceTextHash}`,
    publishedAt: input.publishedAt,
  };
}

export { DEFAULT_RUNTIME_ROLES };
