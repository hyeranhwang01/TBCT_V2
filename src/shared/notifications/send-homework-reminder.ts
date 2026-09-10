import { CANONICAL_SESSION_DEFINITIONS } from "@/shared/protocol/source-fidelity-catalog";
import { NOTIFICATIONS_FROM_ADDRESS, getResendClient, resolveAppUrl } from "@/shared/notifications/resend-client";

const SESSION_NUMBER_BY_ID = new Map(CANONICAL_SESSION_DEFINITIONS.map((def) => [def.id, def.number] as const));

export interface HomeworkReminderInput {
  sessionDefinitionId: string;
  patientEmail: string;
  staleDays: number;
  locale?: string;
}

/** Reminder for a patient with an incomplete between-session homework
 * activity (see homework-store.ts's listStaleIncompleteRecords) -- a
 * different condition from sendSessionReminderEmail: a patient can have
 * finished every runtime session dialogue and still have pending homework
 * (e.g. S1's weekly examples log). Called only from the daily cron route
 * (src/app/api/cron/homework-reminders/route.ts); swallows its own errors
 * so one bad send can't abort the rest of that day's batch. */
export async function sendHomeworkReminderEmail(input: HomeworkReminderInput): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) {
      console.warn("[send-homework-reminder] RESEND_API_KEY not set; skipping reminder email");
      return;
    }
    const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
    const appUrl = resolveAppUrl();
    const settingsUrl = `${appUrl}/patient/profile`;
    const sessionNumber = SESSION_NUMBER_BY_ID.get(input.sessionDefinitionId);
    const sessionLabel = sessionNumber ? (isKorean ? `${sessionNumber}회차` : `Session ${sessionNumber}`) : (isKorean ? "이전 세션" : "a past session");
    const subject = isKorean ? "[TBCT Studio] 과제가 아직 남아있어요" : "[TBCT Studio] A homework activity is still open";
    const text = isKorean
      ? `안녕하세요,\n\n${sessionLabel} 과제가 ${input.staleDays}일째 완료되지 않았습니다. 시간 되실 때 이어서 해보세요.\n\n계속하기: ${appUrl}\n\n이 알림을 더 받고 싶지 않으시면 프로필 설정에서 끌 수 있어요: ${settingsUrl}`
      : `Hi,\n\nYour ${sessionLabel} homework has been open for ${input.staleDays} days. Whenever you're ready, you can pick back up.\n\nContinue: ${appUrl}\n\nYou can turn this reminder off anytime in your profile settings: ${settingsUrl}`;
    await resend.emails.send({ from: NOTIFICATIONS_FROM_ADDRESS, to: [input.patientEmail], subject, text });
  } catch (error) {
    console.error("[send-homework-reminder] failed to send reminder email", error);
  }
}
