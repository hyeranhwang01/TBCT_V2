import type { ClinicalProviderResponse } from "@/lib/clinical-language/clinical-language-contract";
import { makeId } from "@/lib/id";
import type { ClinicalStageNode, PromptItem } from "@/lib/protocol/source-fidelity-types";
import { compileRuntimePrompt } from "@/lib/runtime/runtime-prompt-compiler";
import { reduceRuntimeState, type RuntimeStateReduction } from "@/lib/runtime/runtime-state-reducer";
import type { RuntimeActiveStep } from "@/lib/runtime/runtime-step-resolver";
import type { CompiledPromptContract, RuntimeRelease } from "@/types/protocol-runtime";
import type { OutputValidationResult, PatientProfile, RuntimeMessage, RuntimeSession, RuntimeSessionState, SessionMemory } from "@/types/runtime-session";
import { resolveStaticPatientMessage } from "@/lib/runtime/runtime-static-message";
import { recordModelUsage } from "@/lib/assessment/model-observability";
import type { PatientRendererRequest } from "@/lib/patient-renderer/patient-renderer-contract";
import { isDialogueAgentEnabled, resolveDialogueAgentMessage } from "@/lib/dialogue-agent/dialogue-agent-orchestrator";
import { defaultFallbackPatientText, resolveModelGroundingText } from "@/lib/runtime/runtime-release-normalizer";
import { resolveRepeatedFallbackText as resolveS01RepeatedFallbackText } from "@/patient/sessions/s01/messages";
import { resolveRepeatedFallbackText as resolveS02RepeatedFallbackText } from "@/patient/sessions/s02/messages";
import { resolveRepeatedFallbackText as resolveS03RepeatedFallbackText } from "@/patient/sessions/s03/messages";
import { composeDistortionCandidateText, selectDistortionCandidatesDeterministically, type DistortionCandidate } from "@/patient/sessions/s01/distortion-candidates";

async function callPatientRenderer(request: PatientRendererRequest, context: { sessionId: string; turnId: string }) {
  if (typeof window === "undefined") { const { renderPatientReflection } = await import("@/lib/patient-renderer/anthropic-patient-renderer"); return renderPatientReflection(request, context); }
  const response = await runtimeFetch("/api/patient-reflection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, context }) });
  const payload = await response.json().catch(() => null); if (!response.ok || !payload?.ok) return { reflection: "Thank you for sharing that.", provider: "none", failed: true };
  return payload.data as { reflection: string; patientMessage?: string; provider: string; failed: boolean; failureReason?: string };
}

// S01-only, cognitive-distortions candidate selection (task's registry
// redesign brief; .claude/TASK_SCOPE.json's note2026_08_17d entry). Never
// invoked for any other session. selectDistortionCandidatesDeterministically
// is a pure, offline, registry-only function -- safe to import statically
// and use directly as the browser-side/no-network fallback; the Anthropic-
// backed path (which touches ANTHROPIC_API_KEY) stays server-only, mirroring
// callPatientRenderer's dynamic-import/fetch split above.
async function callDistortionClassifier(request: { locale: string; situation: string; automaticThought: string; emotion?: string }, context: { sessionId: string; turnId: string }): Promise<{ candidates: DistortionCandidate[] }> {
  if (typeof window === "undefined") {
    const { selectDistortionCandidates } = await import("@/patient/sessions/s01/distortion-candidates");
    const result = await selectDistortionCandidates(request, context);
    return { candidates: result.candidates };
  }
  try {
    const response = await runtimeFetch("/api/distortion-candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, context }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error("distortion candidate request failed");
    return { candidates: (payload.data.candidates as DistortionCandidate[]) ?? [] };
  } catch {
    return { candidates: selectDistortionCandidatesDeterministically(request) };
  }
}

const IDENTIFY_DISTORTION_PROMPT_ID = "tbct-s01-n10-p02-identify-distortion";

async function resolveS01DistortionCandidateText(input: { sessionId: string; turnId: string; locale: string; fields: Record<string, unknown> }): Promise<string | undefined> {
  const situation = input.fields.situationThoughtDistinction;
  const automaticThought = input.fields.openingInitialThought;
  if (typeof situation !== "string" || !situation.trim() || typeof automaticThought !== "string" || !automaticThought.trim()) return undefined;
  const emotion = typeof input.fields.personalEmotion === "string" ? input.fields.personalEmotion : undefined;
  const { candidates } = await callDistortionClassifier({ locale: input.locale, situation, automaticThought, emotion }, { sessionId: input.sessionId, turnId: input.turnId });
  if (!candidates.length) return undefined;
  return composeDistortionCandidateText(candidates, input.locale);
}

function activeActionType(activeStep: RuntimeActiveStep) {
  return activeStep.promptItem.allowedActions[0] ?? "ask";
}

function fallbackResponse(input: { requestId: string; contract: CompiledPromptContract; activeStep: RuntimeActiveStep; locale: string }): ClinicalProviderResponse {
  return {
    requestId: input.requestId,
    patientMessage: input.contract.fallbackPatientText,
    actionType: activeActionType(input.activeStep),
    proposedFields: {},
    completionEvidence: [],
    detectedLanguage: input.locale,
    completionStatus: "incomplete",
    extractedFields: {},
    safetySignals: [],
    recommendedTransition: "stay",
    nextActionRecommendation: "stay",
    providerMetadata: { provider: "mock", model: "runtime-fallback" },
  };
}

/**
 * When the dialogue agent falls back to the identical approved static text
 * three turns in a row, the generic override below invites the participant
 * to share "one specific moment" -- a Personal-Example-shaped question that
 * must never fire mid-Neutral-Example (or any other S01 phase) in Session 1.
 * S01 gets its own phase-preserving rephrase (resolveS01RepeatedFallbackText,
 * static-messages/s01.ts) instead; every other session's override is
 * byte-identical to the prior behavior. Exported so both branches can be
 * unit-tested directly without driving a full session/provider-failure
 * simulation -- see .claude/TASK_SCOPE.json's note2026_08_17b entry.
 */
export function resolveRepeatedFallbackOverride(input: {
  sessionDefinitionId: string;
  usedFallback: boolean;
  approvedPatientText: string;
  recentAssistantMessages: string[];
  lastPatientMessage: string | undefined;
  locale: string;
  activePromptItemId: string;
}): string | undefined {
  const normalizedApproved = input.approvedPatientText.replace(/\s+/g, " ").trim();
  const repeatedFallback = input.usedFallback && input.recentAssistantMessages
    .slice(-3)
    .some((content) => content.replace(/\s+/g, " ").trim() === normalizedApproved);
  if (!repeatedFallback || !input.lastPatientMessage?.trim()) return undefined;

  if (input.sessionDefinitionId === "tbct-s01") {
    return resolveS01RepeatedFallbackText({ promptItemId: input.activePromptItemId, approvedPatientText: input.approvedPatientText, locale: input.locale });
  }
  // P1-3: same phase-preserving exception as S01 above, for S02 (problem/goal/
  // rating) and S03 (situation/thought/emotion/body) -- see resolveRepeatedFallbackText
  // in each session's static-messages/s0N.ts for the full rationale. S04-S08
  // are untouched: this branch only intercepts tbct-s02/tbct-s03.
  if (input.sessionDefinitionId === "tbct-s02") {
    return resolveS02RepeatedFallbackText({ promptItemId: input.activePromptItemId, approvedPatientText: input.approvedPatientText, locale: input.locale });
  }
  if (input.sessionDefinitionId === "tbct-s03") {
    return resolveS03RepeatedFallbackText({ promptItemId: input.activePromptItemId, approvedPatientText: input.approvedPatientText, locale: input.locale });
  }

  const excerpt = input.lastPatientMessage.trim().slice(0, 80);
  return input.locale.toLowerCase().startsWith("ko")
    ? `"${excerpt}"라고 느끼고 계시는군요. 그 마음이 가장 크게 느껴졌던 구체적인 순간 하나를 말씀해 주실 수 있을까요?`
    : `It sounds like "${excerpt}" is weighing on you. Could you share one specific moment when it felt strongest?`;
}

export type RuntimeOrchestratorInput = {
  session: RuntimeSession;
  release: RuntimeRelease;
  state: RuntimeSessionState;
  activeStep: RuntimeActiveStep;
  sourceNode: ClinicalStageNode;
  sourcePromptItem: PromptItem;
  recentMessages: RuntimeMessage[];
  patientProfile?: PatientProfile;
  sessionMemory?: SessionMemory;
};

export type RuntimeOrchestratorResult = {
  contract: CompiledPromptContract;
  response: ClinicalProviderResponse;
  providerResult: { provider: string; model?: string; latencyMs?: number; text?: string; error?: string };
  validator: OutputValidationResult;
  fallbackUsed: boolean;
  repairUsed: boolean;
  generatedMessage: RuntimeMessage;
  stateReduction: RuntimeStateReduction;
};

export async function orchestrateRuntimeAssistantTurn(input: RuntimeOrchestratorInput): Promise<RuntimeOrchestratorResult> {
  const contract = await compileRuntimePrompt({
    release: input.release,
    state: input.state,
    activeStep: input.activeStep,
    locale: input.session.locale,
    patientProfile: input.patientProfile,
    sessionMemory: input.sessionMemory,
    recentMessages: input.recentMessages,
    safetyContext: { activeSafetyRuleIds: input.activeStep.node.safetyRuleIds, currentSafetyStatus: input.session.status },
  });
  const staticMessage = resolveStaticPatientMessage(input.sourcePromptItem, input.session.locale, input.session.runtimeContext);

  // Sessions 1-3 route EVERY turn through the protocol-bounded dialogue
  // agent, not just clarifications -- the previous pilot wiring let
  // staticMessage short-circuit first, which meant Claude only ever ran on
  // turns that had NO approved static text (a small minority: most
  // PromptItems have a fallbackPatientText, so resolveStaticPatientMessage
  // almost always returns non-null). That made "a much larger role in
  // patient-facing delivery" impossible in practice, since the actual
  // question text for nearly every turn was still the rigid scripted
  // string. Claude now decides HOW to phrase this turn (acknowledge /
  // reflect_and_ask / explain_rationale / etc.) using the approved static
  // text as both its grounding (currentTaskTextOverride) and its
  // deterministic safety net (deterministicFallbackText) if it fails or
  // fails validation -- the deterministic engine already decided
  // completion/transition before this function was ever called, via
  // extractRuntimeState + the completion condition, and is untouched by
  // whatever comes back here. Safety-critical prompts (crisis check,
  // pause-escalation) are excluded even for enabled sessions --
  // isSafetyCriticalPrompt inside resolveDialogueAgentMessage falls
  // straight to deterministicFallbackText without calling Claude at all.
  // Every other session keeps the exact prior behavior (approved static
  // text first, then personalized reflection / deterministic fallback)
  // unchanged.
  let approvedPatientText = staticMessage?.patientMessage ?? contract.fallbackPatientText;
  // S01-only: identify-distortion's grounding text is the dynamically
  // composed, registry-validated candidate list (never Claude-invented
  // distortion names) rather than the generic static fallback above -- see
  // resolveS01DistortionCandidateText and .claude/TASK_SCOPE.json's
  // note2026_08_17d entry. No other session's prompt ids ever match this.
  if (input.session.sessionDefinitionId === "tbct-s01" && input.sourcePromptItem.id === IDENTIFY_DISTORTION_PROMPT_ID) {
    const candidateText = await resolveS01DistortionCandidateText({ sessionId: input.session.id, turnId: makeId("DISTORTION"), locale: input.session.locale, fields: input.session.runtimeContext.fields });
    if (candidateText) approvedPatientText = candidateText;
  }
  if (isDialogueAgentEnabled(input.session.sessionDefinitionId)) {
    const dynamicRequestId = makeId("REFLECT");
    // promptIndex === 0 means this is the first prompt the participant will
    // see in this node -- i.e. they're moving into a new step. Combined
    // with no node completed yet, it's the very first prompt of the whole
    // session. See dialogue-agent-contract.ts for how the dialogue agent
    // uses these to add a brief, friendly "here's what's coming" framing
    // instead of asking the task cold -- purely a phrasing instruction, the
    // deterministic node/prompt progression above is completely unaffected.
    const isFirstPromptOfNode = input.activeStep.promptIndex === 0;
    const isFirstPromptOfSession = isFirstPromptOfNode && input.state.completedNodeIds.length === 0;
    const dialogueResult = await resolveDialogueAgentMessage({
      session: input.session,
      node: input.sourceNode,
      sourcePromptItem: input.sourcePromptItem,
      runtimePromptItem: input.activeStep.promptItem,
      lastParticipantMessage: input.session.runtimeContext.lastPatientMessage,
      recentMessages: input.recentMessages,
      clarificationAttemptCount: input.session.runtimeContext.clarificationAttemptCount ?? 0,
      turnId: dynamicRequestId,
      currentTaskTextOverride: approvedPatientText === defaultFallbackPatientText(input.session.locale)
        ? resolveModelGroundingText(input.sourcePromptItem.id, input.sourcePromptItem.fallbackPatientText, input.session.locale)
        : approvedPatientText,
      deterministicFallbackText: approvedPatientText,
      isFirstPromptOfNode,
      isFirstPromptOfSession,
      sessionToneGuidance: input.release.policies.sessionPolicies?.[input.session.sessionDefinitionId]?.toneGuidance,
    });
    const repeatedFallbackOverride = resolveRepeatedFallbackOverride({
      sessionDefinitionId: input.session.sessionDefinitionId,
      usedFallback: dialogueResult.usedFallback,
      approvedPatientText,
      recentAssistantMessages: input.recentMessages.filter((message) => message.role === "assistant").map((message) => message.content),
      lastPatientMessage: input.session.runtimeContext.lastPatientMessage,
      locale: input.session.locale,
      activePromptItemId: input.activeStep.promptItem.id,
    });
    if (repeatedFallbackOverride) dialogueResult.patientMessage = repeatedFallbackOverride;
    const usedClaude = !dialogueResult.usedFallback && !dialogueResult.excludedBySafety;
    const dialogueResponse = fallbackResponse({ requestId: dynamicRequestId, contract, activeStep: input.activeStep, locale: input.session.locale });
    dialogueResponse.patientMessage = dialogueResult.patientMessage;
    dialogueResponse.providerMetadata = { provider: "mock", model: usedClaude ? "dialogue-agent" : dialogueResult.excludedBySafety ? "safety-excluded" : "deterministic-neutral" };
    const dialogueValidator: OutputValidationResult = { accepted: true, corrected: false, rejected: false, issues: dialogueResult.usedFallback && dialogueResult.fallbackReason ? [dialogueResult.fallbackReason] : [], finalText: dialogueResult.patientMessage, fallbackRequired: false };
    const dialogueReduction = reduceRuntimeState({ release: input.release, currentState: input.state, activeStep: input.activeStep, event: "assistant_delivered" });
    return { contract, response: dialogueResponse, providerResult: { provider: dialogueResult.provider, model: dialogueResult.model ?? dialogueResponse.providerMetadata.model, latencyMs: dialogueResult.latencyMs, text: dialogueResult.patientMessage }, validator: dialogueValidator, fallbackUsed: dialogueResult.usedFallback, repairUsed: false, stateReduction: dialogueReduction, generatedMessage: {
      id: makeId("RMSG"), runtimeSessionId: input.session.id, role: "assistant", content: dialogueResult.patientMessage, status: dialogueResult.usedFallback ? "replaced_by_fallback" : "validated", nodeId: input.activeStep.node.id, promptItemId: input.activeStep.promptItem.id, sourceEvidenceIds: [], createdAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), metadata: { llmCalled: usedClaude, messageSource: dialogueResult.excludedBySafety ? "deterministic_safety" : "dialogue_agent", contractHash: contract.contractHash, sourcePromptItemId: input.sourcePromptItem.id, dialogueDecision: dialogueResult.decision ?? undefined },
    } };
  }

  if (staticMessage) {
    const requestId = makeId("STATIC");
    const response = fallbackResponse({ requestId, contract, activeStep: input.activeStep, locale: input.session.locale });
    response.patientMessage = staticMessage.patientMessage;
    response.providerMetadata = { provider: "mock", model: "approved-static" };
    const validator: OutputValidationResult = { accepted: true, corrected: false, rejected: false, issues: [], finalText: staticMessage.patientMessage, fallbackRequired: false };
    const stateReduction = reduceRuntimeState({ release: input.release, currentState: input.state, activeStep: input.activeStep, event: "assistant_delivered" });
    recordModelUsage({ sessionId: input.session.id, turnId: requestId, provider: "none", model: undefined, purpose: "approved_static", llmCalled: false, inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0, retryCount: 0, cacheStatus: "hit", estimatedCost: 0, success: true });
    return { contract, response, validator, fallbackUsed: false, repairUsed: false, stateReduction, generatedMessage: {
      id: makeId("RMSG"), runtimeSessionId: input.session.id, role: "assistant", content: staticMessage.patientMessage, status: "validated", nodeId: input.activeStep.node.id, promptItemId: input.activeStep.promptItem.id, sourceEvidenceIds: [], createdAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), metadata: { fallbackUsed: false, llmCalled: false, messageSource: "approved_static", contractHash: contract.contractHash, sourcePromptItemId: input.sourcePromptItem.id, sourceTextHash: input.sourcePromptItem.sourceTrace.sourceTextHash },
    }, providerResult: { provider: "deterministic", model: "approved-static", latencyMs: 0, text: staticMessage.patientMessage } };
  }
  const dynamicRequestId = makeId("REFLECT");

  const personalized = Boolean((input.sourcePromptItem as PromptItem & { requiresPersonalizedResponse?: boolean }).requiresPersonalizedResponse);
  const rendered = personalized
    ? await callPatientRenderer({ locale: input.session.locale, patientInputExcerpt: input.session.runtimeContext.lastPatientMessage?.slice(0, 500) ?? "", reflectionGoal: input.sourceNode.clinicalPurpose || "Acknowledge the patient's answer respectfully", maxWords: input.session.locale.toLowerCase().startsWith("ko") ? 20 : 35 }, { sessionId: input.session.id, turnId: dynamicRequestId })
    : { reflection: contract.fallbackPatientText, patientMessage: contract.fallbackPatientText, provider: "none", failed: false };
  const dynamicText = rendered.patientMessage ?? rendered.reflection;
  const dynamicResponse = fallbackResponse({ requestId: dynamicRequestId, contract, activeStep: input.activeStep, locale: input.session.locale });
  dynamicResponse.patientMessage = dynamicText;
  dynamicResponse.providerMetadata = { provider: "mock", model: personalized && rendered.provider === "anthropic" ? "patient-reflection" : "deterministic-neutral" };
  const dynamicValidator: OutputValidationResult = { accepted: true, corrected: false, rejected: false, issues: [], finalText: dynamicText, fallbackRequired: false };
  const dynamicReduction = reduceRuntimeState({ release: input.release, currentState: input.state, activeStep: input.activeStep, event: "assistant_delivered" });
  return { contract, response: dynamicResponse, providerResult: { provider: rendered.provider === "anthropic" ? "anthropic" : "deterministic", model: dynamicResponse.providerMetadata.model, text: dynamicText }, validator: dynamicValidator, fallbackUsed: Boolean(rendered.failed), repairUsed: false, stateReduction: dynamicReduction, generatedMessage: { id: makeId("RMSG"), runtimeSessionId: input.session.id, role: "assistant", content: dynamicText, status: rendered.failed ? "replaced_by_fallback" : "validated", nodeId: input.activeStep.node.id, promptItemId: input.activeStep.promptItem.id, sourceEvidenceIds: [], createdAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), metadata: { llmCalled: rendered.provider === "anthropic", messageSource: personalized ? "personalized_reflection" : "deterministic_neutral", contractHash: contract.contractHash, sourcePromptItemId: input.sourcePromptItem.id } } };

}
import { runtimeFetch } from "@/lib/runtime/resolve-store-url";
