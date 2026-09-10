import { NextResponse } from "next/server";
import { dispatchProtocolStudioStoreOp } from "@/shared/data/server/protocol-studio-store";
import type { ProtocolStudioStoreOp } from "@/shared/runtime/protocol-studio-store-ops";

export const runtime = "nodejs";

// Single RPC endpoint for the Protocol Studio audit log (see
// src/shared/runtime/protocol-studio-store-ops.ts for the op contract).
// src/shared/data/repositories/audit-log-repository.ts is a thin fetch client over
// this route.
export async function POST(request: Request) {
  try {
    const op = (await request.json()) as ProtocolStudioStoreOp;
    const result = await dispatchProtocolStudioStoreOp(op);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Protocol studio store operation failed." }, { status: 500 });
  }
}
