// Shared client/server contract for the Protocol Studio audit log store
// (Neon Postgres). Mirrors the pattern in safety-store-ops.ts: no
// server-only imports, so this is safe to import from both the
// browser-facing repository clients (protocol-repository.ts,
// clinical-assets-repository.ts) and the server-side store implementation
// (protocol-studio-store.ts).
import type { AuditEntry } from "@/types";

export type ProtocolStudioStoreOp =
  | { op: "listAuditEntries" }
  | { op: "saveAuditEntry"; entry: AuditEntry };

export const PROTOCOL_STUDIO_STORE_ENDPOINT = "/api/protocol-studio/store";
