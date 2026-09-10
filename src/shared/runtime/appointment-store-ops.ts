// Shared client/server contract for the appointments store (Postgres,
// sql/020_appointments.sql). Mirrors the pattern in homework-store-ops.ts.
//
// "create" does NOT accept clinicianUserId from the caller when the
// caller is a patient (there's no patient self-scheduling in v1 anyway --
// the route rejects a patient "create" entirely); when the caller is a
// clinician, the route fills in clinicianUserId from their own session,
// same reasoning as clinician-message-store-ops.ts's senderUserId.
export type AppointmentRequest =
  | { op: "create"; participantId: string; scheduledAt: string; durationMinutes: number; notes?: string }
  | { op: "listByParticipant"; participantId: string }
  | { op: "updateStatus"; id: string; status: "completed" | "cancelled" | "no_show" };

export type AppointmentStoreOp =
  | { op: "create"; participantId: string; clinicianUserId: string; scheduledAt: string; durationMinutes: number; notes?: string }
  | { op: "listByParticipant"; participantId: string }
  | { op: "updateStatus"; id: string; status: "completed" | "cancelled" | "no_show" };

export const APPOINTMENT_STORE_ENDPOINT = "/api/appointments/store";
