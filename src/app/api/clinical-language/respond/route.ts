import { NextResponse } from "next/server";
import { clinicalProviderRequestSchema } from "@/shared/clinical-language/clinical-language-contract";
import { respondClinicalLanguage } from "@/shared/clinical-language/clinical-language-server";

type ClinicalProviderError = { type: "authentication" | "rate_limit" | "unknown" | "malformed_response" | "missing_configuration" | "timeout" | "network" | "unsupported_provider"; message: string; retryable: boolean; requestId?: string };

function statusFor(error: ClinicalProviderError) {
  if (error.type === "authentication") return 401;
  if (error.type === "rate_limit") return 429;
  if (error.type === "missing_configuration" || error.type === "unsupported_provider") return 503;
  if (error.type === "timeout") return 504;
  return 502;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const payload = clinicalProviderRequestSchema.parse(await request.json());
    const result = await respondClinicalLanguage(payload);
    if ("error" in result) {
      const error = result.error as ClinicalProviderError;
      console.error("clinical-language provider failure", { requestId, provider: process.env.AI_PROVIDER ?? "mock", model: process.env.ANTHROPIC_MODEL, errorType: error.type, retryable: error.retryable, safeMessage: error.message });
      return NextResponse.json({ ok: false, error: { ...error, requestId } }, { status: statusFor(error) });
    }
    return NextResponse.json({ ok: true, data: result, requestId });
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : "UnknownError";
    console.error("clinical-language route rejection", { requestId, errorClass, safeMessage: error instanceof Error ? error.message.slice(0, 300) : "Invalid request" });
    return NextResponse.json({ ok: false, error: { type: "invalid_request", message: "Invalid request", retryable: false, requestId } }, { status: 400 });
  }
}
