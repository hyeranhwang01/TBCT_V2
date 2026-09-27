import { PARTICIPANT_STORE_ENDPOINT, type ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type { MemoryChunk, MemoryChunkRetrieval, MemoryChunkTags } from "@/types/memory-chunks";

// Memory chunks (sql/027) go through the participant store endpoint, like the
// rest of the participant's longitudinal record. On the server they are
// dispatched in process (runtime-request-context.ts); from the browser only a
// clinician may call them (route.ts).
async function callStore<T>(op: ParticipantStoreOp): Promise<T> {
  const response = await runtimeFetch(resolveStoreUrl(PARTICIPANT_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Memory chunk store operation failed.");
  return body.result as T;
}

/** Returns how many chunks were new. */
export async function saveMemoryChunks(chunks: MemoryChunk[]) {
  if (!chunks.length) return 0;
  return callStore<number>({ op: "saveMemoryChunks", chunks });
}

export async function listMemoryChunks(participantId: string, options: { beforeSessionIndex?: number; includeSuppressed?: boolean } = {}) {
  return callStore<MemoryChunk[]>({ op: "listMemoryChunks", participantId, ...options });
}

export async function listMemoryChunksBySession(runtimeSessionId: string) {
  return callStore<MemoryChunk[]>({ op: "listMemoryChunksBySession", runtimeSessionId });
}

export async function suppressMemoryChunk(chunkId: string, reason: string) {
  return callStore<MemoryChunk>({ op: "suppressMemoryChunk", chunkId, reason });
}

export async function listUntaggedMemoryChunks(participantId: string) {
  return callStore<MemoryChunk[]>({ op: "listUntaggedMemoryChunks", participantId });
}

/** False when the chunk was already tagged (tags are set once). */
export async function setMemoryChunkTags(chunkId: string, tags: MemoryChunkTags, tagModel: string, tagPromptVersion: string) {
  return callStore<boolean>({ op: "setMemoryChunkTags", chunkId, tags, tagModel, tagPromptVersion });
}

export async function saveMemoryChunkRetrieval(retrieval: MemoryChunkRetrieval) {
  return callStore<MemoryChunkRetrieval>({ op: "saveMemoryChunkRetrieval", retrieval });
}

export async function listMemoryChunkRetrievals(runtimeSessionId: string) {
  return callStore<MemoryChunkRetrieval[]>({ op: "listMemoryChunkRetrievals", runtimeSessionId });
}
