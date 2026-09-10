import { NOTIFICATIONS_FROM_ADDRESS, getResendClient, resolveAppUrl } from "@/shared/notifications/resend-client";

export interface DataDeletionRequestNotificationInput {
  recipientEmail: string;
  participantId: string;
  participantAlias: string;
}

/** Tells a clinician a patient has requested their data be deleted --
 * fire-and-forget, called from data-deletion-requests/store/route.ts
 * right after the request is persisted (see that migration's own doc
 * comment for why this is a request, not an automatic delete: a clinical
 * record-keeping obligation means an admin/clinician has to review and
 * action each one by hand). */
export async function sendDataDeletionRequestNotificationEmail(input: DataDeletionRequestNotificationInput): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) {
      console.warn("[send-data-deletion-request-notification] RESEND_API_KEY not set; skipping notification email");
      return;
    }
    const appUrl = resolveAppUrl();
    const subject = `[TBCT Studio] Data deletion request -- ${input.participantAlias}`;
    const text = `Participant ${input.participantAlias} has requested their data be deleted.\n\nThis does not delete anything automatically -- please review and action it from the admin dashboard.\n\nParticipant: ${appUrl}/patients/${input.participantId}`;
    await resend.emails.send({ from: NOTIFICATIONS_FROM_ADDRESS, to: [input.recipientEmail], subject, text });
  } catch (error) {
    console.error("[send-data-deletion-request-notification] failed to send notification email", error);
  }
}
