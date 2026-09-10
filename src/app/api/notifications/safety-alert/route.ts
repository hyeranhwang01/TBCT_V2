import { NextResponse } from "next/server";
import { sendSafetyAlertEmail } from "@/shared/notifications/send-safety-alert";
import { getAuthenticatedCaller } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Server-side dispatch for sendSafetyAlertEmail -- runtime-execution-api.ts
// (where a safety escalation is created) is imported only by "use client"
// page components and so runs entirely in the browser, where RESEND_API_KEY
// and SUPABASE_SERVICE_ROLE_KEY are never available (Next.js strips
// non-NEXT_PUBLIC_ env vars from client bundles). Calling
// sendSafetyAlertEmail directly from there would silently no-op forever,
// even once Resend is fully provisioned -- this route is what actually
// gets it onto the server. Gated to any authenticated caller (patient or
// clinician): the request body is only used to describe an escalation that
// already happened, never to read anything back, so the worst case of a
// forged call is a spurious email, not a data leak -- matching this
// codebase's existing per-op authorization posture (see the RLS/authorization
// notes on the runtime-session-store route). Never awaited by the caller
// (see runtime-execution-api.ts's call site) -- errors are swallowed inside
// sendSafetyAlertEmail itself.
export async function POST(request: Request) {
  try {
    const caller = await getAuthenticatedCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const body = await request.json();
    const { participantId, participantAlias, severity, triggerSummary, assignedClinicianUserId, locale } = body as {
      participantId?: string;
      participantAlias?: string;
      severity?: "high" | "medium";
      triggerSummary?: string;
      assignedClinicianUserId?: string;
      locale?: string;
    };
    if (!participantId || !participantAlias || !severity || !triggerSummary) {
      return NextResponse.json({ ok: false, error: "participantId, participantAlias, severity, and triggerSummary are required." }, { status: 400 });
    }
    await sendSafetyAlertEmail({ participantId, participantAlias, severity, triggerSummary, assignedClinicianUserId, locale });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // sendSafetyAlertEmail already swallows its own errors -- this catch is
    // only for a malformed request body, so it's safe to surface directly.
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to dispatch safety alert." }, { status: 500 });
  }
}
