import { NextResponse } from "next/server";
import { z } from "zod";
import { dialogueContractSchema } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { generateDialogueDecision } from "@/shared/dialogue-agent/anthropic-dialogue-agent";

export const runtime = "nodejs";
const bodySchema = z.object({ contract: dialogueContractSchema, context: z.object({ sessionId: z.string(), turnId: z.string() }) });
export async function POST(request: Request) {
  try { const body = bodySchema.parse(await request.json()); return NextResponse.json({ ok: true, data: await generateDialogueDecision(body.contract, body.context) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Dialogue agent failed" }, { status: 503 }); }
}
