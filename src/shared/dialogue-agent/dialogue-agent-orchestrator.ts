import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimePromptItem } from "@/types/protocol-runtime";
import type { RuntimeMessage, RuntimeSession } from "@/types/runtime-session";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { callDialogueAgent } from "@/shared/dialogue-agent/dialogue-agent-client";
import { validateDialogueDecision } from "@/shared/dialogue-agent/dialogue-output-validator";
import type { DialogueContract, DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";
import type { FieldCorrection } from "@/shared/runtime/field-correction";

// Expanded from the S01-S03 rollout to all eight sessions. The
// branching/revision system is still intentionally NOT built -- see
// revision_request handling in dialogue-contract-compiler.ts /
// anthropic-dialogue-agent.ts, which stays session-agnostic (honest,
// worksheetEditAvailable-gated response) regardless of this set's size.
const DIALOGUE_AGENT_ENABLED_SESSIONS = new Set(["tbct-s01", "tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"]);

// A reply that should have summarized a long answer but did not is asked for
// once more -- only when the first reply came back fast enough that a second
// call still fits a patient turn (/api/runtime/turn allows 60s).
const SUMMARY_RETRY_LATENCY_BUDGET_MS = 15_000;

export function isDialogueAgentEnabled(sessionDefinitionId: string) {
  return DIALOGUE_AGENT_ENABLED_SESSIONS.has(sessionDefinitionId);
}

/** Safety-critical turns never go through Claude, in either direction: not
 * the question ("how are you doing today") and not the crisis-pause
 * instruction. Risk disposition and its wording stay fully deterministic
 * regardless of session enablement -- this is checked independently of
 * isDialogueAgentEnabled so it also protects S04-S08 if those are ever
 * added to the set above without someone re-deriving this rule. */
export function isSafetyCriticalPrompt(promptItem: PromptItem) {
  if ((promptItem.safetyRuleIds?.length ?? 0) > 0) return true;
  const validation = promptItem.validation as { kind?: unknown } | null;
  return validation?.kind === "safety_check";
}

export type DialogueAgentTurnResult = {
  patientMessage: string;
  decision: DialogueDecision | null;
  // True only when Claude was actually consulted and its output had to be
  // discarded (transport failure or failed validation) -- NOT true for
  // excludedBySafety, where the deterministic text is the correct, intended
  // output by design, not a degraded substitute. Callers that count
  // "fallback turns" as a quality signal (e.g. the simulated-patient audit)
  // depend on this distinction: an always-deterministic safety turn is not
  // a quality regression.
  usedFallback: boolean;
  excludedBySafety?: boolean;
  fallbackReason?: string;
  provider: string;
  model?: string;
  latencyMs?: number;
  // Set only when the shipped text ends in a confirmation the runtime must
  // wait for -- the caller opens a pending check from it. Never set on a
  // fallback.
  summaryCheck?: { summaryText: string; correction?: FieldCorrection };
  // `guard_log:<check>` entries from dialogue-output-validator.ts's log-mode
  // checks (open dialogue v1): recorded, not enforced.
  guardLogs?: string[];
};

/**
 * The single integration point both the "normal next question" path
 * (runtime-orchestrator.ts) and the "clarification" path
 * (runtime-execution-api.ts) call through, so the compile -> call ->
 * validate -> fall back sequence lives in exactly one place. A turn makes one
 * Claude call, plus at most one repeat request when a long answer was not
 * summarized. deterministicFallbackText is ALWAYS what ships if anything here
 * fails or fails validation -- this function can only ever replace the
 * wording of a turn, never the runtime's own decision about what happens
 * next.
 */
export async function resolveDialogueAgentMessage(input: {
  session: RuntimeSession;
  node: ClinicalStageNode;
  sourcePromptItem: PromptItem;
  runtimePromptItem: RuntimePromptItem;
  lastParticipantMessage?: string;
  recentMessages: RuntimeMessage[];
  clarificationAttemptCount: number;
  turnId: string;
  deterministicFallbackText: string;
  currentTaskTextOverride?: string;
  isFirstPromptOfNode: boolean;
  isFirstPromptOfSession: boolean;
  sessionToneGuidance?: string;
  sessionProtocolRules?: string[];
  summaryCheckAllowed?: boolean;
  reflectionCheckContext?: { previousSummary: string; attempt: number };
  summarizeLastAnswer?: { field: string; originalValue: string };
}): Promise<DialogueAgentTurnResult> {
  if (isSafetyCriticalPrompt(input.sourcePromptItem)) {
    return { patientMessage: input.deterministicFallbackText, decision: null, usedFallback: false, excludedBySafety: true, fallbackReason: "safety_critical_prompt_excluded", provider: "deterministic" };
  }
  const contract = compileDialogueContract({
    session: input.session,
    node: input.node,
    sourcePromptItem: input.sourcePromptItem,
    runtimePromptItem: input.runtimePromptItem,
    lastParticipantMessage: input.lastParticipantMessage,
    recentMessages: input.recentMessages,
    clarificationAttemptCount: input.clarificationAttemptCount,
    currentTaskTextOverride: input.currentTaskTextOverride,
    isFirstPromptOfNode: input.isFirstPromptOfNode,
    isFirstPromptOfSession: input.isFirstPromptOfSession,
    sessionToneGuidance: input.sessionToneGuidance,
    sessionProtocolRules: input.sessionProtocolRules,
    summaryCheckAllowed: input.summaryCheckAllowed,
    reflectionCheckContext: input.reflectionCheckContext,
    summarizeLastAnswer: input.summarizeLastAnswer,
  });
  const context = { sessionId: input.session.id, turnId: input.turnId };

  const result = await callDialogueAgent(contract, context);
  if (result.failed) {
    // An environment with no dialogue provider configured is running
    // deterministically by design, exactly like a safety-critical prompt --
    // the provider was never consulted, so there is nothing to have fallen
    // back FROM. Counting it as a fallback made every turn of a provider-free
    // run look like a quality regression and hid the real fallbacks among them.
    const notConfigured = result.notConfigured === true;
    return { patientMessage: input.deterministicFallbackText, decision: result.decision, usedFallback: !notConfigured, fallbackReason: notConfigured ? "dialogue_provider_not_configured" : result.failureReason, provider: result.provider };
  }
  let decision = result.decision;
  let validation = validateDialogueDecision(decision, contract);
  let { provider, model, latencyMs } = result;
  if (validation.accepted && validation.missingRequiredSummary && contract.summarizeLastAnswer && result.latencyMs < SUMMARY_RETRY_LATENCY_BUDGET_MS) {
    const retryContract: DialogueContract = { ...contract, summarizeLastAnswer: { ...contract.summarizeLastAnswer, retry: true } };
    const retry = await callDialogueAgent(retryContract, context);
    if (!retry.failed) {
      const retryValidation = validateDialogueDecision(retry.decision, retryContract);
      if (retryValidation.accepted && retryValidation.summaryCheck) {
        decision = retry.decision;
        validation = retryValidation;
        provider = retry.provider;
        model = retry.model;
        latencyMs = result.latencyMs + retry.latencyMs;
      }
    }
  }
  if (!validation.accepted) {
    return { patientMessage: input.deterministicFallbackText, decision, usedFallback: true, fallbackReason: validation.reason, provider, model, latencyMs, guardLogs: validation.guardLogs };
  }
  return { patientMessage: validation.finalText ?? decision.patientFacingMessage, decision, usedFallback: false, provider, model, latencyMs, summaryCheck: validation.summaryCheck, guardLogs: validation.guardLogs };
}
