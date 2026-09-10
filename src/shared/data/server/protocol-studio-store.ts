import { getPgPool } from "@/shared/data/db/pg-pool";
import type { AuditEntry } from "@/types";
import type { ProtocolStudioStoreOp } from "@/shared/runtime/protocol-studio-store-ops";

// Server-only: the real (Neon Postgres) implementation of the Protocol Studio
// audit log -- reached only through src/app/api/protocol-studio/store/route.ts,
// never imported by client components (DATABASE_URL is not exposed to the
// browser bundle). Replaces the Dexie `auditEntries` table used by the
// clinical-assets and protocol repositories.

export async function listAuditEntries(): Promise<AuditEntry[]> {
  const { rows } = await getPgPool().query<{ data: AuditEntry }>(
    "SELECT data FROM protocol_studio_audit_entries ORDER BY timestamp DESC",
  );
  return rows.map((row) => row.data);
}

export async function saveAuditEntry(entry: AuditEntry): Promise<AuditEntry> {
  await getPgPool().query(
    `INSERT INTO protocol_studio_audit_entries (id, timestamp, action, resource, version, data)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [entry.id, entry.timestamp, entry.action, entry.resource, entry.version ?? null, JSON.stringify(entry)],
  );
  return entry;
}

export async function dispatchProtocolStudioStoreOp(op: ProtocolStudioStoreOp): Promise<unknown> {
  switch (op.op) {
    case "listAuditEntries":
      return listAuditEntries();
    case "saveAuditEntry":
      return saveAuditEntry(op.entry);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown protocol studio store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
