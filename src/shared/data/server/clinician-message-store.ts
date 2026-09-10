import { getPgPool } from "@/shared/data/db/pg-pool";
import type { ClinicianMessageStoreOp } from "@/shared/runtime/clinician-message-store-ops";
import type { ClinicianMessage } from "@/types/clinician-message";

// Server-only: the real (Postgres) implementation of the clinician-
// messages store -- reached only through
// src/app/api/clinician-messages/store/route.ts, never imported by
// client components. Same "document row" pattern as homework-store.ts.

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function send(participantId: string, senderRole: "patient" | "clinician", senderUserId: string, body: string): Promise<ClinicianMessage> {
  const pool = getPgPool();
  const message: ClinicianMessage = {
    id: makeId("MSG"),
    participantId,
    senderRole,
    senderUserId,
    body,
    createdAt: new Date().toISOString(),
  };
  await pool.query(
    `INSERT INTO clinician_messages (id, participant_id, sender_role, sender_user_id, created_at, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [message.id, participantId, senderRole, senderUserId, message.createdAt, JSON.stringify(message)],
  );
  return message;
}

async function listByParticipant(participantId: string): Promise<ClinicianMessage[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: ClinicianMessage }>(
    `SELECT data FROM clinician_messages WHERE participant_id = $1 ORDER BY created_at ASC`,
    [participantId],
  );
  return rows.map((row) => row.data);
}

export async function dispatchClinicianMessageStoreOp(op: ClinicianMessageStoreOp): Promise<unknown> {
  switch (op.op) {
    case "send": return send(op.participantId, op.senderRole, op.senderUserId, op.body);
    case "listByParticipant": return listByParticipant(op.participantId);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown clinician message store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
