import { getPgPool } from "@/shared/data/db/pg-pool";
import type { HomeworkStoreOp } from "@/shared/runtime/homework-store-ops";
import type { HomeworkEntryRecord, HomeworkRecord, HomeworkStatus } from "@/types/homework";

// Server-only: the real (Neon Postgres) implementation of the homework
// store (sql/007_homework.sql) -- reached only through
// src/app/api/homework/store/route.ts, never imported by client components.
// Same "document row" writer/reader shape as runtime-session-store.ts.

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureRecord(input: { runtimeSessionId: string; sessionDefinitionId: string; participantId: string; initialStatus: HomeworkStatus; initialData?: Record<string, unknown> }): Promise<HomeworkRecord> {
  const pool = getPgPool();
  const existing = await pool.query<{ data: HomeworkRecord }>(`SELECT data FROM homework_records WHERE runtime_session_id = $1`, [input.runtimeSessionId]);
  if (existing.rows[0]) return existing.rows[0].data;
  const now = new Date().toISOString();
  const record: HomeworkRecord = {
    id: makeId("HWR"),
    runtimeSessionId: input.runtimeSessionId,
    sessionDefinitionId: input.sessionDefinitionId,
    participantId: input.participantId,
    status: input.initialStatus,
    updatedAt: now,
    createdAt: now,
    data: input.initialData ?? {},
  };
  await pool.query(
    `INSERT INTO homework_records (id, runtime_session_id, session_definition_id, participant_id, status, updated_at, created_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (runtime_session_id) DO NOTHING`,
    [record.id, record.runtimeSessionId, record.sessionDefinitionId, record.participantId, record.status, now, now, JSON.stringify(record)],
  );
  // Another concurrent request may have won the race -- re-read to return
  // the actual persisted row rather than assume ours landed.
  const persisted = await pool.query<{ data: HomeworkRecord }>(`SELECT data FROM homework_records WHERE runtime_session_id = $1`, [input.runtimeSessionId]);
  return persisted.rows[0]?.data ?? record;
}

async function getRecord(runtimeSessionId: string): Promise<HomeworkRecord | undefined> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: HomeworkRecord }>(`SELECT data FROM homework_records WHERE runtime_session_id = $1`, [runtimeSessionId]);
  return rows[0]?.data;
}

async function getRecordById(id: string): Promise<HomeworkRecord | undefined> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: HomeworkRecord }>(`SELECT data FROM homework_records WHERE id = $1`, [id]);
  return rows[0]?.data;
}

async function updateRecord(id: string, patch: Partial<Pick<HomeworkRecord, "status" | "data">>): Promise<HomeworkRecord> {
  const pool = getPgPool();
  const current = await getRecordById(id);
  if (!current) throw new Error(`Homework record not found: ${id}`);
  const now = new Date().toISOString();
  const next: HomeworkRecord = { ...current, status: patch.status ?? current.status, data: patch.data ?? current.data, updatedAt: now };
  await pool.query(`UPDATE homework_records SET status = $2, updated_at = $3, data = $4 WHERE id = $1`, [id, next.status, now, JSON.stringify(next)]);
  return next;
}

async function listRecordsByParticipant(participantId: string): Promise<HomeworkRecord[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: HomeworkRecord }>(`SELECT data FROM homework_records WHERE participant_id = $1 ORDER BY updated_at DESC`, [participantId]);
  return rows.map((row) => row.data);
}

/** Every homework record not yet "completed" and untouched since before
 * `staleSinceIso` -- used only by the daily homework-reminder cron job
 * (src/app/api/cron/homework-reminders/route.ts), a genuinely server-side
 * caller that (unlike every other reader of this store) doesn't go through
 * the fetch-based homework-repository.ts, so it needs a real cross-participant
 * query rather than listRecordsByParticipant's single-participant shape. */
export async function listStaleIncompleteRecords(staleSinceIso: string): Promise<HomeworkRecord[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: HomeworkRecord }>(
    `SELECT data FROM homework_records WHERE status != 'completed' AND updated_at < $1 ORDER BY updated_at ASC`,
    [staleSinceIso],
  );
  return rows.map((row) => row.data);
}

async function appendEntry(input: { homeworkRecordId: string; entryType: string; data: Record<string, unknown> }): Promise<HomeworkEntryRecord> {
  const pool = getPgPool();
  const now = new Date().toISOString();
  const record: HomeworkEntryRecord = { id: makeId("HWE"), homeworkRecordId: input.homeworkRecordId, entryType: input.entryType, createdAt: now, data: input.data };
  await pool.query(
    `INSERT INTO homework_entries (id, homework_record_id, entry_type, created_at, data) VALUES ($1, $2, $3, $4, $5)`,
    [record.id, record.homeworkRecordId, record.entryType, now, JSON.stringify(record)],
  );
  return record;
}

async function listEntries(homeworkRecordId: string, entryType?: string): Promise<HomeworkEntryRecord[]> {
  const pool = getPgPool();
  const { rows } = entryType
    ? await pool.query<{ data: HomeworkEntryRecord }>(`SELECT data FROM homework_entries WHERE homework_record_id = $1 AND entry_type = $2 ORDER BY created_at ASC`, [homeworkRecordId, entryType])
    : await pool.query<{ data: HomeworkEntryRecord }>(`SELECT data FROM homework_entries WHERE homework_record_id = $1 ORDER BY created_at ASC`, [homeworkRecordId]);
  return rows.map((row) => row.data);
}

async function updateEntry(id: string, patch: Partial<Pick<HomeworkEntryRecord, "data">>): Promise<HomeworkEntryRecord> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: HomeworkEntryRecord }>(`SELECT data FROM homework_entries WHERE id = $1`, [id]);
  const current = rows[0]?.data;
  if (!current) throw new Error(`Homework entry not found: ${id}`);
  const next: HomeworkEntryRecord = { ...current, data: patch.data ?? current.data };
  await pool.query(`UPDATE homework_entries SET data = $2 WHERE id = $1`, [id, JSON.stringify(next)]);
  return next;
}

export async function dispatchHomeworkStoreOp(op: HomeworkStoreOp): Promise<unknown> {
  switch (op.op) {
    case "ensureRecord": return ensureRecord(op);
    case "getRecord": return getRecord(op.runtimeSessionId);
    case "getRecordById": return getRecordById(op.id);
    case "updateRecord": return updateRecord(op.id, op.patch);
    case "listRecordsByParticipant": return listRecordsByParticipant(op.participantId);
    case "appendEntry": return appendEntry(op);
    case "listEntries": return listEntries(op.homeworkRecordId, op.entryType);
    case "updateEntry": return updateEntry(op.id, op.patch);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown homework store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
