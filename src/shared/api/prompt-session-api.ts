// The runtime for prompt-driven sessions (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02). One system prompt runs the whole
// session; this file only does what the prompt must not:
//
//  - safety: every participant message is checked in code before the model
//    sees it. A current disclosure goes through handleTriggeredSafetyTurn --
//    the same fixed response, safety event, escalation and hold as every other
//    session. Wording that may not be a current disclosure gets the same fixed
//    clarification question. A model that is worried sets safetyConcern and
//    gets that question too; the model never writes a crisis message.
//  - storage: the model's fieldUpdates are checked against the session's field
//    list, merged, worked out (CD-Quest scores and totals) and projected to the
//    worksheet; each message is committed with its own turn id.
//  - pacing: a message that asks nothing is followed straight away by the next
//    one (up to a few, within a time budget); completion and "not today" end or
//    pause the session.
//
// Sessions 3-8 do not come through here.

import { claimRuntimePatientTurn, commitRuntimeAssistantTurn, saveRuntimeLog, updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { createRuntimeCheckpoint, getRuntimeSessionForTurn } from "@/shared/api/runtime-session-api";
import { completeRuntimeSession, handleTriggeredSafetyTurn } from "@/shared/api/runtime-execution-api";
import { assessTurnRisk } from "@/shared/runtime/runtime-context";
import { runSafetyOrchestrator } from "@/shared/runtime/runtime-safety-orchestrator";
import { createRuntimeExecutionTrace } from "@/shared/runtime/runtime-execution-tracer";
import { loadRuntimeRelease, normalizeRuntimeSessionState } from "@/shared/runtime/runtime-release-loader";
import { describePatientInputForDisplay } from "@/shared/runtime/patient-input-display";
import { safetyClarificationText } from "@/shared/runtime/safety-clarification";
import { projectRuntimeFieldsToWorksheet } from "@/shared/worksheet/worksheet-projection";
import { runMemoryRetrieval } from "@/shared/api/longitudinal-memory-api";
import { injectLongitudinalMemory } from "@/shared/memory/memory-context-injector";
import { resolveLongitudinalMemoryPolicy } from "@/shared/memory/memory-policy";
import { generatePromptSessionTurn, type PromptHistoryMessage, type PromptSessionResult, type PromptSessionTurn } from "@/shared/dialogue-agent/prompt-session-agent";
import { PROMPT_FOCUS_FIELD, PROMPT_INPUT_HINT, checkFieldUpdates, derivePromptSessionFields, promptSessionFieldValues, type PromptInputHint } from "@/shared/runtime/prompt-driven-sessions";
import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimePromptItem } from "@/types/protocol-runtime";
import type { PatientInput, RuntimeCycleResult, RuntimeMessage, RuntimeSession, RuntimeSessionStatus, RuntimeSessionView, SessionExecutionLog } from "@/types/runtime-session";

/** Messages in a row that ask nothing, before the program stops and waits. */
const MAX_CHAINED_MESSAGES = 4;
/** Stop chaining past this, so a turn stays inside the 60s route limit. The
 * session is left "active" and the patient page's auto-retry continues it. */
const CHAIN_TIME_BUDGET_MS = 40_000;

const VISIBLE_ASSISTANT_STATUSES = new Set(["validated", "delivered", "replaced_by_fallback"]);

const FAILURE_TEXT = {
  ko: "잠시 문제가 생겼어요. 방금 하신 말씀을 한 번만 다시 보내 주시겠어요?",
  en: "Something went wrong for a moment. Could you send that once more?",
};
/** Nothing has been said yet, so there is nothing to send again. */
const FAILURE_BEFORE_PARTICIPANT_TEXT = {
  ko: "잠시 문제가 생겼어요. 준비되시면 아무 말이나 보내 주세요. 거기서부터 시작할게요.",
  en: "Something went wrong for a moment. Send anything when you're ready, and we'll start from there.",
};

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeLog(runtimeSessionId: string, stage: SessionExecutionLog["stage"], status: SessionExecutionLog["status"], summary: string, extra: Partial<SessionExecutionLog> = {}): SessionExecutionLog {
  return { id: makeId("RLOG"), runtimeSessionId, timestamp: new Date().toISOString(), stage, status, summary, ...extra };
}

function isKorean(locale: string | undefined) {
  return (locale ?? "").toLowerCase().startsWith("ko");
}

const NO_SAFETY = { triggered: false as const, ruleIds: [] as string[], action: "continue" as const, escalationRequired: false as const };

type Anchor = {
  node: ClinicalStageNode;
  promptItem: PromptItem;
  runtimePromptItem: RuntimePromptItem;
  runtimeState: NonNullable<RuntimeSession["runtimeState"]>;
};

/**
 * The conversation node every prompt-driven message is recorded against: the
 * session's orientation node (see s01/spec.ts). A session stored under the old
 * S01/S02 graph points at node ids that no longer exist; it is moved here and
 * carries on from its message history.
 */
function anchorFor(view: RuntimeSessionView): Anchor {
  const session = view.session;
  const node = view.nodes.find((item) => item.sessionId === session.sessionDefinitionId && item.type === "orientation") ?? view.nodes.find((item) => item.type === "orientation");
  if (!node) throw new Error(`${session.sessionDefinitionId} has no conversation node`);
  const promptItem = view.promptItems.find((item) => item.nodeId === node.id);
  if (!promptItem) throw new Error(`${session.sessionDefinitionId} conversation node has no prompt`);
  const release = loadRuntimeRelease(view.release);
  const runtimePromptItem = release.promptItems.find((item) => item.sourcePromptItemId === promptItem.id) ?? release.promptItems.find((item) => item.id === promptItem.id);
  if (!runtimePromptItem) throw new Error(`${promptItem.id} is missing from the release`);
  const base = normalizeRuntimeSessionState({ ...session, currentNodeId: node.id, currentPromptItemId: runtimePromptItem.id }, release);
  return { node, promptItem, runtimePromptItem, runtimeState: { ...base, activeNodeId: node.id, activePromptItemId: runtimePromptItem.id } };
}

function historyOf(messages: RuntimeMessage[]): PromptHistoryMessage[] {
  return messages
    .filter((message) => (message.role === "patient" && message.content.trim()) || (message.role === "assistant" && VISIBLE_ASSISTANT_STATUSES.has(message.status)))
    .map((message) => ({ role: message.role === "patient" ? "participant" : "assistant", content: message.content }));
}

/** What the program tells the model on this call, besides the conversation. */
function programBlock(session: RuntimeSession, facts: string[], notes: string[]) {
  const fields = session.runtimeContext.fields;
  const earlier = Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith("previous")));
  const memory = session.runtimeContext.longitudinalMemory?.items ?? [];
  const lines = [
    `Worksheet now: ${JSON.stringify(promptSessionFieldValues(session.sessionDefinitionId, fields))}`,
    ...facts,
    ...(Object.keys(earlier).length ? [`From earlier sessions (program note): ${JSON.stringify(earlier)}`] : []),
    ...(memory.length ? [`Notes kept from earlier sessions (background only, never the participant's words from today): ${memory.map((item) => `[${item.type}] ${item.content}`).join(" | ")}`] : []),
    ...notes,
  ];
  return lines.join("\n");
}

function assistantMessage(session: RuntimeSession, anchor: Anchor, content: string, metadata: Record<string, unknown>): RuntimeMessage {
  const now = new Date().toISOString();
  return {
    id: makeId("RMSG"),
    runtimeSessionId: session.id,
    role: "assistant",
    content,
    status: "delivered",
    nodeId: anchor.node.id,
    promptItemId: anchor.promptItem.id,
    sourceEvidenceIds: [],
    createdAt: now,
    deliveredAt: now,
    // A unique turnId and no clientTurnId: the store de-duplicates assistant
    // messages by those, and several of these can belong to one turn.
    metadata: { turnId: makeId("TURN"), ...metadata },
  };
}

async function commit(input: {
  view: RuntimeSessionView;
  anchor: Anchor;
  message: RuntimeMessage;
  provider: string;
  model: string;
  contractHash: string;
  transition: string;
  fields: Record<string, unknown>;
  contextPatch?: Partial<RuntimeSession["runtimeContext"]>;
  status: RuntimeSessionStatus;
  fallbackUsed?: boolean;
}) {
  const { view, anchor, message } = input;
  const session = view.session;
  const validation = { accepted: true, corrected: false, rejected: false, issues: [], finalText: message.content, fallbackRequired: false };
  await commitRuntimeAssistantTurn({
    sessionId: session.id,
    assistantMessage: message,
    providerEvent: { id: makeId("RPE"), runtimeSessionId: session.id, provider: input.provider, model: input.model, nodeId: anchor.node.id, promptItemId: anchor.promptItem.id, inputSummary: `prompt_session:${input.transition}`, outputText: message.content, createdAt: new Date().toISOString() },
    validationEvent: { id: makeId("RVE"), runtimeSessionId: session.id, nodeId: anchor.node.id, promptItemId: anchor.promptItem.id, ...validation, createdAt: new Date().toISOString() },
    trace: createRuntimeExecutionTrace({
      runtimeSessionId: session.id,
      releaseId: view.release.id,
      nodeId: anchor.node.id,
      promptItemId: anchor.promptItem.id,
      roleId: anchor.runtimePromptItem.roleId,
      provider: input.provider,
      model: input.model,
      contractHash: input.contractHash,
      validation,
      fallbackUsed: input.fallbackUsed ?? false,
      transitionDecision: input.transition,
      stateChanges: { activeNodeId: anchor.node.id, activePromptItemId: anchor.promptItem.id },
      fidelityEvidence: { locale: session.locale, patientFacingText: message.content, activePromptMatches: true, patientInputPresent: false },
    }),
    sessionPatch: {
      runtimeContext: { ...session.runtimeContext, fields: input.fields, lastAssistantMessage: message.content, ...input.contextPatch },
      currentNodeId: anchor.node.id,
      currentPromptItemId: anchor.runtimePromptItem.id,
      runtimeState: { ...anchor.runtimeState, fields: input.fields, turnCount: (anchor.runtimeState.turnCount ?? 0) + 1 },
      promptProgressionReason: input.transition === "clarification" ? "clarification_sent" : "prompt_delivered",
      status: input.status,
    },
  });
}

/** The fixed safety clarification, sent instead of a model message. */
async function deliverSafetyClarification(view: RuntimeSessionView, anchor: Anchor, fields: Record<string, unknown>, reason: string): Promise<RuntimeCycleResult> {
  const session = view.session;
  const message = assistantMessage(session, anchor, safetyClarificationText(session.locale), { turnOutcome: "clarification", clarificationReason: "safety_clarification", promptSessionSafetyReason: reason });
  await commit({
    view,
    anchor,
    message,
    provider: "deterministic",
    model: "runtime-clarification",
    contractHash: `clarification:${session.id}:${anchor.promptItem.id}`,
    transition: "clarification",
    fields: { ...fields, [PROMPT_INPUT_HINT]: "text" },
    contextPatch: { lastClarificationReason: "safety_clarification" },
    status: "waiting_for_input",
  });
  void saveRuntimeLog(makeLog(session.id, "safety_check", "completed", "Ambiguous safety language requires neutral clarification", { nodeId: anchor.node.id, output: { reason } })).catch(() => {});
  void createRuntimeCheckpoint(session.id).catch(() => {});
  return { sessionId: session.id, currentNodeId: anchor.node.id, currentPromptItemId: anchor.promptItem.id, safetyResult: NO_SAFETY, generatedMessage: message, turnOutcome: "clarification", fallbackUsed: false, sessionStatus: "waiting_for_input", logIds: [] };
}

async function callModel(view: RuntimeSessionView, facts: string[], notes: string[], continueWithoutParticipant: boolean): Promise<PromptSessionResult> {
  const session = view.session;
  const request = {
    sessionDefinitionId: session.sessionDefinitionId,
    locale: session.locale ?? "en-US",
    history: historyOf(view.messages),
    programBlock: programBlock(session, facts, notes),
    continueWithoutParticipant,
  };
  const context = { sessionId: session.id, turnId: makeId("TURN") };
  const first = await generatePromptSessionTurn(request, context);
  if (first.ok || first.notConfigured) return first;
  // One more try with the reason, then the fixed line.
  return generatePromptSessionTurn({ ...request, correction: `Your last answer could not be used (${first.error.slice(0, 200)}). Answer again through the tool.` }, context);
}

/**
 * Asks the model for the next message and records it; keeps going while the
 * message asks nothing. `notes` go to the first call only.
 */
async function runChain(sessionId: string, options: { notes: string[]; participantSpoke: boolean }): Promise<RuntimeCycleResult> {
  const started = Date.now();
  let notes = options.notes;
  let continueWithoutParticipant = !options.participantSpoke;
  const participantSpoke = options.participantSpoke;
  for (let chained = 0; ; chained += 1) {
    const view = await getRuntimeSessionForTurn(sessionId);
    if (!view) throw new Error("Runtime session not found");
    const session = view.session;
    const anchor = anchorFor(view);
    const current = derivePromptSessionFields(session.sessionDefinitionId, session.runtimeContext.fields, session.locale);
    const result = await callModel(view, current.facts, notes, continueWithoutParticipant);
    notes = [];
    continueWithoutParticipant = true;

    if (!result.ok) {
      const text = participantSpoke && chained === 0 ? FAILURE_TEXT : FAILURE_BEFORE_PARTICIPANT_TEXT;
      const message = assistantMessage(session, anchor, isKorean(session.locale) ? text.ko : text.en, { turnOutcome: "fallback", promptSessionError: result.error });
      await commit({ view, anchor, message, provider: "deterministic", model: "prompt-session-fallback", contractHash: `prompt_session:${session.id}:failure`, transition: "fallback", fields: { ...session.runtimeContext.fields, [PROMPT_INPUT_HINT]: "text" }, status: "waiting_for_input", fallbackUsed: true });
      void saveRuntimeLog(makeLog(session.id, "language_generation", "failed", "Prompt session model call failed", { nodeId: anchor.node.id, error: result.error })).catch(() => {});
      return { sessionId, currentNodeId: anchor.node.id, currentPromptItemId: anchor.promptItem.id, safetyResult: NO_SAFETY, generatedMessage: message, turnOutcome: "fallback", fallbackUsed: true, sessionStatus: "waiting_for_input", logIds: [] };
    }

    const turn: PromptSessionTurn = result.turn;
    const { accepted, rejected } = checkFieldUpdates(session.sessionDefinitionId, turn.fieldUpdates);
    const worked = derivePromptSessionFields(session.sessionDefinitionId, { ...session.runtimeContext.fields, ...accepted }, session.locale).fields;
    const fields: Record<string, unknown> = { ...worked, [PROMPT_FOCUS_FIELD]: turn.focusField ?? undefined, [PROMPT_INPUT_HINT]: turn.inputHint };
    if (rejected.length) void saveRuntimeLog(makeLog(session.id, "state_extraction", "failed", "Prompt session field updates rejected", { nodeId: anchor.node.id, output: { rejected } })).catch(() => {});

    if (turn.safetyConcern) return deliverSafetyClarification(view, anchor, fields, "model_safety_concern");

    try {
      await projectRuntimeFieldsToWorksheet({ runtimeSessionId: session.id, sessionDefinitionId: session.sessionDefinitionId, fields, sourceTurnId: makeId("TURN") });
    } catch (error) {
      console.error("[prompt-session-api] worksheet projection failed", { sessionId, error });
    }

    const withinBudget = Date.now() - started < CHAIN_TIME_BUDGET_MS && chained + 1 < MAX_CHAINED_MESSAGES;
    const keepsGoing = turn.inputHint === "none" && !turn.sessionComplete && !turn.pauseSession;
    const status: RuntimeSessionStatus = turn.sessionComplete || turn.pauseSession ? "processing" : keepsGoing ? (withinBudget ? "processing" : "active") : "waiting_for_input";
    const message = assistantMessage(session, anchor, turn.reply, {
      turnOutcome: "normal",
      promptSessionVersion: result.promptVersion,
      promptSessionSha256: result.promptSha256,
      inputHint: turn.inputHint,
      focusField: turn.focusField ?? null,
      ...(rejected.length ? { rejectedFieldUpdates: rejected } : {}),
    });
    await commit({
      view,
      anchor,
      message,
      provider: "anthropic",
      model: result.model,
      contractHash: `prompt_session:${session.sessionDefinitionId}:${result.promptSha256.slice(0, 16)}`,
      transition: turn.sessionComplete ? "complete_session" : turn.pauseSession ? "pause_session" : "prompt_session",
      fields,
      // "" rather than undefined: the store merges runtimeContext one level
      // deep and undefined does not survive JSON, so undefined would leave a
      // pending safety clarification in place and every later answer would be
      // read as an answer to it.
      contextPatch: { lastClarificationReason: "", clarificationAttemptCount: 0 },
      status,
    });

    if (turn.sessionComplete) {
      await completeRuntimeSession(sessionId);
      return { sessionId, currentNodeId: anchor.node.id, currentPromptItemId: anchor.promptItem.id, safetyResult: NO_SAFETY, generatedMessage: message, turnOutcome: "normal", fallbackUsed: false, sessionStatus: "completed", logIds: [] };
    }
    if (turn.pauseSession) {
      await updateRuntimeSessionRecord(sessionId, { status: "paused", pausedAt: new Date().toISOString() });
      void saveRuntimeLog(makeLog(sessionId, "session", "completed", "Session paused: participant chose to stop for today", { nodeId: anchor.node.id })).catch(() => {});
      await createRuntimeCheckpoint(sessionId);
      return { sessionId, currentNodeId: anchor.node.id, currentPromptItemId: anchor.promptItem.id, safetyResult: NO_SAFETY, generatedMessage: message, turnOutcome: "normal", fallbackUsed: false, sessionStatus: "paused", logIds: [] };
    }
    if (!keepsGoing || !withinBudget) {
      void createRuntimeCheckpoint(sessionId).catch(() => {});
      return { sessionId, currentNodeId: anchor.node.id, currentPromptItemId: anchor.promptItem.id, safetyResult: NO_SAFETY, generatedMessage: message, turnOutcome: "normal", fallbackUsed: false, sessionStatus: status, logIds: [] };
    }
  }
}

/**
 * Cross-session memory, retrieved once when the session starts -- the same
 * retrieval, policy and consent gate executeCurrentNode runs for every node of
 * Sessions 3-8. Never blocks the session: a failure or missing consent is
 * logged and the session goes on without it.
 */
async function retrieveMemory(view: RuntimeSessionView, node: ClinicalStageNode) {
  const session = view.session;
  const policy = resolveLongitudinalMemoryPolicy();
  const retrieval = await runMemoryRetrieval({
    participantId: session.participantId,
    runtimeSessionId: session.id,
    protocolId: session.protocolId,
    protocolVersion: session.protocolVersion,
    sessionDefinitionId: session.sessionDefinitionId,
    currentNodeId: node.id,
    currentNodeType: node.type as import("@/types/protocol-runtime").ProtocolNodeType,
    currentClinicalIntent: node.clinicalPurpose ?? node.title,
    requestedMemoryTypes: policy.allowedMemoryTypes,
    maxItems: policy.maxItemsPerNode,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const consentDisabled = message.includes("Cross-session retrieval is disabled");
    if (!consentDisabled) console.error("[prompt-session-api] memory retrieval failed", { sessionId: session.id, error: message });
    void saveRuntimeLog(makeLog(session.id, "node_resolution", consentDisabled ? "skipped" : "failed", consentDisabled ? "Memory retrieval skipped: cross-session use not consented" : "Memory retrieval failed", { nodeId: node.id, error: consentDisabled ? undefined : message })).catch(() => {});
    return null;
  });
  if (!retrieval) return;
  await updateRuntimeSessionRecord(session.id, { runtimeContext: injectLongitudinalMemory(session.runtimeContext, retrieval.selected) });
}

/**
 * Start, resume, or pick up a session that was left "active": the model
 * writes the next message from the conversation so far. Called in place of
 * executeCurrentNode for prompt-driven sessions.
 */
export async function continuePromptSession(sessionId: string): Promise<RuntimeCycleResult> {
  const view = await getRuntimeSessionForTurn(sessionId);
  if (!view) throw new Error("Runtime session not found");
  const messages = view.messages;
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const notes: string[] = [];
  if (!messages.some((message) => message.role === "assistant")) {
    notes.push("This is the first message of the session.");
    await retrieveMemory(view, anchorFor(view).node);
  } else if (lastAssistant?.metadata?.turnOutcome === "safety_override") {
    notes.push("The session was paused for safety and a clinician has now resumed it. Greet the participant gently, do not bring up what caused the pause, and pick the step up where it stopped.");
  } else if (view.session.pausedAt || view.session.resumedAt) {
    notes.push("The participant has come back to a session that was paused. Greet them briefly and pick the step up where it stopped.");
  }
  if (!["active", "processing", "waiting_for_input"].includes(view.session.status)) {
    await updateRuntimeSessionRecord(sessionId, { status: "active" });
  }
  return runChain(sessionId, { notes, participantSpoke: false });
}

/** A participant message in a prompt-driven session. Called in place of the
 * node engine's turn handling in submitPatientInput. */
export async function submitPromptSessionInput(sessionId: string, patientInput: PatientInput, options: { clientTurnId?: string; expectedSessionVersion?: number; locale?: string }, initialView: RuntimeSessionView): Promise<RuntimeCycleResult> {
  const initialSession = initialView.session;
  const turnLocale = options.locale ?? initialSession.locale;
  if (initialSession.status === "completed") throw new Error("Completed session does not accept input");
  if (initialSession.status === "processing") {
    return { sessionId, currentNodeId: initialSession.currentNodeId ?? "unknown", currentPromptItemId: initialSession.currentPromptItemId, safetyResult: NO_SAFETY, turnOutcome: "rejected_duplicate", fallbackUsed: false, sessionStatus: initialSession.status, logIds: [] };
  }
  if (initialSession.status !== "waiting_for_input") throw new Error("Session is not waiting for input");
  const anchor = anchorFor(initialView);
  const clientTurnId = options.clientTurnId ?? makeId("TURN");
  const patientMessage: RuntimeMessage = {
    id: makeId("RMSG"),
    runtimeSessionId: sessionId,
    role: "patient",
    content: describePatientInputForDisplay(patientInput, turnLocale),
    status: "delivered",
    nodeId: anchor.node.id,
    promptItemId: anchor.promptItem.id,
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    metadata: { inputKind: patientInput.kind, promptItemId: anchor.promptItem.id, clientTurnId },
  };

  // Safety first, in code, before anything reaches the model.
  const risk = assessTurnRisk({ text: patientMessage.content, currentContext: initialSession.runtimeContext });
  const extracted = { fields: initialSession.runtimeContext.fields, riskLevel: risk.riskLevel, riskSignals: risk.riskSignals, missingFields: [] as string[] };
  const safetyContext = { ...initialSession.runtimeContext, riskLevel: risk.riskLevel, riskSignals: risk.riskSignals, lastPatientMessage: patientMessage.content };
  const safetyResult = await runSafetyOrchestrator({ currentNode: anchor.node, extractedState: extracted, runtimeContext: safetyContext });

  const claim = await claimRuntimePatientTurn({
    sessionId,
    clientTurnId,
    expectedSessionVersion: options.expectedSessionVersion ?? initialSession.version ?? 0,
    patientMessage,
    turnPatch: { locale: turnLocale, currentPromptItemId: anchor.runtimePromptItem.id },
  });
  if (!claim.claimed) {
    return { sessionId, currentNodeId: claim.session.currentNodeId ?? "unknown", currentPromptItemId: claim.session.currentPromptItemId, safetyResult: NO_SAFETY, turnOutcome: "rejected_duplicate", fallbackUsed: false, sessionStatus: claim.session.status, logIds: [] };
  }
  const session = { ...claim.session, locale: turnLocale };
  const executionSequence = session.executionLogIds.length + 1;
  void saveRuntimeLog(makeLog(sessionId, "input", "completed", "Patient input received", { nodeId: anchor.node.id, input: { kind: patientInput.kind } })).catch(() => {});
  void saveRuntimeLog(makeLog(sessionId, "safety_check", "completed", safetyResult.triggered ? `Safety triggered: ${safetyResult.action}` : "Safety check passed", { nodeId: anchor.node.id, output: safetyResult as unknown as Record<string, unknown> })).catch(() => {});

  if (safetyResult.triggered) {
    return handleTriggeredSafetyTurn({
      sessionId,
      session,
      currentNode: anchor.node,
      currentPromptItem: anchor.promptItem,
      runtimePromptItem: anchor.runtimePromptItem,
      release: initialView.release,
      runtimeState: anchor.runtimeState,
      patientMessage,
      patientInput,
      safetyContext,
      safetyResult,
      executionSequence,
      extracted,
    });
  }
  const viewAfterClaim: RuntimeSessionView = { ...initialView, session };
  if (risk.riskSignals.includes("ambiguous_safety_language")) {
    return deliverSafetyClarification(viewAfterClaim, anchor, session.runtimeContext.fields, "ambiguous_safety_language");
  }
  const notes = risk.clarificationAnswer === "denied"
    ? ["The program just asked its fixed safety question, and the participant said it was not about harming themselves. Acknowledge that briefly and warmly, then carry on with the step where it was."]
    : [];
  return runChain(sessionId, { notes, participantSpoke: true });
}

export type { PromptInputHint };
