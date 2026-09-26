import { getAuthenticatedCaller } from "@/shared/supabase/server";
import { runWithRuntimeRequestContext } from "@/shared/data/server/runtime-request-context";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import { getRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";

// Start, resume or continue a prompt-driven session (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02) on the server, where the model key
// is. Same caller and ownership checks as /api/runtime/turn.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const caller = await getAuthenticatedCaller();
  if (!caller) return new Response("Not authenticated", { status: 401 });
  const body = await request.json().catch(() => null) as { sessionId?: string } | null;
  if (!body?.sessionId) return new Response("Invalid session step", { status: 400 });
  if (caller.role === "patient") {
    const [participant, session] = await Promise.all([
      getParticipantByAuthUserId(caller.userId),
      getRuntimeSessionRecord(body.sessionId),
    ]);
    if (!participant || !session || session.participantId !== participant.id) return new Response("Not authorized", { status: 403 });
  }
  try {
    const result = await runWithRuntimeRequestContext(request, async () => {
      const { continuePromptSession } = await import("@/shared/api/prompt-session-api");
      return continuePromptSession(body.sessionId!);
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    console.error("[runtime-prompt-session] session step failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Session step failed" }, { status: 500 });
  }
}
