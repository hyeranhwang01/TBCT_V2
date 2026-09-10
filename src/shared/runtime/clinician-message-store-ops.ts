// Shared client/server contract for the clinician-messages store
// (Postgres, sql/015_clinician_messages.sql). Mirrors the pattern in
// homework-store-ops.ts: no server-only imports, safe from both the
// repository client and the server-side store implementation.
//
// Two different shapes on purpose: ClinicianMessageRequest is what goes
// over the wire from the repository client (participantId + body only --
// see clinician-message-repository.ts). ClinicianMessageStoreOp is what
// the route handler actually dispatches, AFTER filling in senderRole/
// senderUserId itself from the authenticated caller (see
// src/app/api/clinician-messages/store/route.ts) -- a patient must never
// be able to send a message that claims to be from a clinician by
// putting a different value in the request body.
export type ClinicianMessageRequest =
  | { op: "send"; participantId: string; body: string }
  | { op: "listByParticipant"; participantId: string };

export type ClinicianMessageStoreOp =
  | { op: "send"; participantId: string; senderRole: "patient" | "clinician"; senderUserId: string; body: string }
  | { op: "listByParticipant"; participantId: string };

export const CLINICIAN_MESSAGE_STORE_ENDPOINT = "/api/clinician-messages/store";
