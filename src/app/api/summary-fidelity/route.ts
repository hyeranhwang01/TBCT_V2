import { NextResponse } from "next/server";
import { z } from "zod";
import { judgeSummaryFidelity, summaryFidelityRequestSchema } from "@/shared/dialogue-agent/summary-fidelity";

export const runtime = "nodejs";
const bodySchema = z.object({ request: summaryFidelityRequestSchema, context: z.object({ sessionId: z.string(), turnId: z.string() }) });
export async function POST(request: Request) {
  try { const body = bodySchema.parse(await request.json()); return NextResponse.json({ ok: true, data: await judgeSummaryFidelity(body.request, body.context) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Summary fidelity check failed" }, { status: 503 }); }
}
