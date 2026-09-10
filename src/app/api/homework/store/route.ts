import { NextResponse } from "next/server";
import { dispatchHomeworkStoreOp } from "@/shared/data/server/homework-store";
import type { HomeworkStoreOp } from "@/shared/runtime/homework-store-ops";

export const runtime = "nodejs";

// Single RPC endpoint for the homework/follow-up-activity store (see
// src/lib/runtime/homework-store-ops.ts for the op contract).
// src/lib/repositories/homework-repository.ts is a thin fetch client over
// this route, matching the pattern of the worksheet/runtime/participant stores.
export async function POST(request: Request) {
  try {
    const op = (await request.json()) as HomeworkStoreOp;
    const result = await dispatchHomeworkStoreOp(op);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Homework store operation failed." }, { status: 500 });
  }
}
