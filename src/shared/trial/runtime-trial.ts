// What the session runtime asks of the trial store (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend): the session gate, the sealed record at the end
// of a session, and the event log. Client-safe: on the server the store is
// reached in process, from the browser through /api/trial/store (which checks
// that the session is the caller's own).

import { callTrialStore } from "@/shared/data/repositories/trial-repository";
import type { RuntimeEvent, SessionGate } from "@/types/trial";

export class SessionUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`This session is not available for this participant now (${reason}).`);
    this.name = "SessionUnavailableError";
  }
}

function eventId() {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  return `EVT-${typeof webCrypto?.randomUUID === "function" ? webCrypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export type RuntimeEventInput = Omit<RuntimeEvent, "id" | "createdAt"> & { id?: string };

/** Adds events to runtime_events. Never throws and never delays the turn:
 * a lost event is logged to the console, the conversation carries on. Only
 * server code can write events (the route refuses the browser). */
export function recordRuntimeEvent(...events: RuntimeEventInput[]) {
  const now = new Date().toISOString();
  const rows = events.map((event) => ({ ...event, id: event.id ?? eventId(), createdAt: now }));
  return callTrialStore({ op: "recordEvents", events: rows }).catch((error: unknown) => {
    console.error("[runtime-trial] event not recorded", { codes: rows.map((row) => row.code), error: error instanceof Error ? error.message : String(error) });
  });
}

/** Whether the participant may run this session now (participants-store
 * getSessionGate). Fails closed: if the trial store cannot answer, the
 * session does not start. */
export async function checkSessionGate(input: { participantId: string; sessionDefinitionId: string; runtimeSessionId?: string; promptVersions?: Record<string, { version: string; sha256: string }>; recordEvent?: boolean }): Promise<SessionGate> {
  return callTrialStore<SessionGate>({
    op: "getSessionGate",
    runtimeParticipantId: input.participantId,
    sessionDefinitionId: input.sessionDefinitionId,
    currentPromptVersions: input.promptVersions,
    runtimeSessionId: input.runtimeSessionId,
    recordEvent: input.recordEvent,
  });
}

export async function requireSessionGate(input: Parameters<typeof checkSessionGate>[0]) {
  const gate = await checkSessionGate(input);
  if (!gate.allowed) throw new SessionUnavailableError(gate.reason);
  return gate;
}

/** Seals the ended session (records-store finalizeSessionRecord). Never
 * throws: the participant's session has already ended; a failure is logged
 * and the record can be written later (scripts/backfill-session-records.ts). */
export async function sealSessionRecord(runtimeSessionId: string, participantId?: string) {
  try {
    return await callTrialStore<{ recordId: string; inserted: boolean; isOfficial: boolean }>({ op: "finalizeSessionRecord", runtimeSessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[runtime-trial] session record not sealed", { runtimeSessionId, error: message });
    void recordRuntimeEvent({ participantId: participantId ?? null, runtimeSessionId, category: "storage", severity: "error", code: "RECORD_FINALIZE_FAILED", detail: { error: message.slice(0, 500) } });
    return null;
  }
}
