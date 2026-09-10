import { NextResponse } from "next/server";
import { dispatchRuntimeStoreOp, getRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";
import type { RuntimeStoreOp } from "@/shared/runtime/runtime-store-ops";
import { getAuthenticatedCaller } from "@/shared/supabase/server";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";

export const runtime = "nodejs";

// Single RPC endpoint for the runtime conversation store (see
// src/shared/runtime/runtime-store-ops.ts for the op contract). This is the
// operational read/write path for patient <-> assistant sessions --
// src/shared/data/repositories/runtime-session-repository.ts is a thin fetch client
// over this route, so every call site across the app is unaffected by the
// storage backend living in Postgres now instead of local IndexedDB.
//
// Authorization: clinicians keep today's unrestricted access (shared pool,
// see the login feature's plan). A patient may only ever list/read/create/
// mutate a session that is their own. This only covers the read-side ops
// and the handful of write ops with an unambiguous, directly-checkable
// session/participant reference (createSession, updateSession,
// claimPatientTurn, deleteSession) -- the deeper sub-resource ops (messages,
// logs, checkpoints, escalations, provider/validation events, execution
// traces, commitAssistantTurn) are reachable from the same normal
// turn-submission flow a patient legitimately triggers every turn, and are
// deliberately left unrestricted here rather than risk a wrong ownership
// check silently breaking live patient sessions -- a narrower gap than full
// coverage, flagged rather than silently left unmentioned.
export async function POST(request: Request) {
  try {
    const op = (await request.json()) as RuntimeStoreOp;
    const caller = await getAuthenticatedCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    if (caller.role === "patient") {
      const denied = await isDeniedForPatient(op, caller.userId);
      if (denied) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }
    const result = await dispatchRuntimeStoreOp(op);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Runtime store operation failed." }, { status: 500 });
  }
}

async function isDeniedForPatient(op: RuntimeStoreOp, callerUserId: string): Promise<boolean> {
  if (op.op === "listSessions") return true;
  const own = await getParticipantByAuthUserId(callerUserId);
  if (!own) return true;
  if (op.op === "listSessionsByParticipant") return op.participantId !== own.id;
  if (op.op === "createSession") return op.session.participantId !== own.id;
  if (op.op === "getSession" || op.op === "updateSession" || op.op === "deleteSession" || op.op === "claimPatientTurn") {
    const session = await getRuntimeSessionRecord(op.sessionId);
    return !session || session.participantId !== own.id;
  }
  return false;
}
