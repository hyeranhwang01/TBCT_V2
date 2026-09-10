import { NextResponse } from "next/server";
import { dispatchDataDeletionRequestStoreOp } from "@/shared/data/server/data-deletion-request-store";
import { getParticipant, getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import { getUserEmail, listClinicianEmails } from "@/shared/supabase/admin";
import { sendDataDeletionRequestNotificationEmail } from "@/shared/notifications/send-data-deletion-request-notification";
import type { DataDeletionRequestStoreOp } from "@/shared/runtime/data-deletion-request-store-ops";
import { getAuthenticatedCaller } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Single RPC endpoint for data deletion requests. "create"/"listByParticipant"
// are reachable by the owning patient or any clinician (matches the shared-
// pool model elsewhere); "listAll"/"resolve" are clinician/admin only -- a
// patient reviewing or resolving deletion requests makes no sense.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DataDeletionRequestStoreOp;
    const caller = await getAuthenticatedCaller();
    if (!caller || !caller.role) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });

    if ((body.op === "listAll" || body.op === "resolve") && caller.role === "patient") {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }
    if ((body.op === "create" || body.op === "listByParticipant") && caller.role === "patient") {
      const own = await getParticipantByAuthUserId(caller.userId);
      if (!own || own.id !== body.participantId) {
        return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
      }
    }

    if (body.op === "create") {
      const result = await dispatchDataDeletionRequestStoreOp({ op: "create", participantId: body.participantId, requestedByUserId: caller.userId, reason: body.reason });
      void notifyDeletionRequest(body.participantId).catch((error) => console.error("[data-deletion-requests/store] failed to notify", error));
      return NextResponse.json({ ok: true, result });
    }

    const result = await dispatchDataDeletionRequestStoreOp(body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Data deletion request store operation failed." }, { status: 500 });
  }
}

async function notifyDeletionRequest(participantId: string): Promise<void> {
  const participant = await getParticipant(participantId);
  if (!participant) return;
  const recipients = participant.assignedClinician
    ? [await getUserEmail(participant.assignedClinician)].filter((email): email is string => Boolean(email))
    : await listClinicianEmails();
  await Promise.all(recipients.map((email) => sendDataDeletionRequestNotificationEmail({ recipientEmail: email, participantId, participantAlias: participant.alias })));
}
