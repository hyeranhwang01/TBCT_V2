import { NextResponse } from "next/server";
import { grantUserRole, requestClinicianRole } from "@/shared/supabase/admin";
import { getSignedInUser } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Where a signed-in user's role gets granted (src/shared/auth/roles.ts).
// Called by auth-context.tsx when the session has no granted role yet (a new
// signup, or an account from before roles moved to app_metadata).
//  - patient requested at signup: granted -- patient self-signup is open;
//  - clinician requested: recorded as pending; an admin approves it;
//  - already granted: returned as is. Nothing here can grant clinician or
//    admin.
export async function POST() {
  const user = await getSignedInUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  try {
    if (user.role) return NextResponse.json({ ok: true, result: { role: user.role } });
    if (user.requestedRole === "patient") {
      await grantUserRole(user.userId, "patient");
      return NextResponse.json({ ok: true, result: { role: "patient" } });
    }
    if (user.requestedRole === "clinician") {
      if (!user.pendingRole) await requestClinicianRole(user.userId);
      return NextResponse.json({ ok: true, result: { role: null, pendingRole: "clinician" } });
    }
    return NextResponse.json({ ok: true, result: { role: null } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not resolve the role." }, { status: 500 });
  }
}
