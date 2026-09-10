import { NextResponse } from "next/server";
import { patientRendererRequestSchema } from "@/shared/patient-renderer/patient-renderer-contract";
import { renderPatientReflection } from "@/shared/patient-renderer/anthropic-patient-renderer";
import { z } from "zod";

export const runtime = "nodejs";
const bodySchema = z.object({ request: patientRendererRequestSchema, context: z.object({ sessionId: z.string(), turnId: z.string() }) });
export async function POST(request: Request) {
  try { const body = bodySchema.parse(await request.json()); return NextResponse.json({ ok: true, data: await renderPatientReflection(body.request, body.context) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Patient reflection failed" }, { status: 503 }); }
}
