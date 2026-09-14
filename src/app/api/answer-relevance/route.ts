import { NextResponse } from "next/server";
import { z } from "zod";
import { answerRelevanceRequestSchema, judgeAnswerRelevance } from "@/shared/dialogue-agent/answer-relevance";

export const runtime = "nodejs";
const bodySchema = z.object({ request: answerRelevanceRequestSchema, context: z.object({ sessionId: z.string(), turnId: z.string() }) });
export async function POST(request: Request) {
  try { const body = bodySchema.parse(await request.json()); return NextResponse.json({ ok: true, data: await judgeAnswerRelevance(body.request, body.context) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Answer relevance check failed" }, { status: 503 }); }
}
