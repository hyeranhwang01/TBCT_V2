import { NextResponse } from "next/server";
import { z } from "zod";
import { generateS01SceneOnServer } from "@/patient/sessions/s01/generation";

export const runtime = "nodejs";
const bodySchema = z.object({
  kind: z.literal("scene"),
  request: z.object({ locale: z.string(), avoidTerms: z.array(z.string()).max(200).optional() }),
  context: z.object({ sessionId: z.string(), turnId: z.string() }),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    return NextResponse.json({ ok: true, data: await generateS01SceneOnServer(body.request, body.context) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "S01 scene generation failed" }, { status: 503 });
  }
}
