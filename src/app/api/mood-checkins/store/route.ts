import { NextResponse } from "next/server";
import { dispatchMoodCheckinStoreOp } from "@/shared/data/server/mood-checkin-store";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import type { MoodCheckinStoreOp } from "@/shared/runtime/mood-checkin-store-ops";
import { getAuthenticatedCaller } from "@/shared/supabase/server";

export const runtime = "nodejs";

// Single RPC endpoint for the mood check-in store. Gated per-op like
// standardized-assessments/store/route.ts (not the no-auth pattern some of
// this app's other *-store routes use) -- a patient's daily mood is their
// own data, not something a cross-participant read should ever reach.
export async function POST(request: Request) {
  try {
    const op = (await request.json()) as MoodCheckinStoreOp;
    const caller = await getAuthenticatedCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });

    if (caller.role === "patient") {
      const own = await getParticipantByAuthUserId(caller.userId);
      if (!own || own.id !== op.participantId) {
        return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
      }
    }

    const result = await dispatchMoodCheckinStoreOp(op);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Mood check-in store operation failed." }, { status: 500 });
  }
}
