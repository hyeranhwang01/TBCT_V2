import { NOTIFICATIONS_FROM_ADDRESS, getResendClient, resolveAppUrl } from "@/shared/notifications/resend-client";

export interface MessageNotificationInput {
  recipientEmail: string;
  participantId: string;
  participantAlias: string;
  senderRole: "patient" | "clinician";
  messagePreview: string;
  locale?: string;
}

/** Fire-and-forget email telling the OTHER side of a conversation that a
 * new message arrived -- see clinician-message-store's own doc comment
 * for why this exists: Realtime only reaches someone with the app open
 * right now. Called directly from
 * src/app/api/clinician-messages/store/route.ts (a genuinely server-side
 * Route Handler, unlike runtime-execution-api.ts -- no client-fetch
 * indirection needed here). Swallows its own errors so a bad send can
 * never fail the message send itself. */
export async function sendMessageNotificationEmail(input: MessageNotificationInput): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) {
      console.warn("[send-message-notification] RESEND_API_KEY not set; skipping notification email");
      return;
    }
    const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
    // Sender was the patient -> recipient is the clinician, link to that
    // participant's detail page (its Messages tab). Sender was the
    // clinician -> recipient is the patient, link to their own messages page.
    const messagesPath = input.senderRole === "patient" ? `/patients/${input.participantId}` : "/projects/demo/patient/messages";
    const appUrl = resolveAppUrl();
    const subject = isKorean ? `[TBCT Studio] 새 메시지가 도착했습니다` : `[TBCT Studio] New message`;
    const preview = input.messagePreview.length > 140 ? `${input.messagePreview.slice(0, 140)}…` : input.messagePreview;
    const text = isKorean
      ? `${input.participantAlias}${input.senderRole === "patient" ? " (환자)" : " (담당 의료진)"}로부터 새 메시지가 도착했습니다.\n\n"${preview}"\n\n확인하기: ${appUrl}${messagesPath}`
      : `New message from ${input.participantAlias}${input.senderRole === "patient" ? " (patient)" : " (care team)"}.\n\n"${preview}"\n\nView: ${appUrl}${messagesPath}`;
    await resend.emails.send({ from: NOTIFICATIONS_FROM_ADDRESS, to: [input.recipientEmail], subject, text });
  } catch (error) {
    console.error("[send-message-notification] failed to send notification email", error);
  }
}
