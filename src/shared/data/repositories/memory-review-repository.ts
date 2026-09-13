import { PARTICIPANT_STORE_ENDPOINT, type ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type { MemoryReviewDecision } from "@/types/longitudinal-memory";

// Clinician review decisions live in Neon Postgres (memory_review_decisions,
// sql/023_memory_pipeline.sql) so they sit next to the candidates they
// decide on, visible from any clinician browser. Signatures unchanged.
async function callStore<T>(op: ParticipantStoreOp): Promise<T> {
  const response = await runtimeFetch(resolveStoreUrl(PARTICIPANT_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Participant store operation failed.");
  return body.result as T;
}

export async function saveMemoryReviewDecision(decision: MemoryReviewDecision) {
  await callStore<MemoryReviewDecision>({ op: "saveMemoryReviewDecision", decision });
  return decision;
}

export async function listMemoryReviewDecisions(memoryId: string) {
  return callStore<MemoryReviewDecision[]>({ op: "listMemoryReviewDecisions", memoryId });
}
