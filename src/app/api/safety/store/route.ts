import { NextResponse } from "next/server";
import { dispatchSafetyStoreOp } from "@/shared/data/server/safety-monitoring-store";
import type { SafetyStoreOp } from "@/shared/runtime/safety-store-ops";

export const runtime = "nodejs";

// Single RPC endpoint for the clinician safety-monitoring store (see
// src/lib/runtime/safety-store-ops.ts for the op contract). This is the
// operational read/write path for safety events, triage, interventions,
// follow-ups, clinicians, notifications, reports, handoffs, resume
// requests, and trigger suppressions --
// src/lib/repositories/safety-event-repository.ts is a thin fetch client
// over this route, so every call site (both patient-facing runtime and
// clinician safety screens) is unaffected by the storage backend living in
// Postgres now instead of local IndexedDB.
export async function POST(request: Request) {
  try {
    const op = (await request.json()) as SafetyStoreOp;
    const result = await dispatchSafetyStoreOp(op);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Safety store operation failed." }, { status: 500 });
  }
}
