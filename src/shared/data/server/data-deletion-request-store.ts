import { getPgPool } from "@/shared/data/db/pg-pool";
import type { DataDeletionRequestStoreOp } from "@/shared/runtime/data-deletion-request-store-ops";
import type { DataDeletionRequest } from "@/types/data-deletion-request";

// Server-only: the real (Postgres) implementation of the data deletion
// request store -- reached only through
// src/app/api/data-deletion-requests/store/route.ts, never imported by
// client components. Same "document row" pattern as homework-store.ts.

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function create(participantId: string, requestedByUserId: string, reason?: string): Promise<DataDeletionRequest> {
  const pool = getPgPool();
  const request: DataDeletionRequest = {
    id: makeId("DDR"),
    participantId,
    requestedByUserId,
    status: "pending",
    reason,
    createdAt: new Date().toISOString(),
  };
  await pool.query(
    `INSERT INTO data_deletion_requests (id, participant_id, requested_by_user_id, status, reason, created_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [request.id, participantId, requestedByUserId, request.status, reason ?? null, request.createdAt, JSON.stringify(request)],
  );
  return request;
}

async function listByParticipant(participantId: string): Promise<DataDeletionRequest[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: DataDeletionRequest }>(
    `SELECT data FROM data_deletion_requests WHERE participant_id = $1 ORDER BY created_at DESC`,
    [participantId],
  );
  return rows.map((row) => row.data);
}

async function listAll(): Promise<DataDeletionRequest[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: DataDeletionRequest }>(`SELECT data FROM data_deletion_requests ORDER BY created_at DESC`);
  return rows.map((row) => row.data);
}

async function resolve(id: string, status: "completed" | "denied"): Promise<DataDeletionRequest> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: DataDeletionRequest }>(`SELECT data FROM data_deletion_requests WHERE id = $1`, [id]);
  const current = rows[0]?.data;
  if (!current) throw new Error(`Data deletion request not found: ${id}`);
  const resolvedAt = new Date().toISOString();
  const next: DataDeletionRequest = { ...current, status, resolvedAt };
  await pool.query(`UPDATE data_deletion_requests SET status = $2, resolved_at = $3, data = $4 WHERE id = $1`, [id, status, resolvedAt, JSON.stringify(next)]);
  return next;
}

export async function dispatchDataDeletionRequestStoreOp(op: DataDeletionRequestStoreOp): Promise<unknown> {
  switch (op.op) {
    case "create": return create(op.participantId, op.requestedByUserId, op.reason);
    case "listByParticipant": return listByParticipant(op.participantId);
    case "listAll": return listAll();
    case "resolve": return resolve(op.id, op.status);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown data deletion request store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
