import { CLINICIAN_MESSAGE_STORE_ENDPOINT } from "@/shared/runtime/clinician-message-store-ops";
import type { ClinicianMessageRequest } from "@/shared/runtime/clinician-message-store-ops";
import { resolveStoreUrl } from "@/shared/runtime/resolve-store-url";
import type { ClinicianMessage } from "@/types/clinician-message";

// Thin fetch client over src/app/api/clinician-messages/store/route.ts.
// Sends ClinicianMessageRequest (participantId + body only) -- the route
// fills in senderRole/senderUserId itself from the caller's own session,
// see that route's own doc comment for why.
async function callStore<T>(request: ClinicianMessageRequest): Promise<T> {
  const response = await fetch(resolveStoreUrl(CLINICIAN_MESSAGE_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Clinician message store operation failed.");
  return body.result as T;
}

export async function sendClinicianMessage(participantId: string, body: string): Promise<ClinicianMessage> {
  return callStore<ClinicianMessage>({ op: "send", participantId, body });
}

export async function listClinicianMessages(participantId: string): Promise<ClinicianMessage[]> {
  return callStore<ClinicianMessage[]>({ op: "listByParticipant", participantId });
}
