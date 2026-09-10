import type {
  ClinicianEscalationEvent,
  RuntimeCheckpoint,
  RuntimeExecutionTrace,
  RuntimeMessage,
  RuntimeProviderEvent,
  RuntimeSession,
  RuntimeValidationEvent,
  SessionExecutionLog,
} from "@/types/runtime-session";
import type { RuntimeStoreOp } from "@/shared/runtime/runtime-store-ops";

// In-memory stand-in for src/lib/server/runtime-session-store.ts, used only
// by the test fetch interceptor (src/test/setup.ts) so unit tests stay fast,
// offline, and independent of the live Neon database. Mirrors the exact same
// op contract and behavior (including the two transactional operations) as
// the real Postgres-backed store; deep-clones on every read/write like Dexie
// did, so callers can't mutate the store by mutating a returned reference.

const sessions = new Map<string, RuntimeSession>();
const messages = new Map<string, RuntimeMessage>();
const logs = new Map<string, SessionExecutionLog>();
const checkpoints = new Map<string, RuntimeCheckpoint>();
const escalations = new Map<string, ClinicianEscalationEvent>();
const providerEvents = new Map<string, RuntimeProviderEvent>();
const validationEvents = new Map<string, RuntimeValidationEvent>();
const executionTraces = new Map<string, RuntimeExecutionTrace>();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function resetFakeRuntimeStore() {
  sessions.clear();
  messages.clear();
  logs.clear();
  checkpoints.clear();
  escalations.clear();
  providerEvents.clear();
  validationEvents.clear();
  executionTraces.clear();
}

function createSession(session: RuntimeSession) {
  sessions.set(session.id, clone(session));
  return session;
}

function updateSession(sessionId: string, patch: Partial<RuntimeSession>) {
  const current = sessions.get(sessionId);
  if (!current) throw new Error("Runtime session not found");
  const next: RuntimeSession = { ...current, ...patch, updatedAt: new Date().toISOString() };
  sessions.set(sessionId, clone(next));
  return next;
}

function claimPatientTurn(input: {
  sessionId: string;
  clientTurnId: string;
  expectedSessionVersion: number;
  patientMessage: RuntimeMessage;
}) {
  const current = sessions.get(input.sessionId);
  if (!current) throw new Error("Runtime session not found");
  if (input.patientMessage.runtimeSessionId !== input.sessionId) throw new Error("Patient message session does not match the turn claim");
  const currentVersion = current.version ?? 0;
  const canClaim = current.status === "waiting_for_input"
    && currentVersion === input.expectedSessionVersion
    && current.pendingTurnId === undefined
    && current.lastCompletedTurnId !== input.clientTurnId;
  if (!canClaim) return { claimed: false as const, session: clone(current) };

  const next: RuntimeSession = {
    ...current,
    status: "processing",
    pendingTurnId: input.clientTurnId,
    version: currentVersion + 1,
    messageIds: [...new Set([...current.messageIds, input.patientMessage.id])],
    runtimeContext: { ...current.runtimeContext, lastPatientMessage: input.patientMessage.content },
    updatedAt: new Date().toISOString(),
  };
  if (!messages.has(input.patientMessage.id)) messages.set(input.patientMessage.id, clone(input.patientMessage));
  sessions.set(input.sessionId, clone(next));
  return { claimed: true as const, session: next };
}

function claimSessionStart(sessionId: string) {
  const current = sessions.get(sessionId);
  if (!current) throw new Error("Runtime session not found");
  if (current.status !== "created") return { claimed: false as const, session: clone(current) };
  const next: RuntimeSession = { ...current, status: "preparing", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  sessions.set(sessionId, clone(next));
  return { claimed: true as const, session: next };
}

function saveMessage(message: RuntimeMessage) {
  messages.set(message.id, clone(message));
  const session = sessions.get(message.runtimeSessionId);
  if (session) {
    const next: RuntimeSession = {
      ...session,
      messageIds: [...new Set([...session.messageIds, message.id])],
      updatedAt: new Date().toISOString(),
      runtimeContext: {
        ...session.runtimeContext,
        lastPatientMessage: message.role === "patient" ? message.content : session.runtimeContext.lastPatientMessage,
        lastAssistantMessage: message.role === "assistant" ? message.content : session.runtimeContext.lastAssistantMessage,
      },
    };
    sessions.set(message.runtimeSessionId, clone(next));
  }
  return message;
}

function saveLog(log: SessionExecutionLog) {
  logs.set(log.id, clone(log));
  const session = sessions.get(log.runtimeSessionId);
  if (session) {
    const next: RuntimeSession = { ...session, executionLogIds: [...new Set([...session.executionLogIds, log.id])], updatedAt: new Date().toISOString() };
    sessions.set(log.runtimeSessionId, clone(next));
  }
  return log;
}

function saveEscalation(event: ClinicianEscalationEvent) {
  escalations.set(event.id, clone(event));
  const session = sessions.get(event.runtimeSessionId);
  if (session) {
    const next: RuntimeSession = { ...session, escalationIds: [...new Set([...session.escalationIds, event.id])], updatedAt: new Date().toISOString() };
    sessions.set(event.runtimeSessionId, clone(next));
  }
  return event;
}

function updateEscalation(escalationId: string, patch: Partial<ClinicianEscalationEvent>) {
  const current = escalations.get(escalationId);
  if (!current) throw new Error("Escalation event not found");
  const next = { ...current, ...patch };
  escalations.set(escalationId, clone(next));
  return next;
}

function commitAssistantTurn(input: {
  sessionId: string;
  assistantMessage: RuntimeMessage;
  providerEvent: RuntimeProviderEvent;
  validationEvent: RuntimeValidationEvent;
  trace: RuntimeExecutionTrace;
  sessionPatch: Partial<RuntimeSession>;
}) {
  const current = sessions.get(input.sessionId);
  if (!current) throw new Error("Runtime session not found");
  const turnId = typeof input.assistantMessage.metadata?.turnId === "string" ? input.assistantMessage.metadata.turnId : undefined;
  // Mirrors the real store (src/lib/server/runtime-session-store.ts): a
  // repeat_until PromptItem is delivered more than once for the same
  // nodeId/promptItemId by design, so prefer clientTurnId to identify a
  // true duplicate commit and only fall back to nodeId/promptItemId for an
  // assistant-only delivery with no turn attached at all.
  const clientTurnId = typeof input.assistantMessage.metadata?.clientTurnId === "string" ? input.assistantMessage.metadata.clientTurnId : undefined;
  const duplicate = [...messages.values()].find((message) => message.runtimeSessionId === input.sessionId
    && message.role === "assistant"
    && (clientTurnId
      ? message.metadata?.clientTurnId === clientTurnId
      : turnId
        ? message.metadata?.turnId === turnId
        : message.nodeId === input.assistantMessage.nodeId && message.promptItemId === input.assistantMessage.promptItemId));
  if (duplicate) return { session: clone(current), assistantMessage: clone(duplicate), duplicate: true };

  if (!messages.has(input.assistantMessage.id)) messages.set(input.assistantMessage.id, clone(input.assistantMessage));
  providerEvents.set(input.providerEvent.id, clone(input.providerEvent));
  validationEvents.set(input.validationEvent.id, clone(input.validationEvent));
  executionTraces.set(input.trace.id, clone(input.trace));

  const nextSession: RuntimeSession = {
    ...current,
    ...input.sessionPatch,
    pendingTurnId: current.pendingTurnId && input.sessionPatch.status !== "processing" ? undefined : input.sessionPatch.pendingTurnId ?? current.pendingTurnId,
    lastCompletedTurnId: current.pendingTurnId && input.sessionPatch.status !== "processing" ? current.pendingTurnId : input.sessionPatch.lastCompletedTurnId ?? current.lastCompletedTurnId,
    messageIds: [...new Set([...current.messageIds, ...(input.sessionPatch.messageIds ?? []), input.assistantMessage.id])],
    runtimeContext: { ...current.runtimeContext, ...input.sessionPatch.runtimeContext, lastAssistantMessage: input.assistantMessage.content },
    updatedAt: new Date().toISOString(),
  };
  sessions.set(input.sessionId, clone(nextSession));
  return { session: nextSession, assistantMessage: input.assistantMessage, duplicate: false };
}

export async function dispatchFakeRuntimeStoreOp(op: RuntimeStoreOp): Promise<unknown> {
  switch (op.op) {
    case "createSession": return clone(createSession(op.session));
    case "updateSession": return clone(updateSession(op.sessionId, op.patch));
    case "claimPatientTurn": return clone(claimPatientTurn(op));
    case "claimSessionStart": return clone(claimSessionStart(op.sessionId));
    case "getSession": {
      const found = sessions.get(op.sessionId);
      return found ? clone(found) : undefined;
    }
    case "listSessions": return [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone);
    case "listSessionsByParticipant": return [...sessions.values()].filter((s) => s.participantId === op.participantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone);
    case "deleteSession": {
      sessions.delete(op.sessionId);
      for (const [id, message] of messages) if (message.runtimeSessionId === op.sessionId) messages.delete(id);
      for (const [id, log] of logs) if (log.runtimeSessionId === op.sessionId) logs.delete(id);
      for (const [id, checkpoint] of checkpoints) if (checkpoint.runtimeSessionId === op.sessionId) checkpoints.delete(id);
      for (const [id, escalation] of escalations) if (escalation.runtimeSessionId === op.sessionId) escalations.delete(id);
      for (const [id, event] of providerEvents) if (event.runtimeSessionId === op.sessionId) providerEvents.delete(id);
      for (const [id, event] of validationEvents) if (event.runtimeSessionId === op.sessionId) validationEvents.delete(id);
      for (const [id, trace] of executionTraces) if (trace.runtimeSessionId === op.sessionId) executionTraces.delete(id);
      return undefined;
    }
    case "saveMessage": return clone(saveMessage(op.message));
    case "listMessages": return [...messages.values()].filter((m) => m.runtimeSessionId === op.runtimeSessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
    case "saveLog": return clone(saveLog(op.log));
    case "listLogs": return [...logs.values()].filter((l) => l.runtimeSessionId === op.runtimeSessionId).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(clone);
    case "saveCheckpoint": {
      checkpoints.set(op.checkpoint.id, clone(op.checkpoint));
      return op.checkpoint;
    }
    case "getLatestCheckpoint": {
      const found = [...checkpoints.values()].filter((c) => c.runtimeSessionId === op.runtimeSessionId).sort((a, b) => b.sequence - a.sequence)[0];
      return found ? clone(found) : undefined;
    }
    case "listCheckpoints": return [...checkpoints.values()].filter((c) => c.runtimeSessionId === op.runtimeSessionId).sort((a, b) => a.sequence - b.sequence).map(clone);
    case "saveEscalation": return clone(saveEscalation(op.event));
    case "updateEscalation": return clone(updateEscalation(op.escalationId, op.patch));
    case "listEscalations": return [...escalations.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone);
    case "listEscalationsBySession": return [...escalations.values()].filter((e) => e.runtimeSessionId === op.runtimeSessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
    case "saveProviderEvent": {
      providerEvents.set(op.event.id, clone(op.event));
      return undefined;
    }
    case "listProviderEvents": return [...providerEvents.values()].filter((e) => e.runtimeSessionId === op.runtimeSessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
    case "saveValidationEvent": {
      validationEvents.set(op.event.id, clone(op.event));
      return undefined;
    }
    case "listValidationEvents": return [...validationEvents.values()].filter((e) => e.runtimeSessionId === op.runtimeSessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
    case "saveExecutionTrace": {
      executionTraces.set(op.trace.id, clone(op.trace));
      return op.trace;
    }
    case "listExecutionTraces": return [...executionTraces.values()].filter((t) => t.runtimeSessionId === op.runtimeSessionId).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(clone);
    case "commitAssistantTurn": return clone(commitAssistantTurn(op.input));
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown runtime store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
