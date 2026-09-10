import { NextResponse } from "next/server";
import { assessmentRequestSchema } from "@/shared/assessment/assessment-contract";
import { getAssessmentModel } from "@/shared/assessment/assessment-providers";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { const input = assessmentRequestSchema.parse(await request.json()); const result = await getAssessmentModel().assessInput(input); return NextResponse.json({ ok: true, data: result }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Assessment failed" }, { status: 503 }); }
}
