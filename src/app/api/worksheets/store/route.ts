import { NextResponse } from "next/server";
import { dispatchWorksheetStoreOp } from "@/shared/data/server/worksheet-store";
import type { WorksheetStoreOp } from "@/shared/runtime/worksheet-store-ops";

export const runtime = "nodejs";

// Single RPC endpoint for the session worksheet store (see
// src/shared/runtime/worksheet-store-ops.ts for the op contract).
// src/shared/data/repositories/worksheet-repository.ts is a thin fetch client over
// this route, matching the pattern of the runtime/participant/safety stores.
export async function POST(request: Request) {
  try {
    const op = (await request.json()) as WorksheetStoreOp;
    const result = await dispatchWorksheetStoreOp(op);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Worksheet store operation failed." }, { status: 500 });
  }
}
