// Per-session memory settings. WORKSHEET_CHUNKERS: which sessions cut their
// worksheet their own way (chunk-builder.ts); a session missing there gets one
// chunk per recorded text value. RETRIEVAL_SLOTS: which kinds of earlier
// chunk a step of a session is about and always gets (chunk-scorer.ts,
// retrieval-v2); everything else -- and every step of a session missing
// there -- is retrieved on tags and wording alone. S01 has no earlier session. Add a session when it is rebuilt: its file sits beside its
// prompt fields.

import { s01MemoryChunks } from "@/patient/sessions/s01/memory-chunks";
import { s02MemoryChunks, s02RetrievalSlots } from "@/patient/sessions/s02/memory-chunks";
import type { WorksheetChunker } from "@/shared/memory/chunk-builder";
import type { RetrievalSlots } from "@/shared/memory/chunk-scorer";

const WORKSHEET_CHUNKERS: Record<string, WorksheetChunker> = {
  "tbct-s01": s01MemoryChunks,
  "tbct-s02": s02MemoryChunks,
};

export function worksheetChunkerFor(sessionDefinitionId: string): WorksheetChunker | undefined {
  return WORKSHEET_CHUNKERS[sessionDefinitionId];
}

const RETRIEVAL_SLOTS: Record<string, RetrievalSlots> = {
  "tbct-s02": s02RetrievalSlots,
};

export function retrievalSlotsFor(sessionDefinitionId: string): RetrievalSlots {
  return RETRIEVAL_SLOTS[sessionDefinitionId] ?? {};
}
