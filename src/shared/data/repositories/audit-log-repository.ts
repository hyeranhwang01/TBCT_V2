import { PROTOCOL_STUDIO_STORE_ENDPOINT } from "@/shared/runtime/protocol-studio-store-ops";
import type { ProtocolStudioStoreOp } from "@/shared/runtime/protocol-studio-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type { AuditEntry } from "@/types";

// Thin fetch client over src/app/api/protocol-studio/store/route.ts. The
// Protocol Studio audit log now lives in Neon Postgres, not local
// IndexedDB -- used by protocol-repository.ts and
// clinical-assets-repository.ts (both replacing db.auditEntries.put(...)
// calls) and by audit-page.tsx (replacing mock-api's getAuditEntries).
// Uses runtimeFetch (not plain fetch) so the memory-pipeline audit entries
// written during a server turn (memory-helpers.ts recordMemoryAudit) are
// dispatched in process instead of going back out over the network -- see
// runtime-request-context.ts. In the browser this is the plain fetch.
async function callStore<T>(op: ProtocolStudioStoreOp): Promise<T> {
  const response = await runtimeFetch(resolveStoreUrl(PROTOCOL_STUDIO_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Protocol studio store operation failed.");
  return body.result as T;
}

export async function saveAuditEntry(entry: AuditEntry) {
  await callStore<AuditEntry>({ op: "saveAuditEntry", entry });
  return entry;
}

export async function listAuditEntries() {
  return callStore<AuditEntry[]>({ op: "listAuditEntries" });
}
