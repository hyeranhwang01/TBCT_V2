import { NextResponse } from "next/server";
import { dispatchRuntimeStoreOp, getRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";
import type { RuntimeStoreOp } from "@/shared/runtime/runtime-store-ops";
import { getAuthenticatedCaller } from "@/shared/supabase/server";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import { isPromptDrivenSession } from "@/shared/runtime/prompt-driven-sessions";

export const runtime = "nodejs";

// Single RPC endpoint for the runtime conversation store (see
// src/shared/runtime/runtime-store-ops.ts for the op contract). This is the
// operational read/write path for patient <-> assistant sessions --
// src/shared/data/repositories/runtime-session-repository.ts is a thin fetch client
// over this route, so every call site across the app is unaffected by the
// storage backend living in Postgres now instead of local IndexedDB.
//
// Authorization: clinicians and admins have full access (shared pool). A
// patient (.claude/TASK_SCOPE.json note2026_09_28_rct_backend):
//  - may read and write only sessions that are their own -- every op that
//    names a session is checked, reads included (before this, the
//    sub-resource ops were unchecked, so any patient could read another's
//    transcript or add messages to it by session id);
//  - in a prompt-driven session (S01/S02) may not write conversation content
//    (messages, assistant turns and their provider/validation/trace records,
//    escalations) nor change recorded values: those are written on the server
//    (prompt-session-api.ts), where store calls are dispatched in process and
//    never reach this route. Logs, checkpoints and status changes stay open --
//    the browser writes them when it starts, resumes or ends the session;
//  - in a node-engine session (S03-S08) may write what the browser engine
//    writes while running its own session (own session only; this residual
//    path goes away when those sessions move to the server);
//  - may not change who a session belongs to or what it is (participantId,
//    sessionDefinitionId, protocol/release, numbering) and may not mark it
//    completed -- only the server completes a session, which is what makes
//    an attempt official;
//  - may never delete a session, list all sessions or all escalations.

export async function POST(request: Request) {
  try {
    const op = (await request.json()) as RuntimeStoreOp;
    const caller = await getAuthenticatedCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    // No one deletes a session through the app: sessions and their messages
    // are trial records (sql/033). Erasure is a database procedure
    // (tbct.allow_erasure, scripts/purge-retention.ts).
    if (op.op === "deleteSession") return NextResponse.json({ ok: false, error: "Sessions are not deleted." }, { status: 403 });
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

const NEVER_FOR_PATIENTS = new Set<RuntimeStoreOp["op"]>(["listSessions", "deleteSession", "listEscalations", "updateEscalation"]);

/** The session an op concerns, if it names one. */
function sessionIdOf(op: RuntimeStoreOp): string | undefined {
  switch (op.op) {
    case "getSession":
    case "updateSession":
    case "claimPatientTurn":
    case "claimSessionStart":
      return op.sessionId;
    case "listMessages":
    case "listLogs":
    case "getLatestCheckpoint":
    case "listCheckpoints":
    case "listEscalationsBySession":
    case "listProviderEvents":
    case "listValidationEvents":
    case "listExecutionTraces":
      return op.runtimeSessionId;
    case "saveMessage":
      return op.message.runtimeSessionId;
    case "saveLog":
      return op.log.runtimeSessionId;
    case "saveCheckpoint":
      return op.checkpoint.runtimeSessionId;
    case "saveEscalation":
      return op.event.runtimeSessionId;
    case "saveProviderEvent":
    case "saveValidationEvent":
      return op.event.runtimeSessionId;
    case "saveExecutionTrace":
      return op.trace.runtimeSessionId;
    case "commitAssistantTurn":
      return op.input.sessionId;
    default:
      return undefined;
  }
}

const CONTENT_WRITES = new Set<RuntimeStoreOp["op"]>(["saveMessage", "saveEscalation", "saveProviderEvent", "saveValidationEvent", "saveExecutionTrace", "commitAssistantTurn"]);
const FIXED_SESSION_KEYS = ["id", "participantId", "sessionDefinitionId", "protocolId", "protocolVersion", "releaseId", "createdAt", "sessionNumber", "attemptNumber", "isOfficial", "completedAt"];

async function isDeniedForPatient(op: RuntimeStoreOp, callerUserId: string): Promise<boolean> {
  if (NEVER_FOR_PATIENTS.has(op.op)) return true;
  const own = await getParticipantByAuthUserId(callerUserId);
  if (!own) return true;
  if (op.op === "listSessionsByParticipant") return op.participantId !== own.id;
  if (op.op === "createSession") return op.session.participantId !== own.id;
  const sessionId = sessionIdOf(op);
  if (!sessionId) return true;
  const session = await getRuntimeSessionRecord(sessionId);
  if (!session || session.participantId !== own.id) return true;
  const promptDriven = isPromptDrivenSession(session.sessionDefinitionId);
  if (CONTENT_WRITES.has(op.op) && promptDriven) return true;
  if (op.op === "updateSession") {
    const patch = op.patch as Record<string, unknown>;
    if (FIXED_SESSION_KEYS.some((key) => key in patch && JSON.stringify(patch[key]) !== JSON.stringify((session as unknown as Record<string, unknown>)[key]))) return true;
    if (patch.status === "completed" && session.status !== "completed") return true;
    if (promptDriven && patch.runtimeContext !== undefined) {
      const fields = (patch.runtimeContext as { fields?: unknown } | null)?.fields;
      if (fields !== undefined && JSON.stringify(fields) !== JSON.stringify(session.runtimeContext.fields)) return true;
    }
  }
  return false;
}
