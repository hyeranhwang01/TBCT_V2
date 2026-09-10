import { DATA_DELETION_REQUEST_STORE_ENDPOINT } from "@/shared/runtime/data-deletion-request-store-ops";
import type { DataDeletionRequestStoreOp } from "@/shared/runtime/data-deletion-request-store-ops";
import { resolveStoreUrl } from "@/shared/runtime/resolve-store-url";
import type { DataDeletionRequest } from "@/types/data-deletion-request";

async function callStore<T>(op: DataDeletionRequestStoreOp): Promise<T> {
  const response = await fetch(resolveStoreUrl(DATA_DELETION_REQUEST_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Data deletion request store operation failed.");
  return body.result as T;
}

export async function createDataDeletionRequest(participantId: string, reason?: string): Promise<DataDeletionRequest> {
  // requestedByUserId is a placeholder here -- the route always overwrites
  // it with the authenticated caller's own id, same pattern as
  // clinician-message-store-ops.ts's senderUserId.
  return callStore<DataDeletionRequest>({ op: "create", participantId, requestedByUserId: "", reason });
}

export async function listDataDeletionRequestsByParticipant(participantId: string): Promise<DataDeletionRequest[]> {
  return callStore<DataDeletionRequest[]>({ op: "listByParticipant", participantId });
}

export async function listAllDataDeletionRequests(): Promise<DataDeletionRequest[]> {
  return callStore<DataDeletionRequest[]>({ op: "listAll" });
}

export async function resolveDataDeletionRequest(id: string, status: "completed" | "denied"): Promise<DataDeletionRequest> {
  return callStore<DataDeletionRequest>({ op: "resolve", id, status });
}
