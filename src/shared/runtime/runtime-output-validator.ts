import type { OutputValidationResult } from "@/types/runtime-session";

export type RuntimeStructuredOutput = {
  patientMessage: string;
  actionType: string;
  proposedFields: Record<string, unknown>;
  completionEvidence: string[];
  safetySignals: Array<{ type: string; immediacy?: string }>;
  recommendedTransition: "stay" | "advance" | "clarify" | "safety";
};

export type RuntimeOutputValidationContext = {
  roleId?: string;
  allowedActions?: string[];
  forbiddenActions?: string[];
  requiredFields?: string[];
  forbiddenPatientContent?: string[];
  sessionFields?: Record<string, unknown>;
  recentAssistantMessages?: string[];
};

function normalizedWords(text: string) {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\uac00-\ud7a3\s]/g, " ").split(/\s+/).filter((word) => word.length > 2));
}

function stronglyDuplicates(left: string, right: string) {
  const a = left.trim().toLowerCase().replace(/\s+/g, " ");
  const b = right.trim().toLowerCase().replace(/\s+/g, " ");
  if (a === b) return true;
  const leftWords = normalizedWords(a);
  const rightWords = normalizedWords(b);
  if (leftWords.size < 5 || rightWords.size < 5) return false;
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  return intersection / Math.min(leftWords.size, rightWords.size) >= 0.86;
}

function ratingConsistencyIssues(text: string, fields: Record<string, unknown> = {}) {
  const issues: string[] = [];
  const pairs: Array<[string, string]> = [
    ["automaticThoughtBeliefPercent", "revisedAutomaticThoughtBeliefPercent"],
    ["coreBeliefBaselinePercent", "originalChargeFinalBeliefPercent"],
    ["guiltBeliefBaselinePercent", "guiltBeliefFinalPercent"],
    ["shameIntensityBaselinePercent", "shameIntensityFinalPercent"],
  ];
  const claimsDecrease = /\b(?:decreas(?:e|ed)|lower|fell|dropped|reduced|down from)\b/i.test(text);
  const claimsIncrease = /\b(?:increas(?:e|ed)|higher|rose|grew|up from)\b/i.test(text);
  const claimsChange = claimsDecrease || claimsIncrease || /\b(?:meaningful movement|progress|shifted|changed|improvement)\b/i.test(text);
  const claimsSame = /\b(?:stayed|remained) the same\b|\bunchanged\b|\bno change\b/i.test(text);
  for (const [beforeField, afterField] of pairs) {
    if (!(beforeField in fields) || !(afterField in fields)) continue;
    const before = Number(fields[beforeField]);
    const after = Number(fields[afterField]);
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    if (after === before && claimsChange && !claimsSame) issues.push(`Rating comparison contradicts stored equality: ${beforeField}=${before}, ${afterField}=${after}`);
    if (after < before && (claimsIncrease || claimsSame)) issues.push(`Rating comparison contradicts stored decrease: ${beforeField}=${before}, ${afterField}=${after}`);
    if (after > before && (claimsDecrease || claimsSame)) issues.push(`Rating comparison contradicts stored increase: ${beforeField}=${before}, ${afterField}=${after}`);
  }
  return issues;
}

export function isPatientFacingLocaleConsistent(text: string, locale: string) {
  if (!locale.toLowerCase().startsWith("ko")) return true;
  const hangulCharacters = (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
  const latinCharacters = (text.match(/[A-Za-z]/g) ?? []).length;
  return hangulCharacters > 0 && latinCharacters < Math.max(12, hangulCharacters * 2);
}

function containsInternalInstruction(text: string) {
  return /(?:\bsystem prompt\b|\binternal instructions?\b|\bmodel details?\b|\bprovider\b|\bruntime (?:state|identifier)\b|\bnode[-_ ]?[a-z0-9]+\b|\bedge[-_ ]?[a-z0-9]+\b)/i.test(text);
}

export function validateRuntimeStructuredOutput(output: RuntimeStructuredOutput, locale: string, context: RuntimeOutputValidationContext = {}): OutputValidationResult {
  const issues: string[] = [];
  const text = output.patientMessage.trim();
  if (!text) issues.push("Empty response");
  if (text.length > 600) issues.push("Response too long");
  if (containsInternalInstruction(text)) issues.push("Internal instruction detail exposed");
  if (locale.startsWith("ko") && /provider|prompt|model/i.test(text)) issues.push("Internal provider detail exposed");
  if (!isPatientFacingLocaleConsistent(text, locale)) issues.push("Patient-facing response does not match the session locale");
  if (!output.actionType.trim()) issues.push("Missing action type");
  if (context.allowedActions?.length && !context.allowedActions.includes(output.actionType)) issues.push("Action is not allowed for the active PromptItem");
  if (context.forbiddenActions?.includes(output.actionType)) issues.push("Forbidden action requested");
  const usesRoleScopedControls = context.allowedActions !== undefined || context.forbiddenActions !== undefined || context.requiredFields !== undefined;
  if (usesRoleScopedControls && !context.roleId?.trim()) issues.push("Missing active speaker role");
  if (context.forbiddenPatientContent?.some((value) => value && text.toLowerCase().includes(value.toLowerCase()))) {
    issues.push("Forbidden patient content exposed");
  }
  issues.push(...ratingConsistencyIssues(text, context.sessionFields));
  if (context.recentAssistantMessages?.some((previous) => stronglyDuplicates(text, previous))) issues.push("Duplicate or near-duplicate assistant message");
  // Transition recommendations are advisory. Confirmed patient fields and the
  // deterministic reducer decide progression; passive Program turns must not
  // fabricate patient data merely because the model recommends advancing.
  if (output.safetySignals.some((signal) => signal.immediacy === "immediate") && output.recommendedTransition !== "safety") {
    issues.push("Immediate safety signal lacks a safety recommendation");
  }
  const accepted = issues.length === 0;
  return {
    accepted,
    corrected: false,
    rejected: !accepted,
    issues,
    finalText: accepted ? text : undefined,
    fallbackRequired: !accepted,
  };
}

export function validateRuntimeOutput(text: string, locale: string): OutputValidationResult {
  return validateRuntimeStructuredOutput({
    patientMessage: text,
    actionType: "send_message",
    proposedFields: {},
    completionEvidence: [],
    safetySignals: [],
    recommendedTransition: "stay",
  }, locale);
}
