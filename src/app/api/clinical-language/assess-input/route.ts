import { NextResponse } from "next/server";
import { clinicalInputAssessmentRequestSchema } from "@/shared/clinical-language/clinical-language-contract";
import { assessClinicalInput } from "@/shared/clinical-language/clinical-language-server";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const payload = clinicalInputAssessmentRequestSchema.parse(await request.json());
    const result = await assessClinicalInput(payload);
    if ("error" in result) {
      const status = result.error.type === "authentication" ? 401 : result.error.type === "rate_limit" ? 429 : 500;
      return NextResponse.json({ ok: false, error: { ...result.error, requestId } }, { status });
    }
    return NextResponse.json({ ok: true, data: result, requestId });
  } catch {
    return NextResponse.json({ ok: false, error: { type: "unknown", message: "Invalid request", retryable: false, requestId } }, { status: 400 });
  }
}