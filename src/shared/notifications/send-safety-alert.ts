import { getUserEmail, listClinicianEmails } from "@/shared/supabase/admin";
import { NOTIFICATIONS_FROM_ADDRESS, getResendClient, resolveAppUrl } from "@/shared/notifications/resend-client";

export interface SafetyAlertInput {
  participantId: string;
  participantAlias: string;
  severity: "high" | "medium";
  triggerSummary: string;
  assignedClinicianUserId?: string;
  locale?: string;
}

async function resolveRecipients(assignedClinicianUserId?: string): Promise<string[]> {
  if (assignedClinicianUserId) {
    const email = await getUserEmail(assignedClinicianUserId);
    if (email) return [email];
    // Assigned clinician has no resolvable email (deleted/edge case) -- fall
    // through to the full clinician pool rather than silently alerting no one.
  }
  return listClinicianEmails();
}

/** Fire-and-forget safety escalation email. Deliberately never awaited on the
 * patient's turn-submission path (see call site in runtime-execution-api.ts)
 * -- swallows and logs every error itself so a missing API key, a Resend
 * outage, or an unresolvable recipient can never fail or delay the patient's
 * turn. */
export async function sendSafetyAlertEmail(input: SafetyAlertInput): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) {
      console.warn("[send-safety-alert] RESEND_API_KEY not set; skipping safety alert email");
      return;
    }
    const recipients = await resolveRecipients(input.assignedClinicianUserId);
    if (!recipients.length) {
      console.warn("[send-safety-alert] no clinician recipients resolved; skipping safety alert email");
      return;
    }
    const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
    const patientUrl = `${resolveAppUrl()}/patients/${input.participantId}`;
    const severityLabel = isKorean ? (input.severity === "high" ? "긴급" : "우선") : input.severity === "high" ? "Urgent" : "Priority";
    const subject = isKorean
      ? `[TBCT Studio] ${severityLabel} 안전 경보 · ${input.participantAlias}`
      : `[TBCT Studio] ${severityLabel} safety alert · ${input.participantAlias}`;
    const text = isKorean
      ? `참여자 ${input.participantAlias}에게서 안전 트리거가 발생하여 임상 검토가 필요합니다.\n\n사유: ${input.triggerSummary}\n\n환자 상세 보기: ${patientUrl}`
      : `A safety trigger requires clinical review for participant ${input.participantAlias}.\n\nReason: ${input.triggerSummary}\n\nView patient: ${patientUrl}`;
    await resend.emails.send({ from: NOTIFICATIONS_FROM_ADDRESS, to: recipients, subject, text });
  } catch (error) {
    console.error("[send-safety-alert] failed to send safety alert email", error);
  }
}
