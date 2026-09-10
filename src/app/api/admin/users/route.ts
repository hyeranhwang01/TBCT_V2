import { NextResponse } from "next/server";
import { listAllUsers, setUserBanned } from "@/shared/supabase/admin";
import { getAuthenticatedCaller } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Admin-only account management: list every registered user (any role)
// and ban/unban them. This is the direct answer to "anyone can self-signup
// as a clinician, with no gatekeeping" -- see the admin-role feature's own
// plan. Every user id -> email/role lookup here uses the service-role
// admin client (src/lib/supabase/admin.ts), since an ordinary client can
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
    const { userId, banned } = (await request.json()) as { userId?: string; banned?: boolean };
    if (!userId || typeof banned !== "boolean") {
      return NextResponse.json({ ok: false, error: "userId and banned are required." }, { status: 400 });
    }
    if (userId === caller.userId) {
      return NextResponse.json({ ok: false, error: "You can't ban your own account." }, { status: 400 });
    }
    await setUserBanned(userId, banned);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to update user." }, { status: 500 });
  }
}
