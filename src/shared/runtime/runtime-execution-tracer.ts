import { makeId } from "@/shared/id";
import { isPatientFacingLocaleConsistent } from "@/shared/runtime/runtime-output-validator";
import type { OutputValidationResult, PromptExecutionStatus, RuntimeExecutionTrace, RuntimeTurnAssociation, TurnFidelityResult } from "@/types/runtime-session";

type FidelityEvidence = {
  locale?: string;
  patientFacingText?: string;
  activePromptMatches?: boolean;
  patientInputPresent?: boolean;
  turnKind?: RuntimeTurnAssociation["kind"];
  safetyOverrideExpected?: boolean;
  approvedSafetyLocaleException?: boolean;
};

function deriveTurnFidelity(input: {
  roleId: string;
  validation: OutputValidationResult;
  fallbackUsed: boolean;
  transitionDecision: string;
  fidelityEvidence?: FidelityEvidence;
}): TurnFidelityResult {
  const evidence = input.fidelityEvidence ?? {};
  const reasons: string[] = [];
  const activePromptFidelity = evidence.activePromptMatches === false ? "fail" : evidence.activePromptMatches === true ? "pass" : "partial";
  if (activePromptFidelity !== "pass") reasons.push("Active prompt identity could not be fully verified.");
  const sequenceFidelity = input.transitionDecision && activePromptFidelity !== "fail" ? "pass" : "fail";
  if (sequenceFidelity === "fail") reasons.push("No valid deterministic transition decision was recorded.");
  const roleFidelity = input.roleId.trim() ? "pass" : "fail";
  if (roleFidelity === "fail") reasons.push("No active speaker role was recorded.");
  const responseContingency = evidence.turnKind === "assistant_only" || evidence.patientInputPresent === true ? "pass" : "partial";
  if (responseContingency !== "pass") reasons.push("No patient input was associated with this patient-triggered assistant turn.");
  const localeMatches = evidence.locale && evidence.patientFacingText
    ? isPatientFacingLocaleConsistent(evidence.patientFacingText, evidence.locale)
    : undefined;
  const languageFidelity = evidence.approvedSafetyLocaleException
    ? "partial"
    : localeMatches === false ? "fail" : localeMatches === true ? "pass" : "partial";
  if (languageFidelity !== "pass") reasons.push(evidence.approvedSafetyLocaleException
    ? "Approved safety response has no locale-matched version."
    : "Patient-facing language could not be fully verified.");
  const safetyFidelity = evidence.safetyOverrideExpected && input.transitionDecision !== "safety_override" ? "critical_fail" : "pass";
  if (safetyFidelity === "critical_fail") reasons.push("A safety override was expected but ordinary runtime progression was recorded.");
  const transitionFidelity = input.transitionDecision === "safety_override" || input.transitionDecision === "clarification" || input.transitionDecision.startsWith("next_") || input.transitionDecision === "waiting_for_input" || input.transitionDecision === "complete_session"
    ? "pass"
    : "partial";
  if (transitionFidelity !== "pass") reasons.push("Transition decision was not a recognized deterministic outcome.");
  const exposesInternalContent = !input.fallbackUsed && input.validation.issues.some((issue) => /internal|forbidden patient content/i.test(issue));
  const exposureSafety = exposesInternalContent ? "fail" : "pass";
  if (exposureSafety === "fail") reasons.push("The provider output exposed prohibited internal content.");
  const responsiveness = input.validation.accepted && Boolean(evidence.patientFacingText?.trim()) ? "pass" : "fail";
  if (responsiveness === "fail") reasons.push("No validated patient-facing response was committed.");
  return {
    activePromptFidelity,
    sequenceFidelity,
    roleFidelity,
    responseContingency,
    languageFidelity,
    safetyFidelity,
    transitionFidelity,
    exposureSafety,
    responsiveness,
    reasons,
  };
}

export function createRuntimeExecutionTrace(input: {
  id?: string;
  runtimeSessionId: string;
  releaseId: string;
  nodeId: string;
  promptItemId: string;
  roleId: string;
  provider: string;
  model?: string;
  contractHash: string;
  validation: OutputValidationResult;
  fallbackUsed: boolean;
  transitionDecision: string;
  stateChanges: Record<string, unknown>;
  sessionId?: string;
  sequenceIndex?: number;
  modelRecommendedTransition?: string;
  deterministicTransitionEvaluation?: string;
  committedTransition?: string;
  committedNextNodeId?: string;
  committedNextPromptItemId?: string;
  turnAssociation?: RuntimeTurnAssociation;
  promptExecutionStatuses?: Record<string, PromptExecutionStatus>;
  fidelityEvidence?: FidelityEvidence;
}): RuntimeExecutionTrace {
  return {
    id: input.id ?? makeId("RTX"),
    runtimeSessionId: input.runtimeSessionId,
    releaseId: input.releaseId,
    nodeId: input.nodeId,
    promptItemId: input.promptItemId,
    sessionId: input.sessionId,
    sequenceIndex: input.sequenceIndex,
    roleId: input.roleId,
    provider: input.provider,
    model: input.model,
    contractHash: input.contractHash,
    validation: input.validation,
    fallbackUsed: input.fallbackUsed,
    transitionDecision: input.transitionDecision,
    modelRecommendedTransition: input.modelRecommendedTransition,
    deterministicTransitionEvaluation: input.deterministicTransitionEvaluation,
    committedTransition: input.committedTransition ?? input.transitionDecision,
    committedNextNodeId: input.committedNextNodeId,
    committedNextPromptItemId: input.committedNextPromptItemId,
    turnAssociation: input.turnAssociation,
    promptExecutionStatuses: input.promptExecutionStatuses,
    stateChanges: input.stateChanges,
    fidelity: deriveTurnFidelity(input),
    timestamp: new Date().toISOString(),
  };
}
