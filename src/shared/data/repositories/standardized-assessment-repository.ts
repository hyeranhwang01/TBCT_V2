import { STANDARDIZED_ASSESSMENT_STORE_ENDPOINT } from "@/shared/runtime/standardized-assessment-store-ops";
import type { StandardizedAssessmentStoreOp } from "@/shared/runtime/standardized-assessment-store-ops";
import { resolveStoreUrl } from "@/shared/runtime/resolve-store-url";
import type { StandardizedAssessmentResponse } from "@/types/standardized-assessment";

// Thin fetch client over src/app/api/standardized-assessments/store/route.ts,
// matching the pattern of homework-repository.ts / worksheet-repository.ts.
async function callStore<T>(op: StandardizedAssessmentStoreOp): Promise<T> {
  const response = await fetch(resolveStoreUrl(STANDARDIZED_ASSESSMENT_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Standardized assessment store operation failed.");
  return body.result as T;
}

export async function saveStandardizedAssessmentResponse(response: StandardizedAssessmentResponse): Promise<StandardizedAssessmentResponse> {
  return callStore<StandardizedAssessmentResponse>({ op: "saveResponse", response });
}

export async function listStandardizedAssessmentResponsesByParticipant(participantId: string): Promise<StandardizedAssessmentResponse[]> {
  return callStore<StandardizedAssessmentResponse[]>({ op: "listResponsesByParticipant", participantId });
}

export async function listAllStandardizedAssessmentResponses(): Promise<StandardizedAssessmentResponse[]> {
  return callStore<StandardizedAssessmentResponse[]>({ op: "listAllResponses" });
}
