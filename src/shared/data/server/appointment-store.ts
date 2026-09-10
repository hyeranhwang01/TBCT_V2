import { getPgPool } from "@/shared/data/db/pg-pool";
import type { AppointmentStoreOp } from "@/shared/runtime/appointment-store-ops";
import type { Appointment } from "@/types/appointment";

// Server-only: the real (Postgres) implementation of the appointments
// store -- reached only through src/app/api/appointments/store/route.ts
// (or, for the reminder cron, direct import -- see
// listAppointmentsNeedingReminder's own doc comment), never imported by
// client components. Same "document row" pattern as homework-store.ts.

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function create(participantId: string, clinicianUserId: string, scheduledAt: string, durationMinutes: number, notes?: string): Promise<Appointment> {
  const pool = getPgPool();
  const now = new Date().toISOString();
  const appointment: Appointment = {
    id: makeId("APPT"),
    participantId,
    clinicianUserId,
    scheduledAt,
    durationMinutes,
    status: "scheduled",
    notes,
    createdAt: now,
    updatedAt: now,
  };
  await pool.query(
    `INSERT INTO appointments (id, participant_id, clinician_user_id, scheduled_at, duration_minutes, status, created_at, updated_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [appointment.id, participantId, clinicianUserId, scheduledAt, durationMinutes, appointment.status, now, now, JSON.stringify(appointment)],
  );
  return appointment;
}

async function listByParticipant(participantId: string): Promise<Appointment[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: Appointment }>(
    `SELECT data FROM appointments WHERE participant_id = $1 ORDER BY scheduled_at ASC`,
    [participantId],
  );
  return rows.map((row) => row.data);
}

async function updateStatus(id: string, status: "completed" | "cancelled" | "no_show"): Promise<Appointment> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: Appointment }>(`SELECT data FROM appointments WHERE id = $1`, [id]);
  const current = rows[0]?.data;
  if (!current) throw new Error(`Appointment not found: ${id}`);
  const now = new Date().toISOString();
  const next: Appointment = { ...current, status, updatedAt: now };
  await pool.query(`UPDATE appointments SET status = $2, updated_at = $3, data = $4 WHERE id = $1`, [id, status, now, JSON.stringify(next)]);
  return next;
}

/** Every scheduled appointment starting within [windowStart, windowEnd)
 * that hasn't had a reminder sent yet -- used only by the daily reminder
 * cron (src/app/api/cron/appointment-reminders/route.ts), a genuinely
 * server-side caller that reads Postgres directly rather than through the
 * cookie-authed store route, same reasoning as every other cron route in
 * this app. */
export async function listAppointmentsNeedingReminder(windowStart: string, windowEnd: string): Promise<Appointment[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: Appointment }>(
    `SELECT data FROM appointments WHERE status = 'scheduled' AND reminder_sent_at IS NULL AND scheduled_at >= $1 AND scheduled_at < $2`,
    [windowStart, windowEnd],
  );
  return rows.map((row) => row.data);
}

/** Marks a reminder as sent -- called by the same cron route right after
 * a successful send, so the next run's window scan doesn't re-notify. */
export async function markReminderSent(id: string): Promise<void> {
  const pool = getPgPool();
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE appointments SET reminder_sent_at = $2, data = jsonb_set(data, '{reminderSentAt}', to_jsonb($2::text)) WHERE id = $1`,
    [id, now],
  );
}

export async function dispatchAppointmentStoreOp(op: AppointmentStoreOp): Promise<unknown> {
  switch (op.op) {
    case "create": return create(op.participantId, op.clinicianUserId, op.scheduledAt, op.durationMinutes, op.notes);
    case "listByParticipant": return listByParticipant(op.participantId);
    case "updateStatus": return updateStatus(op.id, op.status);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown appointment store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
