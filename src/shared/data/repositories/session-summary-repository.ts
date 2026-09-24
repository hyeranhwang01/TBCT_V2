import { PARTICIPANT_STORE_ENDPOINT, type ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type { RuntimeSessionSummary } from "@/types/longitudinal-memory";

// Session summaries live in Neon Postgres (runtime_session_summaries,
// sql/023_memory_pipeline.sql) -- they are generated on the server at
// session completion (runtime-execution-api.ts completeRuntimeSession),
// where the previous Dexie/IndexedDB table did not exist. Same thin
// fetch-client shape as longitudinal-memory-repository.ts; signatures
// unchanged.
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

export async function getSessionSummaryBySession(runtimeSessionId: string) {
  return callStore<RuntimeSessionSummary | undefined>({ op: "getSessionSummaryBySession", runtimeSessionId });
}

export async function getSessionSummary(summaryId: string) {
  return callStore<RuntimeSessionSummary | undefined>({ op: "getSessionSummary", summaryId });
}

export async function saveSessionSummary(summary: RuntimeSessionSummary) {
  await callStore<RuntimeSessionSummary>({ op: "saveSessionSummary", summary });
  return summary;
}

export async function updateSessionSummary(summaryId: string, patch: Partial<RuntimeSessionSummary>) {
  return callStore<RuntimeSessionSummary>({ op: "updateSessionSummary", summaryId, patch });
}
