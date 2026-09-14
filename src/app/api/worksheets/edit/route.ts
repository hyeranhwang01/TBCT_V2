import { getAuthenticatedCaller } from "@/shared/supabase/server";
import { runWithRuntimeRequestContext } from "@/shared/data/server/runtime-request-context";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import { getRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";

export const runtime = "nodejs";

type EditBody = { runtimeSessionId?: string; sessionDefinitionId?: string; worksheetFieldKey?: string; value?: unknown };

// One request per worksheet edit (.claude/TASK_SCOPE.json
// note2026_09_14_patient_worksheet_edit, followUp2026_09_14_speed). Run from
// the browser, editWorksheetField made about twenty store requests, each
// through Vercel, Supabase auth and Postgres; here its store calls run in
// process (runtime-request-context.ts). Same caller check as
// /api/runtime/turn: a patient may only edit their own session.
export async function POST(request: Request) {
  const caller = await getAuthenticatedCaller();
  if (!caller) return Response.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as EditBody;
  if (!body.runtimeSessionId || !body.sessionDefinitionId || !body.worksheetFieldKey) return Response.json({ ok: false, error: "Invalid worksheet edit." }, { status: 400 });
  if (caller.role === "patient") {
    const [participant, session] = await Promise.all([
      getParticipantByAuthUserId(caller.userId),
      getRuntimeSessionRecord(body.runtimeSessionId),
    ]);
    if (!participant || !session || session.participantId !== participant.id) return Response.json({ ok: false, error: "Not authorized." }, { status: 403 });
  }
  try {
    const result = await runWithRuntimeRequestContext(request, async () => {
      const { editWorksheetField } = await import("@/shared/worksheet/worksheet-projection");
      return editWorksheetField(body.runtimeSessionId!, body.sessionDefinitionId!, body.worksheetFieldKey!, body.value);
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worksheet edit failed.";
    // A refused edit (worksheet_edit:<code>) is the participant's to fix, not a server fault.
    return Response.json({ ok: false, error: message }, { status: message.startsWith("worksheet_edit:") ? 400 : 500 });
  }
}
