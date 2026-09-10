import { NOTIFICATIONS_FROM_ADDRESS, getResendClient, resolveAppUrl } from "@/shared/notifications/resend-client";

export interface AppointmentReminderInput {
  patientEmail: string;
  scheduledAt: string;
  locale?: string;
}

function formatKoreanDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/** Day-before reminder for a scheduled appointment -- called only from the
 * daily cron route (src/app/api/cron/appointment-reminders/route.ts).
 * Swallows its own errors so one bad send can't abort the rest of that
 * day's batch. */
export async function sendAppointmentReminderEmail(input: AppointmentReminderInput): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) {
      console.warn("[send-appointment-reminder] RESEND_API_KEY not set; skipping reminder email");
      return;
    }
    const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
    const appUrl = resolveAppUrl();
    const when = formatKoreanDateTime(input.scheduledAt);
    const subject = isKorean ? "[TBCT Studio] 내일 예약이 있습니다" : "[TBCT Studio] You have an appointment coming up";
    const text = isKorean
      ? `안녕하세요,\n\n${when}에 예약이 있습니다.\n\n확인하기: ${appUrl}`
      : `Hi,\n\nYou have an appointment scheduled for ${when}.\n\nView: ${appUrl}`;
    await resend.emails.send({ from: NOTIFICATIONS_FROM_ADDRESS, to: [input.patientEmail], subject, text });
  } catch (error) {
    console.error("[send-appointment-reminder] failed to send reminder email", error);
  }
}
