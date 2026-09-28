import { NextResponse } from "next/server";
import { grantUserRole, listAllUsers, setUserBanned } from "@/shared/supabase/admin";
import { getAuthenticatedCaller } from "@/shared/supabase/server";
import { APP_ROLES, type AppRole } from "@/shared/auth/roles";

export const runtime = "nodejs";

// Admin-only account management: list every registered user (any role),
// ban/unban them, and grant or remove roles (approving a clinician signup). This is the direct answer to "anyone can self-signup
// as a clinician, with no gatekeeping" -- see the admin-role feature's own
// plan. Every user id -> email/role lookup here uses the service-role
// admin client (src/shared/supabase/admin.ts), since an ordinary client can
// never see another user's identity.
export async function GET() {
  const caller = await getAuthenticatedCaller();
  if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  if (caller.role !== "admin") return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
  try {
    const users = await listAllUsers();
    return NextResponse.json({ ok: true, result: users });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to list users." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const caller = await getAuthenticatedCaller();
  if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  if (caller.role !== "admin") return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
  try {
    const body = (await request.json()) as { userId?: string; banned?: boolean; role?: unknown };
    const { userId, banned } = body;
    if (!userId) return NextResponse.json({ ok: false, error: "userId is required." }, { status: 400 });
    if (userId === caller.userId) {
      return NextResponse.json({ ok: false, error: "You can't change your own account here." }, { status: 400 });
    }
    // Granting or removing a role (roles.ts): the only place a clinician
    // role is given -- e.g. approving a pending clinician signup.
    if ("role" in body) {
      const role = body.role;
      if (role !== null && !APP_ROLES.includes(role as AppRole)) {
        return NextResponse.json({ ok: false, error: `role must be one of ${APP_ROLES.join(", ")} or null.` }, { status: 400 });
      }
      await grantUserRole(userId, role as AppRole | null);
      return NextResponse.json({ ok: true });
    }
    if (typeof banned !== "boolean") {
      return NextResponse.json({ ok: false, error: "banned or role is required." }, { status: 400 });
    }
    await setUserBanned(userId, banned);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to update user." }, { status: 500 });
  }
}
