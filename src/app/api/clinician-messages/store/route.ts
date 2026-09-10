import { NextResponse } from "next/server";
import { dispatchClinicianMessageStoreOp } from "@/shared/data/server/clinician-message-store";
import { getParticipant, getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import type { ClinicianMessageRequest } from "@/shared/runtime/clinician-message-store-ops";
import { getAuthenticatedCaller } from "@/shared/supabase/server";
import { getUserEmail, listClinicianEmails } from "@/shared/supabase/admin";
import { sendMessageNotificationEmail } from "@/shared/notifications/send-message-notification";

export const runtime = "nodejs";

// Fire-and-forget: tells the OTHER side of the conversation a message
// arrived. Not awaited by the caller (see the "send" branch below) -- a
// slow/failed email must never delay or fail the message send itself.
async function dispatchMessageNotification(participantId: string, senderRole: "patient" | "clinician", messageBody: string): Promise<void> {
  const participant = await getParticipant(participantId);
  if (!participant) return;
  if (senderRole === "patient") {
    // Recipient is a clinician -- prefer the assigned one, fall back to
    // the whole roster (matches sendSafetyAlertEmail's own fallback).
    const recipients = participant.assignedClinician
      ? [await getUserEmail(participant.assignedClinician)].filter((email): email is string => Boolean(email))
      : await listClinicianEmails();
    await Promise.all(
      recipients.map((email) =>
        sendMessageNotificationEmail({ recipientEmail: email, participantId, participantAlias: participant.alias, senderRole, messagePreview: messageBody, locale: participant.locale }),
      ),
    );
    return;
  }
  // Recipient is the patient -- respect their notification preference
  // (absent means enabled, same convention as sessionReminders/
  // homeworkReminders in RuntimeParticipant.notificationPreferences).
  if (participant.notificationPreferences?.newMessages === false) return;
  if (!participant.authUserId) return;
  const email = await getUserEmail(participant.authUserId);
  if (!email) return;
  await sendMessageNotificationEmail({ recipientEmail: email, participantId, participantAlias: participant.alias, senderRole, messagePreview: messageBody, locale: participant.locale });
}

// Single RPC endpoint for the patient<->clinician message thread.
// senderRole/senderUserId are ALWAYS derived here from the authenticated
// caller, never taken from the request body -- see
// clinician-message-store-ops.ts's own doc comment for why. A patient may
// only send/read their own participant's thread; a clinician may
// send/read any participant's (matches this app's existing "clinicians
// share one flat pool" model, e.g. participants/store/route.ts).
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ClinicianMessageRequest;
    const caller = await getAuthenticatedCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    if (!caller.role) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });

    if (caller.role === "patient") {
      const own = await getParticipantByAuthUserId(caller.userId);
      if (!own || own.id !== body.participantId) {
        return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
      }
    }

    if (body.op === "send") {
      if (!body.body?.trim()) return NextResponse.json({ ok: false, error: "Message body is required." }, { status: 400 });
      const senderRole = caller.role === "admin" ? "clinician" : caller.role;
      const result = await dispatchClinicianMessageStoreOp({ op: "send", participantId: body.participantId, senderRole, senderUserId: caller.userId, body: body.body.trim() });
      void dispatchMessageNotification(body.participantId, senderRole, body.body.trim()).catch((error) =>
        console.error("[clinician-messages/store] failed to dispatch message notification", error),
      );
      return NextResponse.json({ ok: true, result });
    }

    const result = await dispatchClinicianMessageStoreOp(body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Clinician message store operation failed." }, { status: 500 });
  }
}
