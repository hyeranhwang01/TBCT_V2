import type { PoolClient } from "pg";
import { getPgPool } from "@/shared/data/db/pg-pool";
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
import type {
  CommitRuntimeAssistantTurnInput,
  CommitRuntimeAssistantTurnResult,
  RuntimePatientTurnClaim,
  RuntimeSessionStartClaim,
  RuntimeStoreOp,
} from "@/shared/runtime/runtime-store-ops";

// Server-only: the real (Neon Postgres) implementation of the runtime
// conversation store. This is the app's operational source of truth for
// patient <-> assistant sessions -- reached only through
// src/app/api/runtime/session-store/route.ts, never imported by client
// components (DATABASE_URL is not exposed to the browser bundle).
//
// Every table is a "document row": a few indexed scalar columns plus a
// `data jsonb` column holding the full serialized record. Reads always
// return `data` as-is (never the scalar columns) so timestamps stay the
// ISO strings the app already works with, instead of pg's parsed Date
// objects for timestamptz columns.

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function createRuntimeSessionRecord(session: RuntimeSession) {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO runtime_sessions (id, participant_id, protocol_id, release_id, status, updated_at, created_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       participant_id = EXCLUDED.participant_id, protocol_id = EXCLUDED.protocol_id, release_id = EXCLUDED.release_id,
       status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data`,
    [session.id, session.participantId, session.protocolId, session.releaseId, session.status, session.updatedAt, session.createdAt, JSON.stringify(session)],
  );
  return session;
}

export async function updateRuntimeSessionRecord(sessionId: string, patch: Partial<RuntimeSession>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: RuntimeSession }>("SELECT data FROM runtime_sessions WHERE id = $1", [sessionId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Runtime session not found");
  const next: RuntimeSession = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query(
    `UPDATE runtime_sessions SET participant_id=$2, protocol_id=$3, release_id=$4, status=$5, updated_at=$6, data=$7 WHERE id=$1`,
    [sessionId, next.participantId, next.protocolId, next.releaseId, next.status, next.updatedAt, JSON.stringify(next)],
  );
  return next;
}

export async function claimRuntimePatientTurn(input: {
  sessionId: string;
  clientTurnId: string;
  expectedSessionVersion: number;
  patientMessage: RuntimeMessage;
  turnPatch?: Pick<RuntimeSession, "locale" | "currentPromptItemId" | "skippedPromptItemIds">;
}): Promise<RuntimePatientTurnClaim> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ data: RuntimeSession }>(
      "SELECT data FROM runtime_sessions WHERE id = $1 FOR UPDATE",
      [input.sessionId],
    );
    const current = rows[0]?.data;
    if (!current) throw new Error("Runtime session not found");
    if (input.patientMessage.runtimeSessionId !== input.sessionId) throw new Error("Patient message session does not match the turn claim");
    const currentVersion = current.version ?? 0;
    const canClaim = current.status === "waiting_for_input"
      && currentVersion === input.expectedSessionVersion
      && current.pendingTurnId === undefined
      && current.lastCompletedTurnId !== input.clientTurnId;
    if (!canClaim) return { claimed: false, session: current };

    const next: RuntimeSession = {
      ...current,
      ...input.turnPatch,
      status: "processing",
      pendingTurnId: input.clientTurnId,
      version: currentVersion + 1,
      messageIds: [...new Set([...current.messageIds, input.patientMessage.id])],
      runtimeContext: {
        ...current.runtimeContext,
        lastPatientMessage: input.patientMessage.content,
      },
      updatedAt: new Date().toISOString(),
    };
    await client.query(
      `INSERT INTO runtime_messages (id, runtime_session_id, role, created_at, delivered_at, data)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [input.patientMessage.id, input.patientMessage.runtimeSessionId, input.patientMessage.role, input.patientMessage.createdAt, input.patientMessage.deliveredAt ?? null, JSON.stringify(input.patientMessage)],
    );
    await client.query(
      `UPDATE runtime_sessions SET participant_id=$2, protocol_id=$3, release_id=$4, status=$5, updated_at=$6, data=$7 WHERE id=$1`,
      [next.id, next.participantId, next.protocolId, next.releaseId, next.status, next.updatedAt, JSON.stringify(next)],
    );
    return { claimed: true, session: next };
  });
}

/** Same "SELECT ... FOR UPDATE inside one transaction" guard as
 * claimRuntimePatientTurn, for startRuntimeSession's created -> preparing
 * transition. Without this, startRuntimeSession had no precondition check at
 * all (unlike pauseRuntimeSession/resumeRuntimeSession, which both verify
 * the session is in a legal source status first) -- two callers racing
 * (the patient-session-page.tsx auto-start effect and a still-visible,
 * not-yet-disabled manual Start button; or a stray auto-retry) would each
 * read status "created" before either had committed, then each
 * independently run the full entry-node execution chain, generating two
 * separate assistant messages for what should be one logical first turn
 * (confirmed live: reported as "the counselor's first message repeats
 * twice"). Only the FIRST caller whose transaction commits sees
 * claimed:true; every other caller gets claimed:false and skips re-running
 * the chain entirely (see startRuntimeSession in runtime-execution-api.ts). */
export async function claimRuntimeSessionStart(sessionId: string): Promise<RuntimeSessionStartClaim> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ data: RuntimeSession }>(
      "SELECT data FROM runtime_sessions WHERE id = $1 FOR UPDATE",
      [sessionId],
    );
    const current = rows[0]?.data;
    if (!current) throw new Error("Runtime session not found");
    if (current.status !== "created") return { claimed: false, session: current };

    const next: RuntimeSession = { ...current, status: "preparing", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await client.query(
      `UPDATE runtime_sessions SET participant_id=$2, protocol_id=$3, release_id=$4, status=$5, updated_at=$6, data=$7 WHERE id=$1`,
      [next.id, next.participantId, next.protocolId, next.releaseId, next.status, next.updatedAt, JSON.stringify(next)],
    );
    return { claimed: true, session: next };
  });
}

export async function getRuntimeSessionRecord(sessionId: string): Promise<RuntimeSession | undefined> {
  const { rows } = await getPgPool().query<{ data: RuntimeSession }>("SELECT data FROM runtime_sessions WHERE id = $1", [sessionId]);
  return rows[0]?.data;
}

export async function listRuntimeSessionRecords(): Promise<RuntimeSession[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeSession }>("SELECT data FROM runtime_sessions ORDER BY updated_at DESC");
  return rows.map((row) => row.data);
}

/** Scoped to one participant's own sessions -- unlike listRuntimeSessionRecords
 * (every session, for the clinician-facing Patient Monitoring roster), this
 * is what a logged-in patient's own session list uses, via the existing
 * indexed participant_id column, so one patient can never see another's
 * sessions. */
export async function listRuntimeSessionRecordsByParticipant(participantId: string): Promise<RuntimeSession[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeSession }>(
    "SELECT data FROM runtime_sessions WHERE participant_id = $1 ORDER BY updated_at DESC",
    [participantId],
  );
  return rows.map((row) => row.data);
}

/** Permanently removes a runtime session and every row that references it. Irreversible. */
export async function deleteRuntimeSessionRecord(sessionId: string) {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM runtime_messages WHERE runtime_session_id = $1", [sessionId]);
    await client.query("DELETE FROM runtime_session_logs WHERE runtime_session_id = $1", [sessionId]);
    await client.query("DELETE FROM runtime_checkpoints WHERE runtime_session_id = $1", [sessionId]);
    await client.query("DELETE FROM runtime_escalations WHERE runtime_session_id = $1", [sessionId]);
    await client.query("DELETE FROM runtime_provider_events WHERE runtime_session_id = $1", [sessionId]);
    await client.query("DELETE FROM runtime_validation_events WHERE runtime_session_id = $1", [sessionId]);
    await client.query("DELETE FROM runtime_execution_traces WHERE runtime_session_id = $1", [sessionId]);
    await client.query("DELETE FROM runtime_sessions WHERE id = $1", [sessionId]);
  });
}

export async function saveRuntimeMessage(message: RuntimeMessage) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO runtime_messages (id, runtime_session_id, role, created_at, delivered_at, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET delivered_at = EXCLUDED.delivered_at, data = EXCLUDED.data`,
      [message.id, message.runtimeSessionId, message.role, message.createdAt, message.deliveredAt ?? null, JSON.stringify(message)],
    );
    const { rows } = await client.query<{ data: RuntimeSession }>(
      "SELECT data FROM runtime_sessions WHERE id = $1 FOR UPDATE",
      [message.runtimeSessionId],
    );
    const session = rows[0]?.data;
    if (!session) return;
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
    await client.query(
      `UPDATE runtime_sessions SET participant_id=$2, protocol_id=$3, release_id=$4, status=$5, updated_at=$6, data=$7 WHERE id=$1`,
      [next.id, next.participantId, next.protocolId, next.releaseId, next.status, next.updatedAt, JSON.stringify(next)],
    );
  });
  return message;
}

export async function listRuntimeMessages(runtimeSessionId: string): Promise<RuntimeMessage[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeMessage }>(
    "SELECT data FROM runtime_messages WHERE runtime_session_id = $1 ORDER BY created_at ASC",
    [runtimeSessionId],
  );
  return rows.map((row) => row.data);
}

export async function saveRuntimeLog(log: SessionExecutionLog) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO runtime_session_logs (id, runtime_session_id, stage, status, "timestamp", data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [log.id, log.runtimeSessionId, log.stage, log.status, log.timestamp, JSON.stringify(log)],
    );
    const { rows } = await client.query<{ data: RuntimeSession }>(
      "SELECT data FROM runtime_sessions WHERE id = $1 FOR UPDATE",
      [log.runtimeSessionId],
    );
    const session = rows[0]?.data;
    if (!session) return;
    const next: RuntimeSession = { ...session, executionLogIds: [...new Set([...session.executionLogIds, log.id])], updatedAt: new Date().toISOString() };
    await client.query(
      `UPDATE runtime_sessions SET participant_id=$2, protocol_id=$3, release_id=$4, status=$5, updated_at=$6, data=$7 WHERE id=$1`,
      [next.id, next.participantId, next.protocolId, next.releaseId, next.status, next.updatedAt, JSON.stringify(next)],
    );
  });
  return log;
}

export async function listRuntimeLogs(runtimeSessionId: string): Promise<SessionExecutionLog[]> {
  const { rows } = await getPgPool().query<{ data: SessionExecutionLog }>(
    `SELECT data FROM runtime_session_logs WHERE runtime_session_id = $1 ORDER BY "timestamp" ASC`,
    [runtimeSessionId],
  );
  return rows.map((row) => row.data);
}

export async function saveRuntimeCheckpoint(checkpoint: RuntimeCheckpoint) {
  await getPgPool().query(
    `INSERT INTO runtime_checkpoints (id, runtime_session_id, sequence, created_at, data)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [checkpoint.id, checkpoint.runtimeSessionId, checkpoint.sequence, checkpoint.createdAt, JSON.stringify(checkpoint)],
  );
  return checkpoint;
}

export async function getLatestRuntimeCheckpoint(runtimeSessionId: string): Promise<RuntimeCheckpoint | undefined> {
  const { rows } = await getPgPool().query<{ data: RuntimeCheckpoint }>(
    "SELECT data FROM runtime_checkpoints WHERE runtime_session_id = $1 ORDER BY sequence DESC LIMIT 1",
    [runtimeSessionId],
  );
  return rows[0]?.data;
}

export async function listRuntimeCheckpoints(runtimeSessionId: string): Promise<RuntimeCheckpoint[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeCheckpoint }>(
    "SELECT data FROM runtime_checkpoints WHERE runtime_session_id = $1 ORDER BY sequence ASC",
    [runtimeSessionId],
  );
  return rows.map((row) => row.data);
}

export async function saveRuntimeEscalation(event: ClinicianEscalationEvent) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO runtime_escalations (id, runtime_session_id, protocol_id, status, created_at, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data`,
      [event.id, event.runtimeSessionId, event.protocolId, event.status, event.createdAt, JSON.stringify(event)],
    );
    const { rows } = await client.query<{ data: RuntimeSession }>(
      "SELECT data FROM runtime_sessions WHERE id = $1 FOR UPDATE",
      [event.runtimeSessionId],
    );
    const session = rows[0]?.data;
    if (!session) return;
    const next: RuntimeSession = { ...session, escalationIds: [...new Set([...session.escalationIds, event.id])], updatedAt: new Date().toISOString() };
    await client.query(
      `UPDATE runtime_sessions SET participant_id=$2, protocol_id=$3, release_id=$4, status=$5, updated_at=$6, data=$7 WHERE id=$1`,
      [next.id, next.participantId, next.protocolId, next.releaseId, next.status, next.updatedAt, JSON.stringify(next)],
    );
  });
  return event;
}

export async function updateRuntimeEscalation(escalationId: string, patch: Partial<ClinicianEscalationEvent>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: ClinicianEscalationEvent }>("SELECT data FROM runtime_escalations WHERE id = $1", [escalationId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Escalation event not found");
  const next = { ...current, ...patch };
  await pool.query(
    `UPDATE runtime_escalations SET status=$2, data=$3 WHERE id=$1`,
    [escalationId, next.status, JSON.stringify(next)],
  );
  return next;
}

export async function listRuntimeEscalations(): Promise<ClinicianEscalationEvent[]> {
  const { rows } = await getPgPool().query<{ data: ClinicianEscalationEvent }>("SELECT data FROM runtime_escalations ORDER BY created_at DESC");
  return rows.map((row) => row.data);
}

export async function listRuntimeEscalationsBySession(runtimeSessionId: string): Promise<ClinicianEscalationEvent[]> {
  const { rows } = await getPgPool().query<{ data: ClinicianEscalationEvent }>(
    "SELECT data FROM runtime_escalations WHERE runtime_session_id = $1 ORDER BY created_at ASC",
    [runtimeSessionId],
  );
  return rows.map((row) => row.data);
}

export async function saveRuntimeProviderEvent(event: RuntimeProviderEvent) {
  await getPgPool().query(
    `INSERT INTO runtime_provider_events (id, runtime_session_id, created_at, data)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [event.id, event.runtimeSessionId, event.createdAt, JSON.stringify(event)],
  );
}

export async function listRuntimeProviderEvents(runtimeSessionId: string): Promise<RuntimeProviderEvent[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeProviderEvent }>(
    "SELECT data FROM runtime_provider_events WHERE runtime_session_id = $1 ORDER BY created_at ASC",
    [runtimeSessionId],
  );
  return rows.map((row) => row.data);
}

export async function saveRuntimeValidationEvent(event: RuntimeValidationEvent) {
  await getPgPool().query(
    `INSERT INTO runtime_validation_events (id, runtime_session_id, created_at, data)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [event.id, event.runtimeSessionId, event.createdAt, JSON.stringify(event)],
  );
}

export async function listRuntimeValidationEvents(runtimeSessionId: string): Promise<RuntimeValidationEvent[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeValidationEvent }>(
    "SELECT data FROM runtime_validation_events WHERE runtime_session_id = $1 ORDER BY created_at ASC",
    [runtimeSessionId],
  );
  return rows.map((row) => row.data);
}

export async function saveRuntimeExecutionTrace(trace: RuntimeExecutionTrace) {
  await getPgPool().query(
    `INSERT INTO runtime_execution_traces (id, runtime_session_id, "timestamp", data)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [trace.id, trace.runtimeSessionId, trace.timestamp, JSON.stringify(trace)],
  );
  return trace;
}

export async function listRuntimeExecutionTraces(runtimeSessionId: string): Promise<RuntimeExecutionTrace[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeExecutionTrace }>(
    `SELECT data FROM runtime_execution_traces WHERE runtime_session_id = $1 ORDER BY "timestamp" ASC`,
    [runtimeSessionId],
  );
  return rows.map((row) => row.data);
}

export async function commitRuntimeAssistantTurn(input: CommitRuntimeAssistantTurnInput): Promise<CommitRuntimeAssistantTurnResult> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ data: RuntimeSession }>(
      "SELECT data FROM runtime_sessions WHERE id = $1 FOR UPDATE",
      [input.sessionId],
    );
    const current = rows[0]?.data;
    if (!current) throw new Error("Runtime session not found");
    const turnId = typeof input.assistantMessage.metadata?.turnId === "string" ? input.assistantMessage.metadata.turnId : undefined;
    // A repeat_until PromptItem (e.g. "rate the next item") is delivered
    // more than once for the same nodeId/promptItemId by design, so that
    // pair alone cannot identify a duplicate commit. clientTurnId uniquely
    // identifies the patient turn that triggered this specific delivery, so
    // prefer it; only fall back to nodeId/promptItemId for the odd
    // assistant-only delivery that has no turn attached at all.
    const clientTurnId = typeof input.assistantMessage.metadata?.clientTurnId === "string" ? input.assistantMessage.metadata.clientTurnId : undefined;
    const { rows: assistantRows } = await client.query<{ data: RuntimeMessage }>(
      "SELECT data FROM runtime_messages WHERE runtime_session_id = $1 AND role = 'assistant'",
      [input.sessionId],
    );
    const duplicate = assistantRows
      .map((row) => row.data)
      .find((message) => (clientTurnId
        ? message.metadata?.clientTurnId === clientTurnId
        : turnId
          ? message.metadata?.turnId === turnId
          : message.nodeId === input.assistantMessage.nodeId && message.promptItemId === input.assistantMessage.promptItemId));
    if (duplicate) return { session: current, assistantMessage: duplicate, duplicate: true };

    await client.query(
      `INSERT INTO runtime_messages (id, runtime_session_id, role, created_at, delivered_at, data)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [input.assistantMessage.id, input.assistantMessage.runtimeSessionId, input.assistantMessage.role, input.assistantMessage.createdAt, input.assistantMessage.deliveredAt ?? null, JSON.stringify(input.assistantMessage)],
    );
    await client.query(
      `INSERT INTO runtime_provider_events (id, runtime_session_id, created_at, data)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [input.providerEvent.id, input.providerEvent.runtimeSessionId, input.providerEvent.createdAt, JSON.stringify(input.providerEvent)],
    );
    await client.query(
      `INSERT INTO runtime_validation_events (id, runtime_session_id, created_at, data)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [input.validationEvent.id, input.validationEvent.runtimeSessionId, input.validationEvent.createdAt, JSON.stringify(input.validationEvent)],
    );
    await client.query(
      `INSERT INTO runtime_execution_traces (id, runtime_session_id, "timestamp", data)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [input.trace.id, input.trace.runtimeSessionId, input.trace.timestamp, JSON.stringify(input.trace)],
    );

    const nextSession: RuntimeSession = {
      ...current,
      ...input.sessionPatch,
      pendingTurnId: current.pendingTurnId && input.sessionPatch.status !== "processing" ? undefined : input.sessionPatch.pendingTurnId ?? current.pendingTurnId,
      lastCompletedTurnId: current.pendingTurnId && input.sessionPatch.status !== "processing" ? current.pendingTurnId : input.sessionPatch.lastCompletedTurnId ?? current.lastCompletedTurnId,
      messageIds: [...new Set([...current.messageIds, ...(input.sessionPatch.messageIds ?? []), input.assistantMessage.id])],
      runtimeContext: {
        ...current.runtimeContext,
        ...input.sessionPatch.runtimeContext,
        lastAssistantMessage: input.assistantMessage.content,
      },
      updatedAt: new Date().toISOString(),
    };
    await client.query(
      `UPDATE runtime_sessions SET participant_id=$2, protocol_id=$3, release_id=$4, status=$5, updated_at=$6, data=$7 WHERE id=$1`,
      [nextSession.id, nextSession.participantId, nextSession.protocolId, nextSession.releaseId, nextSession.status, nextSession.updatedAt, JSON.stringify(nextSession)],
    );
    return { session: nextSession, assistantMessage: input.assistantMessage, duplicate: false };
  });
}

export async function dispatchRuntimeStoreOp(op: RuntimeStoreOp): Promise<unknown> {
  switch (op.op) {
    case "createSession": return createRuntimeSessionRecord(op.session);
    case "updateSession": return updateRuntimeSessionRecord(op.sessionId, op.patch);
    case "claimPatientTurn": return claimRuntimePatientTurn(op);
    case "claimSessionStart": return claimRuntimeSessionStart(op.sessionId);
    case "getSession": return getRuntimeSessionRecord(op.sessionId);
    case "listSessions": return listRuntimeSessionRecords();
    case "listSessionsByParticipant": return listRuntimeSessionRecordsByParticipant(op.participantId);
    case "deleteSession": return deleteRuntimeSessionRecord(op.sessionId);
    case "saveMessage": return saveRuntimeMessage(op.message);
    case "listMessages": return listRuntimeMessages(op.runtimeSessionId);
    case "saveLog": return saveRuntimeLog(op.log);
    case "listLogs": return listRuntimeLogs(op.runtimeSessionId);
    case "saveCheckpoint": return saveRuntimeCheckpoint(op.checkpoint);
    case "getLatestCheckpoint": return getLatestRuntimeCheckpoint(op.runtimeSessionId);
    case "listCheckpoints": return listRuntimeCheckpoints(op.runtimeSessionId);
    case "saveEscalation": return saveRuntimeEscalation(op.event);
    case "updateEscalation": return updateRuntimeEscalation(op.escalationId, op.patch);
    case "listEscalations": return listRuntimeEscalations();
    case "listEscalationsBySession": return listRuntimeEscalationsBySession(op.runtimeSessionId);
    case "saveProviderEvent": return saveRuntimeProviderEvent(op.event);
    case "listProviderEvents": return listRuntimeProviderEvents(op.runtimeSessionId);
    case "saveValidationEvent": return saveRuntimeValidationEvent(op.event);
    case "listValidationEvents": return listRuntimeValidationEvents(op.runtimeSessionId);
    case "saveExecutionTrace": return saveRuntimeExecutionTrace(op.trace);
    case "listExecutionTraces": return listRuntimeExecutionTraces(op.runtimeSessionId);
    case "commitAssistantTurn": return commitRuntimeAssistantTurn(op.input);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown runtime store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
