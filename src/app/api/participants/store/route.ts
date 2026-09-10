import { NextResponse } from "next/server";
import { dispatchParticipantStoreOp, getMemory, getParticipant, getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import type { ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import { getAuthenticatedCaller } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Single RPC endpoint for the participant roster + longitudinal memory
// (clinician notes) store (see src/lib/runtime/participant-store-ops.ts for
// the op contract). This is the shared read/write path so a participant
// created from the patient-facing runtime is visible from the clinician
// Patient Monitoring screens, and vice versa --
// src/lib/repositories/participant-repository.ts and (for clinician-note
// operations) longitudinal-memory-repository.ts are thin fetch clients over
// this route.
//
// Authorization: clinicians share one flat pool (see the login feature's
// plan) and may read/write any participant, matching this route's
// pre-login behavior. A patient may only ever resolve their OWN participant
// record here -- never the full roster, never another patient's record by
// guessing/enumerating an id. This is enforced here, not by Postgres RLS,
// because this route always queries with the full-access DATABASE_URL (see
// pg-pool.ts) -- the app itself is the authorization boundary.
export async function POST(request: Request) {
  try {
    const op = (await request.json()) as ParticipantStoreOp;
    const caller = await getAuthenticatedCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    if (caller.role === "patient") {
      const denied = await isDeniedForPatient(op, caller.userId);
      if (denied) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }
    const result = await dispatchParticipantStoreOp(op);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Participant store operation failed." }, { status: 500 });
  }
}

/** True if a patient caller must NOT be allowed to run this op. Read-side
 * only (listParticipants full roster, getParticipant/getParticipantByAuthUserId
 * for someone else's record) -- see the login feature's plan for why
 * write-side per-op ownership checks (saveParticipant/updateParticipant/
 * memory ops, all reachable from the same normal turn-submission flow) are
 * deferred rather than risking a subtly wrong check breaking live patient
 * sessions under this pass's time budget. */
async function isDeniedForPatient(op: ParticipantStoreOp, callerUserId: string): Promise<boolean> {
  if (op.op === "listParticipants") return true;
  if (op.op === "getParticipantByAuthUserId") return op.authUserId !== callerUserId;
  if (op.op === "saveParticipant") return op.participant.authUserId !== callerUserId;
  if (op.op === "getParticipant" || op.op === "updateParticipant" || op.op === "listMemories") {
    const [target, own] = await Promise.all([getParticipant(op.participantId), getParticipantByAuthUserId(callerUserId)]);
    return !target || !own || target.id !== own.id;
  }
  if (op.op === "saveMemory") {
    const own = await getParticipantByAuthUserId(callerUserId);
    return !own || op.memory.participantId !== own.id;
  }
  if (op.op === "getMemory" || op.op === "updateMemory") {
    const memoryId = op.op === "getMemory" ? op.memoryId : op.memoryId;
    const [memory, own] = await Promise.all([getMemory(memoryId), getParticipantByAuthUserId(callerUserId)]);
    return !memory || !own || memory.participantId !== own.id;
  }
  return false;
}
