import { getPgPool } from "@/shared/data/db/pg-pool";
import type {
  GoalTrackingRecord,
  HomeworkTrackingRecord,
  LongitudinalMemory,
  MemoryCandidate,
  MemoryConsentEvent,
  MemoryRetrievalResult,
  MemoryReviewDecision,
  MemoryUsageLog,
  RuntimeParticipant,
  RuntimeSessionSummary,
} from "@/types/longitudinal-memory";
import type { ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import type { MemoryChunk, MemoryChunkRetrieval } from "@/types/memory-chunks";

// Server-only: the real (Neon Postgres) implementation of the participant
// roster + longitudinal memory (clinician notes) store -- reached only
// through src/app/api/participants/store/route.ts, never imported by client
// components (DATABASE_URL is not exposed to the browser bundle). This is
// now the operational source of truth for RuntimeParticipant records and
// clinician_note memories, shared by both the patient-facing runtime
// (which creates participants) and the clinician Patient Monitoring screens
// (which read the roster and add notes) -- replacing the local IndexedDB
// (Dexie) tables of the same purpose.

export async function listParticipants(): Promise<RuntimeParticipant[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeParticipant }>(
    "SELECT data FROM runtime_participants ORDER BY updated_at DESC",
  );
  return rows.map((row) => row.data);
}

export async function getParticipant(participantId: string): Promise<RuntimeParticipant | undefined> {
  const { rows } = await getPgPool().query<{ data: RuntimeParticipant }>(
    "SELECT data FROM runtime_participants WHERE id = $1",
    [participantId],
  );
  return rows[0]?.data;
}

/** Looks up the one participant record owned by a given Supabase Auth user
 * (see sql/008_link_participants_to_auth.sql) -- this is how a logged-in
 * patient's own participant is found, instead of the single hardcoded demo
 * participant every patient used to share. */
export async function getParticipantByAuthUserId(authUserId: string): Promise<RuntimeParticipant | undefined> {
  const { rows } = await getPgPool().query<{ data: RuntimeParticipant }>(
    "SELECT data FROM runtime_participants WHERE auth_user_id = $1",
    [authUserId],
  );
  return rows[0]?.data;
}

/** Creates or replaces a participant. On an existing row memoryConsent is
 * kept as stored: it changes only through recordMemoryConsent, which logs it. */
export async function saveParticipant(participant: RuntimeParticipant) {
  await getPgPool().query(
    `INSERT INTO runtime_participants (id, project_id, alias, status, created_at, updated_at, data, auth_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id, alias=EXCLUDED.alias, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at,
       data=(EXCLUDED.data - 'memoryConsent') || jsonb_strip_nulls(jsonb_build_object('memoryConsent', runtime_participants.data->'memoryConsent')),
       auth_user_id=EXCLUDED.auth_user_id`,
    [participant.id, participant.projectId, participant.alias, participant.status, participant.createdAt, participant.updatedAt, JSON.stringify(participant), participant.authUserId ?? null],
  );
  return participant;
}

export async function updateParticipant(participantId: string, patch: Partial<RuntimeParticipant>): Promise<RuntimeParticipant> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: RuntimeParticipant }>("SELECT data FROM runtime_participants WHERE id = $1", [participantId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Participant not found");
  const { memoryConsent: _ignored, ...rest } = patch;
  const next: RuntimeParticipant = { ...current, ...rest, updatedAt: new Date().toISOString() };
  // memoryConsent is taken from the row as it is at write time, never from
  // this read: a consent change (recordMemoryConsent) between the read above
  // and this write would otherwise be overwritten with the stale copy.
  const { rows: written } = await pool.query<{ data: RuntimeParticipant }>(
    `UPDATE runtime_participants SET project_id=$2, alias=$3, status=$4, updated_at=$5,
       data=($6::jsonb - 'memoryConsent') || jsonb_strip_nulls(jsonb_build_object('memoryConsent', data->'memoryConsent'))
     WHERE id=$1 RETURNING data`,
    [participantId, next.projectId, next.alias, next.status, next.updatedAt, JSON.stringify(next)],
  );
  return written[0]?.data ?? next;
}

export async function listMemories(participantId: string): Promise<LongitudinalMemory[]> {
  const { rows } = await getPgPool().query<{ data: LongitudinalMemory }>(
    "SELECT data FROM longitudinal_memories WHERE participant_id = $1 ORDER BY updated_at DESC",
    [participantId],
  );
  return rows.map((row) => row.data);
}

export async function getMemory(memoryId: string): Promise<LongitudinalMemory | undefined> {
  const { rows } = await getPgPool().query<{ data: LongitudinalMemory }>(
    "SELECT data FROM longitudinal_memories WHERE id = $1",
    [memoryId],
  );
  return rows[0]?.data;
}

export async function saveMemory(memory: LongitudinalMemory) {
  await getPgPool().query(
    `INSERT INTO longitudinal_memories (id, participant_id, memory_type, status, created_at, updated_at, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET participant_id=EXCLUDED.participant_id, memory_type=EXCLUDED.memory_type, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [memory.id, memory.participantId, memory.memoryType, memory.status, memory.createdAt, memory.updatedAt, JSON.stringify(memory)],
  );
  return memory;
}

export async function updateMemory(memoryId: string, patch: Partial<LongitudinalMemory>): Promise<LongitudinalMemory> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: LongitudinalMemory }>("SELECT data FROM longitudinal_memories WHERE id = $1", [memoryId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Memory not found");
  const next: LongitudinalMemory = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query(
    `UPDATE longitudinal_memories SET participant_id=$2, memory_type=$3, status=$4, updated_at=$5, data=$6 WHERE id=$1`,
    [memoryId, next.participantId, next.memoryType, next.status, next.updatedAt, JSON.stringify(next)],
  );
  return next;
}

// ---- Memory consent (sql/025_participant_consent_events.sql) ----

const CONSENT_DECISIONS = new Set(["granted", "declined"]);
const CONSENT_SOURCES = new Set(["first_visit_dialog", "profile", "clinician"]);

/** Appends the consent event and sets participant.memoryConsent in one
 * transaction, so the record the runtime reads never disagrees with the
 * trial log. consent.crossSessionUseAllowed is kept in step for the code
 * that still reads it. */
export async function recordMemoryConsent(op: Extract<ParticipantStoreOp, { op: "recordMemoryConsent" }>): Promise<RuntimeParticipant> {
  if (!CONSENT_DECISIONS.has(op.decision)) throw new Error(`Unknown consent decision: ${op.decision}`);
  if (!CONSENT_SOURCES.has(op.source)) throw new Error(`Unknown consent source: ${op.source}`);
  if (!op.textVersion?.trim()) throw new Error("Consent text version is required");
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ data: RuntimeParticipant }>("SELECT data FROM runtime_participants WHERE id = $1 FOR UPDATE", [op.participantId]);
    const current = rows[0]?.data;
    if (!current) throw new Error("Participant not found");
    const now = new Date().toISOString();
    const event: MemoryConsentEvent = {
      id: `CONS-${globalThis.crypto.randomUUID()}`,
      participantId: op.participantId,
      consentKind: "memory",
      decision: op.decision,
      textVersion: op.textVersion,
      source: op.source,
      locale: op.locale,
      decidedAt: now,
      actorUserId: op.actor?.actorUserId,
      actorRole: op.actor?.actorRole ?? "server",
      previousDecision: current.memoryConsent?.decision,
    };
    await client.query(
      `INSERT INTO participant_consent_events (id, participant_id, consent_kind, decision, text_version, source, decided_at, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [event.id, event.participantId, event.consentKind, event.decision, event.textVersion, event.source, event.decidedAt, JSON.stringify(event)],
    );
    const next: RuntimeParticipant = {
      ...current,
      memoryConsent: { decision: op.decision, textVersion: op.textVersion, source: op.source, decidedAt: now },
      consent: { ...current.consent, crossSessionUseAllowed: op.decision === "granted", updatedAt: now },
      updatedAt: now,
    };
    await client.query("UPDATE runtime_participants SET updated_at=$2, data=$3 WHERE id=$1", [op.participantId, next.updatedAt, JSON.stringify(next)]);
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listMemoryConsentEvents(participantId: string): Promise<MemoryConsentEvent[]> {
  const { rows } = await getPgPool().query<{ data: MemoryConsentEvent }>(
    "SELECT data FROM participant_consent_events WHERE participant_id = $1 ORDER BY decided_at ASC, id ASC",
    [participantId],
  );
  return rows.map((row) => row.data);
}

// ---- Memory chunks (sql/027_participant_memory_chunks.sql) ----
// One column per field (no data jsonb): the append-only guard in 027 checks
// the columns.

type MemoryChunkRow = {
  id: string; participant_id: string; runtime_session_id: string; session_definition_id: string; session_index: number;
  chunk_kind: MemoryChunk["chunkKind"]; element_kind: MemoryChunk["elementKind"]; field_names: string[]; source_message_ids: string[]; source_ref: string | null;
  content: string; distortion_ids: string[]; source_created_at: Date | string; index_version: string;
  tags: MemoryChunk["tags"]; tagged_at: Date | string | null; tag_model: string | null; tag_prompt_version: string | null;
  suppressed: boolean; suppressed_at: Date | string | null; suppressed_by: string | null; suppressed_reason: string | null; created_at: Date | string;
};

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

function chunkFromRow(row: MemoryChunkRow): MemoryChunk {
  return {
    id: row.id,
    participantId: row.participant_id,
    runtimeSessionId: row.runtime_session_id,
    sessionDefinitionId: row.session_definition_id,
    sessionIndex: row.session_index,
    chunkKind: row.chunk_kind,
    elementKind: row.element_kind,
    fieldNames: row.field_names,
    sourceMessageIds: row.source_message_ids,
    sourceRef: row.source_ref ?? undefined,
    content: row.content,
    distortionIds: row.distortion_ids,
    sourceCreatedAt: iso(row.source_created_at),
    indexVersion: row.index_version,
    tags: row.tags ?? null,
    taggedAt: row.tagged_at ? iso(row.tagged_at) : undefined,
    tagModel: row.tag_model ?? undefined,
    tagPromptVersion: row.tag_prompt_version ?? undefined,
    suppressed: row.suppressed,
    suppressedAt: row.suppressed_at ? iso(row.suppressed_at) : undefined,
    suppressedBy: row.suppressed_by ?? undefined,
    suppressedReason: row.suppressed_reason ?? undefined,
    createdAt: iso(row.created_at),
  };
}

/** Inserts the chunks that are not there yet (ids are stable, so a rebuild
 * adds nothing twice). Returns how many were new. One statement per 200
 * chunks -- a session makes a few dozen. */
export async function saveMemoryChunks(chunks: MemoryChunk[]): Promise<number> {
  const COLUMNS = 16;
  let inserted = 0;
  for (let start = 0; start < chunks.length; start += 200) {
    const batch = chunks.slice(start, start + 200);
    const values: unknown[] = [];
    const tuples = batch.map((chunk, row) => {
      values.push(chunk.id, chunk.participantId, chunk.runtimeSessionId, chunk.sessionDefinitionId, chunk.sessionIndex, chunk.chunkKind, chunk.elementKind, chunk.fieldNames, chunk.sourceMessageIds, chunk.sourceRef ?? null, chunk.content, chunk.distortionIds, chunk.sourceCreatedAt, chunk.indexVersion, chunk.tags ? JSON.stringify(chunk.tags) : null, chunk.createdAt);
      const offset = row * COLUMNS;
      return `(${Array.from({ length: COLUMNS }, (_, column) => `$${offset + column + 1}`).join(",")},false)`;
    });
    const result = await getPgPool().query(
      `INSERT INTO participant_memory_chunks (id, participant_id, runtime_session_id, session_definition_id, session_index, chunk_kind, element_kind, field_names, source_message_ids, source_ref, content, distortion_ids, source_created_at, index_version, tags, created_at, suppressed)
       VALUES ${tuples.join(",")}
       ON CONFLICT (id) DO NOTHING`,
      values,
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function listMemoryChunks(op: Extract<ParticipantStoreOp, { op: "listMemoryChunks" }>): Promise<MemoryChunk[]> {
  // officialAttemptsOnly (note2026_09_28_rct_backend): a session's worksheet
  // and conversation chunks come from its official attempt (sql/033) once
  // there is one; a repeat of a module that already has one is left out.
  // Homework and clinician notes are not attempts and always count.
  const { rows } = await getPgPool().query<MemoryChunkRow>(
    `SELECT c.* FROM participant_memory_chunks c
     WHERE c.participant_id = $1 AND ($2::int IS NULL OR c.session_index < $2) AND ($3::boolean OR NOT c.suppressed)
       AND (NOT $4::boolean OR c.chunk_kind IN ('homework', 'clinician_note') OR NOT EXISTS (
         SELECT 1 FROM runtime_sessions s
         WHERE s.id = c.runtime_session_id AND NOT s.is_official AND EXISTS (
           SELECT 1 FROM runtime_sessions o WHERE o.participant_id = s.participant_id AND o.module_number = s.module_number AND o.is_official)))
     ORDER BY c.session_index ASC, c.source_created_at ASC, c.id ASC`,
    [op.participantId, op.beforeSessionIndex ?? null, op.includeSuppressed ?? false, op.officialAttemptsOnly ?? false],
  );
  return rows.map(chunkFromRow);
}

export async function listMemoryChunksBySession(runtimeSessionId: string): Promise<MemoryChunk[]> {
  const { rows } = await getPgPool().query<MemoryChunkRow>(
    "SELECT * FROM participant_memory_chunks WHERE runtime_session_id = $1 ORDER BY source_created_at ASC, id ASC",
    [runtimeSessionId],
  );
  return rows.map(chunkFromRow);
}

export async function suppressMemoryChunk(op: Extract<ParticipantStoreOp, { op: "suppressMemoryChunk" }>): Promise<MemoryChunk> {
  if (!op.reason?.trim()) throw new Error("A reason is required to suppress a memory chunk");
  const { rows } = await getPgPool().query<MemoryChunkRow>(
    `UPDATE participant_memory_chunks SET suppressed = true, suppressed_at = now(), suppressed_by = $2, suppressed_reason = $3
     WHERE id = $1 RETURNING *`,
    [op.chunkId, op.actorUserId ?? null, op.reason.trim()],
  );
  if (!rows[0]) throw new Error("Memory chunk not found");
  return chunkFromRow(rows[0]);
}

export async function listUntaggedMemoryChunks(participantId: string): Promise<MemoryChunk[]> {
  const { rows } = await getPgPool().query<MemoryChunkRow>(
    "SELECT * FROM participant_memory_chunks WHERE participant_id = $1 AND tagged_at IS NULL AND NOT suppressed ORDER BY session_index ASC, source_created_at ASC, id ASC",
    [participantId],
  );
  return rows.map(chunkFromRow);
}

/** Tags are set once (sql/027's guard); a chunk already tagged is left as it
 * is and reported as not updated. */
export async function setMemoryChunkTags(op: Extract<ParticipantStoreOp, { op: "setMemoryChunkTags" }>): Promise<boolean> {
  const result = await getPgPool().query(
    "UPDATE participant_memory_chunks SET tags = $2, tagged_at = now(), tag_model = $3, tag_prompt_version = $4 WHERE id = $1 AND tagged_at IS NULL",
    [op.chunkId, JSON.stringify(op.tags), op.tagModel, op.tagPromptVersion],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function saveMemoryChunkRetrieval(retrieval: MemoryChunkRetrieval): Promise<MemoryChunkRetrieval> {
  await getPgPool().query(
    `INSERT INTO memory_chunk_retrievals (id, participant_id, runtime_session_id, message_id, consent_state, algorithm_version, created_at, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [retrieval.id, retrieval.participantId, retrieval.runtimeSessionId, retrieval.messageId ?? null, retrieval.consentState, retrieval.algorithmVersion, retrieval.createdAt, JSON.stringify(retrieval)],
  );
  return retrieval;
}

export async function listMemoryChunkRetrievals(runtimeSessionId: string): Promise<MemoryChunkRetrieval[]> {
  const { rows } = await getPgPool().query<{ data: MemoryChunkRetrieval }>(
    "SELECT data FROM memory_chunk_retrievals WHERE runtime_session_id = $1 ORDER BY created_at ASC, id ASC",
    [runtimeSessionId],
  );
  return rows.map((row) => row.data);
}

// ---- Longitudinal-memory pipeline (sql/023_memory_pipeline.sql) ----
// Same document-row convention as above: the indexed scalar columns are
// denormalized copies of fields inside `data`, and `data` is the record.
// Ordering mirrors the Dexie tables these replace (see
// .claude/TASK_SCOPE.json note2026_09_13_ari_memory_pipeline_plumbing)
// so the clinician/patient screens see the same order as before.

async function rowsData<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await getPgPool().query<{ data: T }>(sql, params);
  return rows.map((row) => row.data);
}

export async function listExpiredApprovedMemories(): Promise<LongitudinalMemory[]> {
  return rowsData<LongitudinalMemory>(
    `SELECT data FROM longitudinal_memories
     WHERE status = 'approved' AND (data->>'validUntil') IS NOT NULL AND (data->>'validUntil')::timestamptz < now()`,
  );
}

export async function getSessionSummaryBySession(runtimeSessionId: string): Promise<RuntimeSessionSummary | undefined> {
  const rows = await rowsData<RuntimeSessionSummary>(
    "SELECT data FROM runtime_session_summaries WHERE runtime_session_id = $1 ORDER BY created_at ASC LIMIT 1",
    [runtimeSessionId],
  );
  return rows[0];
}

export async function getSessionSummary(summaryId: string): Promise<RuntimeSessionSummary | undefined> {
  return (await rowsData<RuntimeSessionSummary>("SELECT data FROM runtime_session_summaries WHERE id = $1", [summaryId]))[0];
}

export async function saveSessionSummary(summary: RuntimeSessionSummary) {
  await getPgPool().query(
    `INSERT INTO runtime_session_summaries (id, runtime_session_id, participant_id, summary_status, created_at, updated_at, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET runtime_session_id=EXCLUDED.runtime_session_id, participant_id=EXCLUDED.participant_id, summary_status=EXCLUDED.summary_status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [summary.id, summary.runtimeSessionId, summary.participantId, summary.summaryStatus, summary.createdAt, summary.updatedAt, JSON.stringify(summary)],
  );
  return summary;
}

export async function updateSessionSummary(summaryId: string, patch: Partial<RuntimeSessionSummary>): Promise<RuntimeSessionSummary> {
  const current = await getSessionSummary(summaryId);
  if (!current) throw new Error("Session summary not found");
  const next: RuntimeSessionSummary = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await saveSessionSummary(next);
  return next;
}

export async function listMemoryCandidates(participantId?: string): Promise<MemoryCandidate[]> {
  return participantId
    ? rowsData<MemoryCandidate>("SELECT data FROM memory_candidates WHERE participant_id = $1 ORDER BY updated_at ASC", [participantId])
    : rowsData<MemoryCandidate>("SELECT data FROM memory_candidates ORDER BY updated_at DESC");
}

export async function getMemoryCandidate(candidateId: string): Promise<MemoryCandidate | undefined> {
  return (await rowsData<MemoryCandidate>("SELECT data FROM memory_candidates WHERE id = $1", [candidateId]))[0];
}

export async function saveMemoryCandidate(candidate: MemoryCandidate) {
  await getPgPool().query(
    `INSERT INTO memory_candidates (id, participant_id, memory_type, status, source_session_id, created_at, updated_at, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET participant_id=EXCLUDED.participant_id, memory_type=EXCLUDED.memory_type, status=EXCLUDED.status, source_session_id=EXCLUDED.source_session_id, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [candidate.id, candidate.participantId, candidate.memoryType, candidate.status, candidate.sourceSessionId, candidate.createdAt, candidate.updatedAt, JSON.stringify(candidate)],
  );
  return candidate;
}

export async function updateMemoryCandidate(candidateId: string, patch: Partial<MemoryCandidate>): Promise<MemoryCandidate> {
  const current = await getMemoryCandidate(candidateId);
  if (!current) throw new Error("Memory candidate not found");
  const next: MemoryCandidate = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await saveMemoryCandidate(next);
  return next;
}

export async function deleteMemoryCandidate(candidateId: string) {
  await getPgPool().query("DELETE FROM memory_candidates WHERE id = $1", [candidateId]);
}

export async function saveMemoryReviewDecision(decision: MemoryReviewDecision) {
  await getPgPool().query(
    `INSERT INTO memory_review_decisions (id, memory_id, participant_id, action, created_at, data)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET memory_id=EXCLUDED.memory_id, participant_id=EXCLUDED.participant_id, action=EXCLUDED.action, data=EXCLUDED.data`,
    [decision.id, decision.memoryId, decision.participantId, decision.action, decision.createdAt, JSON.stringify(decision)],
  );
  return decision;
}

export async function listMemoryReviewDecisions(memoryId: string): Promise<MemoryReviewDecision[]> {
  return rowsData<MemoryReviewDecision>("SELECT data FROM memory_review_decisions WHERE memory_id = $1 ORDER BY created_at ASC", [memoryId]);
}

export async function saveMemoryRetrievalRun(run: MemoryRetrievalResult) {
  await getPgPool().query(
    `INSERT INTO memory_retrieval_runs (id, participant_id, runtime_session_id, created_at, data)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`,
    [run.id, run.participantId, run.runtimeSessionId, run.createdAt, JSON.stringify(run)],
  );
  return run;
}

export async function listMemoryRetrievalRuns(runtimeSessionId: string): Promise<MemoryRetrievalResult[]> {
  return rowsData<MemoryRetrievalResult>("SELECT data FROM memory_retrieval_runs WHERE runtime_session_id = $1 ORDER BY created_at ASC", [runtimeSessionId]);
}

export async function saveMemoryUsageLog(log: MemoryUsageLog) {
  await getPgPool().query(
    `INSERT INTO memory_usage_logs (id, memory_id, participant_id, runtime_session_id, created_at, data)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`,
    [log.id, log.memoryId, log.participantId, log.runtimeSessionId, log.createdAt, JSON.stringify(log)],
  );
  return log;
}

export async function listMemoryUsageLogs(runtimeSessionId: string): Promise<MemoryUsageLog[]> {
  return rowsData<MemoryUsageLog>("SELECT data FROM memory_usage_logs WHERE runtime_session_id = $1 ORDER BY created_at ASC", [runtimeSessionId]);
}

export async function listAllMemoryUsageLogs(participantId: string): Promise<MemoryUsageLog[]> {
  return rowsData<MemoryUsageLog>("SELECT data FROM memory_usage_logs WHERE participant_id = $1 ORDER BY created_at ASC", [participantId]);
}

export async function listGoalTrackingRecords(participantId: string): Promise<GoalTrackingRecord[]> {
  return rowsData<GoalTrackingRecord>("SELECT data FROM goal_tracking_records WHERE participant_id = $1 ORDER BY updated_at ASC", [participantId]);
}

export async function saveGoalTrackingRecord(record: GoalTrackingRecord) {
  await getPgPool().query(
    `INSERT INTO goal_tracking_records (id, participant_id, status, created_at, updated_at, data)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET participant_id=EXCLUDED.participant_id, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [record.id, record.participantId, record.status, record.createdAt, record.updatedAt, JSON.stringify(record)],
  );
  return record;
}

export async function updateGoalTrackingRecord(recordId: string, patch: Partial<GoalTrackingRecord>): Promise<GoalTrackingRecord> {
  const current = (await rowsData<GoalTrackingRecord>("SELECT data FROM goal_tracking_records WHERE id = $1", [recordId]))[0];
  if (!current) throw new Error("Goal tracking record not found");
  const next: GoalTrackingRecord = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await saveGoalTrackingRecord(next);
  return next;
}

export async function listHomeworkTrackingRecords(participantId: string): Promise<HomeworkTrackingRecord[]> {
  return rowsData<HomeworkTrackingRecord>("SELECT data FROM homework_tracking_records WHERE participant_id = $1 ORDER BY assigned_at ASC", [participantId]);
}

export async function saveHomeworkTrackingRecord(record: HomeworkTrackingRecord) {
  await getPgPool().query(
    `INSERT INTO homework_tracking_records (id, participant_id, status, assigned_at, data)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET participant_id=EXCLUDED.participant_id, status=EXCLUDED.status, assigned_at=EXCLUDED.assigned_at, data=EXCLUDED.data`,
    [record.id, record.participantId, record.status, record.assignedAt, JSON.stringify(record)],
  );
  return record;
}

export async function updateHomeworkTrackingRecord(recordId: string, patch: Partial<HomeworkTrackingRecord>): Promise<HomeworkTrackingRecord> {
  const current = (await rowsData<HomeworkTrackingRecord>("SELECT data FROM homework_tracking_records WHERE id = $1", [recordId]))[0];
  if (!current) throw new Error("Homework tracking record not found");
  const next: HomeworkTrackingRecord = { ...current, ...patch };
  await saveHomeworkTrackingRecord(next);
  return next;
}

export async function dispatchParticipantStoreOp(op: ParticipantStoreOp): Promise<unknown> {
  switch (op.op) {
    case "listExpiredApprovedMemories":
      return listExpiredApprovedMemories();
    case "getSessionSummaryBySession":
      return getSessionSummaryBySession(op.runtimeSessionId);
    case "getSessionSummary":
      return getSessionSummary(op.summaryId);
    case "saveSessionSummary":
      return saveSessionSummary(op.summary);
    case "updateSessionSummary":
      return updateSessionSummary(op.summaryId, op.patch);
    case "listMemoryCandidates":
      return listMemoryCandidates(op.participantId);
    case "getMemoryCandidate":
      return getMemoryCandidate(op.candidateId);
    case "saveMemoryCandidate":
      return saveMemoryCandidate(op.candidate);
    case "updateMemoryCandidate":
      return updateMemoryCandidate(op.candidateId, op.patch);
    case "deleteMemoryCandidate":
      return deleteMemoryCandidate(op.candidateId);
    case "saveMemoryReviewDecision":
      return saveMemoryReviewDecision(op.decision);
    case "listMemoryReviewDecisions":
      return listMemoryReviewDecisions(op.memoryId);
    case "saveMemoryRetrievalRun":
      return saveMemoryRetrievalRun(op.run);
    case "listMemoryRetrievalRuns":
      return listMemoryRetrievalRuns(op.runtimeSessionId);
    case "saveMemoryUsageLog":
      return saveMemoryUsageLog(op.log);
    case "listMemoryUsageLogs":
      return listMemoryUsageLogs(op.runtimeSessionId);
    case "listAllMemoryUsageLogs":
      return listAllMemoryUsageLogs(op.participantId);
    case "listGoalTrackingRecords":
      return listGoalTrackingRecords(op.participantId);
    case "saveGoalTrackingRecord":
      return saveGoalTrackingRecord(op.record);
    case "updateGoalTrackingRecord":
      return updateGoalTrackingRecord(op.recordId, op.patch);
    case "listHomeworkTrackingRecords":
      return listHomeworkTrackingRecords(op.participantId);
    case "saveHomeworkTrackingRecord":
      return saveHomeworkTrackingRecord(op.record);
    case "updateHomeworkTrackingRecord":
      return updateHomeworkTrackingRecord(op.recordId, op.patch);
    case "listParticipants":
      return listParticipants();
    case "getParticipant":
      return getParticipant(op.participantId);
    case "getParticipantByAuthUserId":
      return getParticipantByAuthUserId(op.authUserId);
    case "saveParticipant":
      return saveParticipant(op.participant);
    case "updateParticipant":
      return updateParticipant(op.participantId, op.patch);
    case "listMemories":
      return listMemories(op.participantId);
    case "getMemory":
      return getMemory(op.memoryId);
    case "saveMemory":
      return saveMemory(op.memory);
    case "updateMemory":
      return updateMemory(op.memoryId, op.patch);
    case "recordMemoryConsent":
      return recordMemoryConsent(op);
    case "listMemoryConsentEvents":
      return listMemoryConsentEvents(op.participantId);
    case "saveMemoryChunks":
      return saveMemoryChunks(op.chunks);
    case "listMemoryChunks":
      return listMemoryChunks(op);
    case "listMemoryChunksBySession":
      return listMemoryChunksBySession(op.runtimeSessionId);
    case "suppressMemoryChunk":
      return suppressMemoryChunk(op);
    case "listUntaggedMemoryChunks":
      return listUntaggedMemoryChunks(op.participantId);
    case "setMemoryChunkTags":
      return setMemoryChunkTags(op);
    case "saveMemoryChunkRetrieval":
      return saveMemoryChunkRetrieval(op.retrieval);
    case "listMemoryChunkRetrievals":
      return listMemoryChunkRetrievals(op.runtimeSessionId);
    default:
      throw new Error(`Unknown participant store op: ${JSON.stringify(op)}`);
  }
}
