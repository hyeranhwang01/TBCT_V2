import { NextResponse } from "next/server";
// Direct server-side store imports, not the fetch-based repository -- see
// src/app/api/cron/reminders/route.ts's own doc comment for why: a cron
// job has no logged-in caller's session cookie.
import { listAppointmentsNeedingReminder, markReminderSent } from "@/shared/data/server/appointment-store";
import { getParticipant } from "@/shared/data/server/participant-store";
import { getUserEmail } from "@/shared/supabase/admin";
import { sendAppointmentReminderEmail } from "@/shared/notifications/send-appointment-reminder";
import { isAuthorizedCronRequest } from "@/shared/runtime/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// A day-before reminder, not a live countdown -- see
// sql/020_appointments.sql's own doc comment for that scoping choice.
// The window is wider than 24h (36h) so a daily cron run always catches
// "tomorrow" regardless of exactly when in the day it fires.
const REMINDER_WINDOW_HOURS = 36;

/** Daily job: emails patients whose appointment is coming up within
 * REMINDER_WINDOW_HOURS and hasn't had a reminder sent yet
 * (reminder_sent_at). Skips participants with no linked auth account --
 * there's no email to send to. */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }
  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);
    const appointments = await listAppointmentsNeedingReminder(now.toISOString(), windowEnd.toISOString());
    let remindersSent = 0;
    let skippedNoEmail = 0;
    for (const appointment of appointments) {
      const participant = await getParticipant(appointment.participantId);
      if (!participant?.authUserId) {
        skippedNoEmail++;
        continue;
      }
      const email = await getUserEmail(participant.authUserId);
      if (!email) {
        skippedNoEmail++;
        continue;
      }
      await sendAppointmentReminderEmail({ patientEmail: email, scheduledAt: appointment.scheduledAt, locale: participant.locale });
      await markReminderSent(appointment.id);
      remindersSent++;
    }
    return NextResponse.json({ ok: true, remindersSent, skippedNoEmail, windowHours: REMINDER_WINDOW_HOURS });
  } catch (error) {
    console.error("[cron/appointment-reminders] failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Appointment reminder job failed." }, { status: 500 });
  }
}
