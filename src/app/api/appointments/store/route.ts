import { NextResponse } from "next/server";
import { dispatchAppointmentStoreOp } from "@/shared/data/server/appointment-store";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import type { AppointmentRequest } from "@/shared/runtime/appointment-store-ops";
import { getAuthenticatedCaller } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Single RPC endpoint for appointments. "create"/"updateStatus" are
// clinician/admin only -- v1 has no patient self-scheduling (see
// sql/020_appointments.sql's own doc comment for that scoping choice). A
// patient may only ever list their OWN appointments.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AppointmentRequest;
    const caller = await getAuthenticatedCaller();
    if (!caller || !caller.role) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });

    if ((body.op === "create" || body.op === "updateStatus") && caller.role === "patient") {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }
    if (body.op === "listByParticipant" && caller.role === "patient") {
      const own = await getParticipantByAuthUserId(caller.userId);
      if (!own || own.id !== body.participantId) {
        return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
      }
    }

    if (body.op === "create") {
      const clinicianUserId = caller.userId;
      const result = await dispatchAppointmentStoreOp({ op: "create", participantId: body.participantId, clinicianUserId, scheduledAt: body.scheduledAt, durationMinutes: body.durationMinutes, notes: body.notes });
      return NextResponse.json({ ok: true, result });
    }

    const result = await dispatchAppointmentStoreOp(body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Appointment store operation failed." }, { status: 500 });
  }
}
