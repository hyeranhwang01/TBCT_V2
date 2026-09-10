import { getPgPool } from "@/shared/data/db/pg-pool";
import type { LongitudinalMemory, RuntimeParticipant } from "@/types/longitudinal-memory";
import type { ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";

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

export async function saveParticipant(participant: RuntimeParticipant) {
  await getPgPool().query(
    `INSERT INTO runtime_participants (id, project_id, alias, status, created_at, updated_at, data, auth_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id, alias=EXCLUDED.alias, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data, auth_user_id=EXCLUDED.auth_user_id`,
    [participant.id, participant.projectId, participant.alias, participant.status, participant.createdAt, participant.updatedAt, JSON.stringify(participant), participant.authUserId ?? null],
  );
  return participant;
}

export async function updateParticipant(participantId: string, patch: Partial<RuntimeParticipant>): Promise<RuntimeParticipant> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: RuntimeParticipant }>("SELECT data FROM runtime_participants WHERE id = $1", [participantId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Participant not found");
  const next: RuntimeParticipant = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query(
    `UPDATE runtime_participants SET project_id=$2, alias=$3, status=$4, updated_at=$5, data=$6 WHERE id=$1`,
    [participantId, next.projectId, next.alias, next.status, next.updatedAt, JSON.stringify(next)],
  );
  return next;
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

export async function dispatchParticipantStoreOp(op: ParticipantStoreOp): Promise<unknown> {
  switch (op.op) {
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
    default:
      throw new Error(`Unknown participant store op: ${JSON.stringify(op)}`);
  }
}
