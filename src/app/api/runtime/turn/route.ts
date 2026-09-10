import { getAuthenticatedCaller } from "@/shared/supabase/server";
import { runWithRuntimeRequestContext } from "@/shared/data/server/runtime-request-context";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import { getRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";
import type { PatientInput } from "@/types/runtime-session";

export const runtime = "nodejs";
export const maxDuration = 60;

type TurnBody = {
  sessionId?: string;
  patientInput?: PatientInput;
  options?: { clientTurnId?: string; expectedSessionVersion?: number; locale?: string };
};

export async function POST(request: Request) {
  const caller = await getAuthenticatedCaller();
  if (!caller) return new Response("Not authenticated", { status: 401 });
  const body = await request.json() as TurnBody;
  if (!body.sessionId || !body.patientInput) return new Response("Invalid patient turn", { status: 400 });
  if (caller.role === "patient") {
    const [participant, session] = await Promise.all([
      getParticipantByAuthUserId(caller.userId),
      getRuntimeSessionRecord(body.sessionId),
    ]);
    if (!participant || !session || session.participantId !== participant.id) return new Response("Not authorized", { status: 403 });
  }
  try {
    const result = await runWithRuntimeRequestContext(request, async () => {
      const { submitPatientInput } = await import("@/shared/api/runtime-execution-api");
      return submitPatientInput(body.sessionId!, body.patientInput!, body.options);
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    console.error("[runtime-turn] patient turn failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Patient turn failed" }, { status: 500 });
  }
}
