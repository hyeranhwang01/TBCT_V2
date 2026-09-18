import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimePromptItem } from "@/types/protocol-runtime";
import type { RuntimeMessage, RuntimeSession } from "@/types/runtime-session";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { callDialogueAgent } from "@/shared/dialogue-agent/dialogue-agent-client";
import { validateDialogueDecision } from "@/shared/dialogue-agent/dialogue-output-validator";
import { checkSummaryFidelity } from "@/shared/dialogue-agent/summary-fidelity-client";
import { MAX_EXPLORATION_TURNS_PER_SESSION, MAX_EXPLORATION_TURNS_PER_STEP } from "@/shared/dialogue-agent/counselor-persona";
import { countExplorationTurns, countReflectionChecks, keepVerbatimThemes, latestPatientThemes } from "@/shared/runtime/conversation-steering";
import type { DialogueContract, DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";
import type { FieldCorrection } from "@/shared/runtime/field-correction";

// Expanded from the S01-S03 rollout to all eight sessions. The
// branching/revision system is still intentionally NOT built -- see
// revision_request handling in dialogue-contract-compiler.ts /
// anthropic-dialogue-agent.ts, which stays session-agnostic (honest,
// worksheetEditAvailable-gated response) regardless of this set's size.
const DIALOGUE_AGENT_ENABLED_SESSIONS = new Set(["tbct-s01", "tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"]);

// A summary that added meaning is written again once -- only when the first
// reply came back fast enough that a second call still fits a patient turn
// (/api/runtime/turn allows 60s).
const REWRITE_LATENCY_BUDGET_MS = 15_000;

export function isDialogueAgentEnabled(sessionDefinitionId: string) {
  return DIALOGUE_AGENT_ENABLED_SESSIONS.has(sessionDefinitionId);
}

/** Task intents (note2026_09_19_s01_task_intents): what a turn that asks the
 * task still leaves out of the step's must-include content, as the
 * descriptions Claude was given. Empty when nothing is missing. */
export function missingIntentContent(text: string, taskIntent: DialogueContract["taskIntent"]): string[] {
  if (!taskIntent) return [];
  return taskIntent.mustMention
    .filter(({ pattern }) => {
      try {
        return !new RegExp(pattern, "i").test(text);
      } catch {
        return false;
      }
    })
    .map(({ describe }) => describe);
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
  // fallback. `recordable: false` (summary fidelity, note2026_09_15): the
  // summary holds a tentative interpretation or could not be verified, so a
  // "yes" to it must not write it to the record.
  summaryCheck?: { summaryText: string; correction?: FieldCorrection; recordable?: boolean };
  // Adaptive dialogue (note2026_09_15_olivia_persona): the shipped text is a
  // follow-up question about what the participant said, and the task waits --
  // the caller marks the message with a pending exploration.
  exploration?: boolean;
  // The participant's themes as Claude updated them this turn, kept only
  // where they are the participant's own words. Undefined when Claude gave
  // none (the caller then leaves the previous ones in place).
  patientThemes?: string[];
  // `guard_log:<check>` entries from dialogue-output-validator.ts's log-mode
  // checks (open dialogue v1): recorded, not enforced.
  guardLogs?: string[];
};

/**
 * The single integration point both the "normal next question" path
 * (runtime-orchestrator.ts) and the "clarification" path
 * (runtime-execution-api.ts) call through, so the compile -> call ->
 * validate -> fall back sequence lives in exactly one place. A turn makes one
 * Claude call, plus -- only when it ends in a summary -- a fidelity check, and
 * at most one rewrite (added meaning, or a task intent's must-include content
 * left out). deterministicFallbackText is ALWAYS what ships if
 * anything here fails or fails validation -- this function can only ever
 * replace the wording of a turn, or hold the task for a confirmation or an
 * exploration question the caller supports, never the runtime's own decision
 * about what happens next.
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
  /** The caller can hold the task for an exploration question -- narrowed
   * here by the per-task and per-session limits. */
  explorationAllowed?: boolean;
  /** Consecutive exploration turns already spent on this task. */
  explorationTurnsInStep?: number;
}): Promise<DialogueAgentTurnResult> {
  if (isSafetyCriticalPrompt(input.sourcePromptItem)) {
    return { patientMessage: input.deterministicFallbackText, decision: null, usedFallback: false, excludedBySafety: true, fallbackReason: "safety_critical_prompt_excluded", provider: "deterministic" };
  }
  const explorationTurns = { step: input.explorationTurnsInStep ?? 0, session: countExplorationTurns(input.recentMessages) };
  const participantTexts = [
    ...input.recentMessages.filter((message) => message.role === "patient").map((message) => message.content),
    ...(input.lastParticipantMessage ? [input.lastParticipantMessage] : []),
  ];
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
    reflectionsSoFar: countReflectionChecks(input.recentMessages),
    explorationAllowed: Boolean(input.explorationAllowed) && explorationTurns.step < MAX_EXPLORATION_TURNS_PER_STEP && explorationTurns.session < MAX_EXPLORATION_TURNS_PER_SESSION,
    explorationTurns,
    patientThemes: latestPatientThemes(input.recentMessages),
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
  const fidelityLogs: string[] = [];
  let recordable: boolean | undefined;
  // At most one rewrite per turn, whichever check asks for it first.
  let rewritten = false;

  // Task intents (note2026_09_19_s01_task_intents): a turn that asks the task
  // must carry the step's must-include content (a scale's two ends, the
  // manual's explanation). A gap gets one rewrite with the reason, then the
  // approved text. A confirmation or exploration turn does not ask the task.
  const intentGaps = () => (validation.accepted && !validation.summaryCheck && !validation.exploration
    ? missingIntentContent(validation.finalText ?? decision.patientFacingMessage, contract.taskIntent)
    : []);
  let gaps = intentGaps();
  if (gaps.length) {
    fidelityLogs.push("guard_log:task_intent_missing_content");
    if (latencyMs < REWRITE_LATENCY_BUDGET_MS) {
      rewritten = true;
      const rewriteContract: DialogueContract = { ...contract, intentFeedback: gaps.join("; ") };
      const rewrite = await callDialogueAgent(rewriteContract, context);
      if (!rewrite.failed) {
        const rewriteValidation = validateDialogueDecision(rewrite.decision, rewriteContract);
        if (rewriteValidation.accepted) {
          decision = rewrite.decision;
          validation = rewriteValidation;
          provider = rewrite.provider;
          model = rewrite.model;
          latencyMs = result.latencyMs + rewrite.latencyMs;
          gaps = intentGaps();
        }
      }
    }
    if (gaps.length) {
      return { patientMessage: input.deterministicFallbackText, decision, usedFallback: true, fallbackReason: "task_intent_missing_content", provider, model, latencyMs, guardLogs: [...validation.guardLogs, ...fidelityLogs] };
    }
  }

  // Summary fidelity (note2026_09_15_olivia_persona): a summary is checked
  // against the participant's words before they see it. Added meaning gets
  // one rewrite with the reason; if that still adds meaning, the approved
  // task text ships instead. A record correction is not a summary.
  const summaryToCheck = () => (validation.accepted && validation.summaryCheck && !validation.summaryCheck.correction ? validation.summaryCheck.summaryText : undefined);
  const judge = (summary: string) => checkSummaryFidelity({ locale: contract.locale, participantMessages: participantTexts.slice(-6).length ? participantTexts.slice(-6) : [""], summary }, context);
  let summary = summaryToCheck();
  if (summary) {
    let fidelity = await judge(summary);
    if (fidelity.checked && !fidelity.faithful) {
      fidelityLogs.push("guard_log:summary_added_meaning");
      if (!rewritten && latencyMs < REWRITE_LATENCY_BUDGET_MS) {
        const rewriteContract: DialogueContract = { ...contract, fidelityFeedback: fidelity.addedMeaning ?? "an interpretation they did not state" };
        const rewrite = await callDialogueAgent(rewriteContract, context);
        if (!rewrite.failed) {
          const rewriteValidation = validateDialogueDecision(rewrite.decision, rewriteContract);
          if (rewriteValidation.accepted) {
            decision = rewrite.decision;
            validation = rewriteValidation;
            provider = rewrite.provider;
            model = rewrite.model;
            latencyMs = result.latencyMs + rewrite.latencyMs;
            summary = summaryToCheck();
            // A rewrite without a summary has nothing left to check.
            fidelity = summary ? await judge(summary) : { faithful: true, checked: true };
          }
        }
      }
    }
    if (fidelity.checked && !fidelity.faithful) {
      return { patientMessage: input.deterministicFallbackText, decision, usedFallback: true, fallbackReason: "summary_added_meaning", provider, model, latencyMs, guardLogs: [...(validation.guardLogs ?? []), ...fidelityLogs] };
    }
    if (summary) recordable = fidelity.checked && !fidelity.tentative;
  }

  if (!validation.accepted) {
    return { patientMessage: input.deterministicFallbackText, decision, usedFallback: true, fallbackReason: validation.reason, provider, model, latencyMs, guardLogs: [...validation.guardLogs, ...fidelityLogs] };
  }
  const summaryCheck = validation.summaryCheck ? { ...validation.summaryCheck, ...(recordable === undefined ? {} : { recordable }) } : undefined;
  return {
    patientMessage: validation.finalText ?? decision.patientFacingMessage,
    decision,
    usedFallback: false,
    provider,
    model,
    latencyMs,
    summaryCheck,
    exploration: validation.exploration,
    patientThemes: decision.patientThemes ? keepVerbatimThemes(decision.patientThemes, participantTexts) : undefined,
    guardLogs: [...validation.guardLogs, ...fidelityLogs],
  };
}
