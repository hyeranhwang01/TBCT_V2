import { NextResponse } from "next/server";
import { z } from "zod";
import { selectDistortionCandidates } from "@/patient/sessions/s01/distortion-candidates";

export const runtime = "nodejs";
const bodySchema = z.object({
  request: z.object({ locale: z.string(), situation: z.string(), automaticThought: z.string(), emotion: z.string().optional() }),
  context: z.object({ sessionId: z.string(), turnId: z.string() }),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    return NextResponse.json({ ok: true, data: await selectDistortionCandidates(body.request, body.context) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Distortion candidate selection failed" }, { status: 503 });
  }
}
