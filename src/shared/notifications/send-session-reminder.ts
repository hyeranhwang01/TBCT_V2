import { NOTIFICATIONS_FROM_ADDRESS, getResendClient, resolveAppUrl } from "@/shared/notifications/resend-client";

export interface SessionReminderInput {
  participantId: string;
  patientEmail: string;
  staleDays: number;
  locale?: string;
}

/** Reminder email for a patient who has gone quiet mid-treatment -- called
 * only from the daily cron route (src/app/api/cron/reminders/route.ts), never
 * from a request path a patient is actively waiting on, but still swallows
 * its own errors so one bad send can't abort the rest of that day's batch. */
export async function sendSessionReminderEmail(input: SessionReminderInput): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) {
      console.warn("[send-session-reminder] RESEND_API_KEY not set; skipping reminder email");
      return;
    }
    const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
    const appUrl = resolveAppUrl();
    const settingsUrl = `${appUrl}/patient/profile`;
    const subject = isKorean ? "[TBCT Studio] 다음 세션을 계속해 볼까요?" : "[TBCT Studio] Continue your session?";
    const text = isKorean
      ? `안녕하세요,\n\n${input.staleDays}일 동안 세션 활동이 없었습니다. 준비되시면 다시 이어가 보세요.\n\n계속하기: ${appUrl}\n\n이 알림을 더 받고 싶지 않으시면 프로필 설정에서 끌 수 있어요: ${settingsUrl}`
      : `Hi,\n\nIt's been ${input.staleDays} days since your last session activity. Whenever you're ready, you can pick back up.\n\nContinue: ${appUrl}\n\nYou can turn this reminder off anytime in your profile settings: ${settingsUrl}`;
    await resend.emails.send({ from: NOTIFICATIONS_FROM_ADDRESS, to: [input.patientEmail], subject, text });
  } catch (error) {
    console.error("[send-session-reminder] failed to send reminder email", error);
  }
}
