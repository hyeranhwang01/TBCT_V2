import { NextResponse } from "next/server";
import { getUserEmail } from "@/shared/supabase/admin";
import { getAuthenticatedCaller } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Resolves a clinician's Supabase Auth user id (as stored in
// RuntimeParticipant.assignedClinician, see participant-api.ts) to their
// email, for display in the Patient Monitoring UI. Uses the service-role
// admin client (src/lib/supabase/admin.ts) since an ordinary client can only
// ever see its own session's identity, never another user's. Gated to
// clinician callers -- a patient has no legitimate reason to resolve a
// clinician's identity through this route.
export async function POST(request: Request) {
  try {
    const caller = await getAuthenticatedCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    if (caller.role !== "clinician") return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    const { userId } = (await request.json()) as { userId: string };
    if (!userId) return NextResponse.json({ ok: false, error: "userId is required." }, { status: 400 });
    const email = await getUserEmail(userId);
    return NextResponse.json({ ok: true, email });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to resolve clinician email." }, { status: 500 });
  }
}
