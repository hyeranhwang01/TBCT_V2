// Per-session memory settings. WORKSHEET_CHUNKERS: which sessions cut their
// worksheet their own way (chunk-builder.ts); a session missing there gets one
// chunk per recorded text value. RETRIEVAL_AFFINITY: which earlier chunks
// matter at each step of a session that retrieves (chunk-scorer.ts); a
// session missing there still retrieves, on tags and wording alone. S01 has no
// earlier session. Add a session when it is rebuilt: its file sits beside its
// prompt fields.

import { s01MemoryChunks } from "@/patient/sessions/s01/memory-chunks";
import { s02MemoryChunks, s02RetrievalAffinity } from "@/patient/sessions/s02/memory-chunks";
import type { WorksheetChunker } from "@/shared/memory/chunk-builder";
import type { RetrievalAffinity } from "@/shared/memory/chunk-scorer";

const WORKSHEET_CHUNKERS: Record<string, WorksheetChunker> = {
  "tbct-s01": s01MemoryChunks,
  "tbct-s02": s02MemoryChunks,
};

export function worksheetChunkerFor(sessionDefinitionId: string): WorksheetChunker | undefined {
  return WORKSHEET_CHUNKERS[sessionDefinitionId];
}

const RETRIEVAL_AFFINITY: Record<string, RetrievalAffinity> = {
  "tbct-s02": s02RetrievalAffinity,
};

export function retrievalAffinityFor(sessionDefinitionId: string): RetrievalAffinity {
  return RETRIEVAL_AFFINITY[sessionDefinitionId] ?? {};
}
