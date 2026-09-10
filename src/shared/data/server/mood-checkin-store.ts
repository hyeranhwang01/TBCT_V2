import { getPgPool } from "@/shared/data/db/pg-pool";
import type { MoodCheckinStoreOp } from "@/shared/runtime/mood-checkin-store-ops";
import type { MoodCheckin } from "@/types/mood-checkin";

// Server-only: the real (Postgres) implementation of the mood check-in
// store -- reached only through src/app/api/mood-checkins/store/route.ts,
// never imported by client components. Same "document row" pattern as
// homework-store.ts: a handful of indexed scalar columns plus a `data
// jsonb` column holding the full serialized record.

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Today's date as "YYYY-MM-DD" in Asia/Seoul -- matches the timezone
 * every other timestamp display in this app already uses
 * (toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })), so a patient
 * checking in just after midnight KST gets today's entry, not
 * yesterday's UTC date. */
function todayInSeoul(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

async function upsert(participantId: string, mood: 1 | 2 | 3 | 4 | 5, note?: string): Promise<MoodCheckin> {
  const pool = getPgPool();
  const checkinDate = todayInSeoul();
  const now = new Date().toISOString();
  const existing = await pool.query<{ data: MoodCheckin }>(
    `SELECT data FROM mood_checkins WHERE participant_id = $1 AND checkin_date = $2`,
    [participantId, checkinDate],
  );
  const record: MoodCheckin = {
    id: existing.rows[0]?.data.id ?? makeId("MOOD"),
    participantId,
    checkinDate,
    mood,
    note,
    createdAt: existing.rows[0]?.data.createdAt ?? now,
    updatedAt: now,
  };
  await pool.query(
    `INSERT INTO mood_checkins (id, participant_id, checkin_date, mood, created_at, updated_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (participant_id, checkin_date) DO UPDATE SET mood = $4, updated_at = $6, data = $7`,
    [record.id, participantId, checkinDate, mood, record.createdAt, now, JSON.stringify(record)],
  );
  return record;
}

async function listByParticipant(participantId: string): Promise<MoodCheckin[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: MoodCheckin }>(
    `SELECT data FROM mood_checkins WHERE participant_id = $1 ORDER BY checkin_date DESC`,
    [participantId],
  );
  return rows.map((row) => row.data);
}

export async function dispatchMoodCheckinStoreOp(op: MoodCheckinStoreOp): Promise<unknown> {
  switch (op.op) {
    case "upsert": return upsert(op.participantId, op.mood, op.note);
    case "listByParticipant": return listByParticipant(op.participantId);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown mood check-in store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
