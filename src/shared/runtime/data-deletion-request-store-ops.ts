// Shared client/server contract for the data deletion request store
// (Postgres, sql/018_data_deletion_requests.sql). Mirrors the pattern in
// homework-store-ops.ts.
export type DataDeletionRequestStoreOp =
  | { op: "create"; participantId: string; requestedByUserId: string; reason?: string }
  | { op: "listByParticipant"; participantId: string }
  | { op: "listAll" }
  | { op: "resolve"; id: string; status: "completed" | "denied" };

export const DATA_DELETION_REQUEST_STORE_ENDPOINT = "/api/data-deletion-requests/store";
