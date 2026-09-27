// Participant memory chunks (sql/027_participant_memory_chunks.sql): the
// pieces of earlier sessions the runtime may retrieve later. Built by
// src/shared/memory/chunk-builder.ts.

export type MemoryChunkKind = "worksheet" | "episode" | "homework" | "clinician_note";

/** What part of the work a chunk is. Set by code from where it came from --
 * the "element kind" axis of the tag list; the other axes come from the
 * tagger (M3). */
export type MemoryElementKind =
  | "problem"
  | "goal"
  | "own_case"
  | "situation"
  | "automatic_thought"
  | "emotion"
  | "behavior"
  | "body"
  | "cycle"
  | "safety_behavior"
  | "alternative_thought"
  | "distortion_example"
  | "distortion_priority"
  | "reflection"
  | "homework"
  | "homework_report"
  | "agreement"
  | "conversation"
  | "clinician_note"
  | "other";

/** Filled once by the tagger (M3); null until then. */
export interface MemoryChunkTags {
  domains: string[];
  persons: string[];
  emotions: string[];
  beliefs: string[];
  distortions: string[];
}

export interface MemoryChunk {
  id: string;
  participantId: string;
  runtimeSessionId: string;
  sessionDefinitionId: string;
  /** 1 for tbct-s01 ... 8 for tbct-s08. Retrieval in session N reads chunks
   * with a lower index. Homework belongs to the session that assigned it. */
  sessionIndex: number;
  chunkKind: MemoryChunkKind;
  elementKind: MemoryElementKind;
  fieldNames: string[];
  sourceMessageIds: string[];
  /** A homework entry id, or another source that is not a message. */
  sourceRef?: string;
  content: string;
  /** Distortions known from structure (an S02 row, an S01 homework row). */
  distortionIds: string[];
  /** When the participant said or wrote it. */
  sourceCreatedAt: string;
  indexVersion: string;
  tags?: MemoryChunkTags | null;
  taggedAt?: string;
  tagModel?: string;
  tagPromptVersion?: string;
  suppressed: boolean;
  suppressedAt?: string;
  suppressedBy?: string;
  suppressedReason?: string;
  createdAt: string;
}

/** One row of memory_chunk_retrievals (sql/029): a retrieval for one model call. */
export interface MemoryChunkRetrieval {
  id: string;
  participantId: string;
  runtimeSessionId: string;
  /** The assistant message this call produced, once committed. */
  messageId?: string;
  consentState: "granted" | "declined" | "undecided";
  algorithmVersion: string;
  indexVersion: string;
  query: { text: string; focusField?: string; themes?: MemoryChunkTags; opening: boolean };
  candidateCount: number;
  selected: Array<{ chunkId: string; score: number; parts: { affinity: number; tags: number; text: number; recency: number } }>;
  createdAt: string;
}
