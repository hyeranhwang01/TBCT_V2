import { NextResponse } from "next/server";
import { dispatchStandardizedAssessmentStoreOp } from "@/shared/data/server/standardized-assessment-store";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import type { StandardizedAssessmentStoreOp } from "@/shared/runtime/standardized-assessment-store-ops";
import { getAuthenticatedCaller } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Single RPC endpoint for the standardized clinical screening store (see
// src/lib/runtime/standardized-assessment-store-ops.ts for the op
// contract). Unlike several of this app's other *-store routes (see the
// login feature's plan for the write-side authorization gaps flagged
// there), this one is gated per-op -- PHQ-9/GAD-7 responses include a
// self-harm ideation item, so an unauthenticated or cross-participant read
// here is a real exposure, not just a hardening nice-to-have.
export async function POST(request: Request) {
  try {
    const op = (await request.json()) as StandardizedAssessmentStoreOp;
    const caller = await getAuthenticatedCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });

    if (op.op === "listAllResponses" && caller.role !== "clinician") {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }
    if (caller.role === "patient") {
      const own = await getParticipantByAuthUserId(caller.userId);
      const targetParticipantId = op.op === "saveResponse" ? op.response.participantId : op.op === "listResponsesByParticipant" ? op.participantId : undefined;
      if (targetParticipantId && (!own || own.id !== targetParticipantId)) {
        return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
      }
    }

    const result = await dispatchStandardizedAssessmentStoreOp(op);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Standardized assessment store operation failed." }, { status: 500 });
  }
}
