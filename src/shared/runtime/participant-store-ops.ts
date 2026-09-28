// Shared client/server contract for the clinician-visible participant
// roster + longitudinal memory (clinician notes) store (Neon Postgres).
// Mirrors the pattern in safety-store-ops.ts: no server-only imports, so
// this is safe to import from both the browser-facing repository client
// (participant-repository.ts / longitudinal-memory-repository.ts) and the
// server-side store implementation (participant-store.ts).
import type {
  GoalTrackingRecord,
  HomeworkTrackingRecord,
  LongitudinalMemory,
  MemoryConsentDecision,
  MemoryConsentEvent,
  MemoryConsentSource,
  RuntimeParticipant,
  RuntimeSessionSummary,
} from "@/types/longitudinal-memory";
import type { MemoryChunk, MemoryChunkRetrieval, MemoryChunkTags } from "@/types/memory-chunks";

export type ParticipantStoreOp =
  | { op: "listParticipants" }
  | { op: "getParticipant"; participantId: string }
  | { op: "getParticipantByAuthUserId"; authUserId: string }
  | { op: "saveParticipant"; participant: RuntimeParticipant }
  | { op: "updateParticipant"; participantId: string; patch: Partial<RuntimeParticipant> }
  | { op: "listMemories"; participantId: string }
  | { op: "getMemory"; memoryId: string }
  | { op: "saveMemory"; memory: LongitudinalMemory }
  | { op: "updateMemory"; memoryId: string; patch: Partial<LongitudinalMemory> }
  // Memory consent (sql/025). The only way memoryConsent changes: appends the
  // event and updates the participant in one transaction. `actor` is filled
  // in by the store route from the authenticated caller.
  | {
      op: "recordMemoryConsent";
      participantId: string;
      decision: MemoryConsentDecision;
      textVersion: string;
      source: MemoryConsentSource;
      locale: string;
      actor?: Pick<MemoryConsentEvent, "actorUserId" | "actorRole">;
    }
  | { op: "listMemoryConsentEvents"; participantId: string }
  // Memory chunks (sql/027). Written and read by the server; clinicians read
  // and suppress. Never reachable by a patient caller (route.ts).
  | { op: "saveMemoryChunks"; chunks: MemoryChunk[] }
  | { op: "listMemoryChunks"; participantId: string; beforeSessionIndex?: number; includeSuppressed?: boolean; officialAttemptsOnly?: boolean }
  | { op: "listMemoryChunksBySession"; runtimeSessionId: string }
  | { op: "suppressMemoryChunk"; chunkId: string; reason: string; actorUserId?: string }
  | { op: "listUntaggedMemoryChunks"; participantId: string }
  | { op: "setMemoryChunkTags"; chunkId: string; tags: MemoryChunkTags; tagModel: string; tagPromptVersion: string }
  | { op: "saveMemoryChunkRetrieval"; retrieval: MemoryChunkRetrieval }
  | { op: "listMemoryChunkRetrievals"; runtimeSessionId: string }
  // Longitudinal-memory pipeline (sql/023_memory_pipeline.sql). These used
  // to be browser-only Dexie tables; a patient turn runs on the server, so
  // they had to move here for the pipeline to work at all -- see
  // .claude/TASK_SCOPE.json note2026_09_13_ari_memory_pipeline_plumbing.
  | { op: "listExpiredApprovedMemories" }
  | { op: "getSessionSummaryBySession"; runtimeSessionId: string }
  | { op: "getSessionSummary"; summaryId: string }
  | { op: "saveSessionSummary"; summary: RuntimeSessionSummary }
  | { op: "updateSessionSummary"; summaryId: string; patch: Partial<RuntimeSessionSummary> }
  | { op: "listGoalTrackingRecords"; participantId: string }
  | { op: "saveGoalTrackingRecord"; record: GoalTrackingRecord }
  | { op: "updateGoalTrackingRecord"; recordId: string; patch: Partial<GoalTrackingRecord> }
  | { op: "listHomeworkTrackingRecords"; participantId: string }
  | { op: "saveHomeworkTrackingRecord"; record: HomeworkTrackingRecord }
  | { op: "updateHomeworkTrackingRecord"; recordId: string; patch: Partial<HomeworkTrackingRecord> };

export const PARTICIPANT_STORE_ENDPOINT = "/api/participants/store";
