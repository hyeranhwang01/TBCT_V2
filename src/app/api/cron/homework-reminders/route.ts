import { NextResponse } from "next/server";
// Direct server-side store imports, not the fetch-based homework-api.ts --
// see src/app/api/cron/reminders/route.ts's own doc comment for why: a cron
// job has no logged-in caller's session cookie, so the fetch-based
// repositories (gated on that cookie) would reject it.
import { listStaleIncompleteRecords } from "@/shared/data/server/homework-store";
import { getParticipant } from "@/shared/data/server/participant-store";
import { getUserEmail } from "@/shared/supabase/admin";
import { sendHomeworkReminderEmail } from "@/shared/notifications/send-homework-reminder";
import { isAuthorizedCronRequest } from "@/shared/runtime/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_STALE_DAYS_THRESHOLD = 7;

/** Daily job: reminds patients with a homework record that's still open
 * (not "completed") and untouched for HOMEWORK_REMINDER_STALE_DAYS_THRESHOLD+
 * days (default 7, tunable via env). A separate condition from
 * /api/cron/reminders -- a patient can have finished every runtime session
 * dialogue and still have pending homework (e.g. S1's weekly examples log),
 * so this checks homework_records directly rather than session staleness.
 * Skips participants with no linked auth account -- there's no email to
 * send to (e.g. the pre-auth demo participant). */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }
  const thresholdDays = Number(process.env.HOMEWORK_REMINDER_STALE_DAYS_THRESHOLD) || DEFAULT_STALE_DAYS_THRESHOLD;
  const staleSinceIso = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const staleRecords = await listStaleIncompleteRecords(staleSinceIso);
    let remindersSent = 0;
    let skippedNoEmail = 0;
    let skippedOptedOut = 0;
    for (const record of staleRecords) {
      const participant = await getParticipant(record.participantId);
      if (!participant?.authUserId) {
        skippedNoEmail++;
        continue;
      }
      if (participant.notificationPreferences?.homeworkReminders === false) {
        skippedOptedOut++;
        continue;
      }
      const email = await getUserEmail(participant.authUserId);
      if (!email) {
        skippedNoEmail++;
        continue;
      }
      const staleDays = Math.floor((Date.now() - new Date(record.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
      await sendHomeworkReminderEmail({ sessionDefinitionId: record.sessionDefinitionId, patientEmail: email, staleDays, locale: participant.locale });
      remindersSent++;
    }
    return NextResponse.json({ ok: true, remindersSent, skippedNoEmail, skippedOptedOut, thresholdDays });
  } catch (error) {
    console.error("[cron/homework-reminders] failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Homework reminder job failed." }, { status: 500 });
  }
}
