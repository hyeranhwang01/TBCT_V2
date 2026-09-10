import { RUNTIME_STORE_ENDPOINT } from "@/shared/runtime/runtime-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type {
  CommitRuntimeAssistantTurnInput,
  CommitRuntimeAssistantTurnResult,
  RuntimePatientTurnClaim,
  RuntimeSessionStartClaim,
  RuntimeStoreOp,
} from "@/shared/runtime/runtime-store-ops";
import type {
  ClinicianEscalationEvent,
  RuntimeCheckpoint,
  RuntimeMessage,
  RuntimeProviderEvent,
  RuntimeSession,
  RuntimeExecutionTrace,
  RuntimeValidationEvent,
  SessionExecutionLog,
} from "@/types/runtime-session";

export type { RuntimePatientTurnClaim, CommitRuntimeAssistantTurnInput };

// Thin fetch client over src/app/api/runtime/session-store/route.ts. The
// runtime conversation store (sessions, messages, logs, checkpoints,
// escalations, provider/validation events, execution traces) now lives in
// Neon Postgres, not local IndexedDB -- every function here keeps its
// original name and signature so call sites across the app are unaffected.
async function callStore<T>(op: RuntimeStoreOp): Promise<T> {
  const response = await runtimeFetch(resolveStoreUrl(RUNTIME_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Runtime store operation failed.");
  return body.result as T;
}

export async function createRuntimeSessionRecord(session: RuntimeSession) {
  return callStore<RuntimeSession>({ op: "createSession", session });
}

export async function updateRuntimeSessionRecord(sessionId: string, patch: Partial<RuntimeSession>) {
  return callStore<RuntimeSession>({ op: "updateSession", sessionId, patch });
}

export async function claimRuntimePatientTurn(input: {
  sessionId: string;
  clientTurnId: string;
  expectedSessionVersion: number;
  patientMessage: RuntimeMessage;
  turnPatch?: Pick<RuntimeSession, "locale" | "currentPromptItemId" | "skippedPromptItemIds">;
}): Promise<RuntimePatientTurnClaim> {
  return callStore<RuntimePatientTurnClaim>({ op: "claimPatientTurn", ...input });
}

export async function claimRuntimeSessionStart(sessionId: string): Promise<RuntimeSessionStartClaim> {
  return callStore<RuntimeSessionStartClaim>({ op: "claimSessionStart", sessionId });
}

export async function getRuntimeSessionRecord(sessionId: string) {
  return callStore<RuntimeSession | undefined>({ op: "getSession", sessionId });
}

export async function listRuntimeSessionRecords() {
  return callStore<RuntimeSession[]>({ op: "listSessions" });
}

export async function listRuntimeSessionRecordsByParticipant(participantId: string) {
  return callStore<RuntimeSession[]>({ op: "listSessionsByParticipant", participantId });
}

export async function deleteRuntimeSessionRecord(sessionId: string) {
  await callStore<void>({ op: "deleteSession", sessionId });
}

export async function saveRuntimeMessage(message: RuntimeMessage) {
  await callStore<RuntimeMessage>({ op: "saveMessage", message });
  return message;
}

export async function listRuntimeMessages(runtimeSessionId: string) {
  return callStore<RuntimeMessage[]>({ op: "listMessages", runtimeSessionId });
}

export async function saveRuntimeLog(log: SessionExecutionLog) {
  await callStore<SessionExecutionLog>({ op: "saveLog", log });
  return log;
}

export async function listRuntimeLogs(runtimeSessionId: string) {
  return callStore<SessionExecutionLog[]>({ op: "listLogs", runtimeSessionId });
}

export async function saveRuntimeCheckpoint(checkpoint: RuntimeCheckpoint) {
  return callStore<RuntimeCheckpoint>({ op: "saveCheckpoint", checkpoint });
}

export async function getLatestRuntimeCheckpoint(runtimeSessionId: string) {
  return callStore<RuntimeCheckpoint | undefined>({ op: "getLatestCheckpoint", runtimeSessionId });
}

export async function listRuntimeCheckpoints(runtimeSessionId: string) {
  return callStore<RuntimeCheckpoint[]>({ op: "listCheckpoints", runtimeSessionId });
}

export async function saveRuntimeEscalation(event: ClinicianEscalationEvent) {
  return callStore<ClinicianEscalationEvent>({ op: "saveEscalation", event });
}

export async function updateRuntimeEscalation(escalationId: string, patch: Partial<ClinicianEscalationEvent>) {
  return callStore<ClinicianEscalationEvent>({ op: "updateEscalation", escalationId, patch });
}

export async function listRuntimeEscalations() {
  return callStore<ClinicianEscalationEvent[]>({ op: "listEscalations" });
}

export async function listRuntimeEscalationsBySession(runtimeSessionId: string) {
  return callStore<ClinicianEscalationEvent[]>({ op: "listEscalationsBySession", runtimeSessionId });
}

export async function saveRuntimeProviderEvent(event: RuntimeProviderEvent) {
  await callStore<void>({ op: "saveProviderEvent", event });
}

export async function listRuntimeProviderEvents(runtimeSessionId: string) {
  return callStore<RuntimeProviderEvent[]>({ op: "listProviderEvents", runtimeSessionId });
}

export async function saveRuntimeValidationEvent(event: RuntimeValidationEvent) {
  await callStore<void>({ op: "saveValidationEvent", event });
}

export async function listRuntimeValidationEvents(runtimeSessionId: string) {
  return callStore<RuntimeValidationEvent[]>({ op: "listValidationEvents", runtimeSessionId });
}

export async function saveRuntimeExecutionTrace(trace: RuntimeExecutionTrace) {
  return callStore<RuntimeExecutionTrace>({ op: "saveExecutionTrace", trace });
}

export async function listRuntimeExecutionTraces(runtimeSessionId: string) {
  return callStore<RuntimeExecutionTrace[]>({ op: "listExecutionTraces", runtimeSessionId });
}

export async function commitRuntimeAssistantTurn(input: CommitRuntimeAssistantTurnInput) {
  return callStore<CommitRuntimeAssistantTurnResult>({ op: "commitAssistantTurn", input });
}
