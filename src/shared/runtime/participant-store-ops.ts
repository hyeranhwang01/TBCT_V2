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
  MemoryCandidate,
  MemoryRetrievalResult,
  MemoryReviewDecision,
  MemoryUsageLog,
  RuntimeParticipant,
  RuntimeSessionSummary,
} from "@/types/longitudinal-memory";

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
  // Longitudinal-memory pipeline (sql/023_memory_pipeline.sql). These used
  // to be browser-only Dexie tables; a patient turn runs on the server, so
  // they had to move here for the pipeline to work at all -- see
  // .claude/TASK_SCOPE.json note2026_09_13_ari_memory_pipeline_plumbing.
  | { op: "listExpiredApprovedMemories" }
  | { op: "getSessionSummaryBySession"; runtimeSessionId: string }
  | { op: "getSessionSummary"; summaryId: string }
  | { op: "saveSessionSummary"; summary: RuntimeSessionSummary }
  | { op: "updateSessionSummary"; summaryId: string; patch: Partial<RuntimeSessionSummary> }
  | { op: "listMemoryCandidates"; participantId?: string }
  | { op: "getMemoryCandidate"; candidateId: string }
  | { op: "saveMemoryCandidate"; candidate: MemoryCandidate }
  | { op: "updateMemoryCandidate"; candidateId: string; patch: Partial<MemoryCandidate> }
  | { op: "deleteMemoryCandidate"; candidateId: string }
  | { op: "saveMemoryReviewDecision"; decision: MemoryReviewDecision }
  | { op: "listMemoryReviewDecisions"; memoryId: string }
  | { op: "saveMemoryRetrievalRun"; run: MemoryRetrievalResult }
  | { op: "listMemoryRetrievalRuns"; runtimeSessionId: string }
  | { op: "saveMemoryUsageLog"; log: MemoryUsageLog }
  | { op: "listMemoryUsageLogs"; runtimeSessionId: string }
  | { op: "listAllMemoryUsageLogs"; participantId: string }
  | { op: "listGoalTrackingRecords"; participantId: string }
  | { op: "saveGoalTrackingRecord"; record: GoalTrackingRecord }
  | { op: "updateGoalTrackingRecord"; recordId: string; patch: Partial<GoalTrackingRecord> }
  | { op: "listHomeworkTrackingRecords"; participantId: string }
  | { op: "saveHomeworkTrackingRecord"; record: HomeworkTrackingRecord }
  | { op: "updateHomeworkTrackingRecord"; recordId: string; patch: Partial<HomeworkTrackingRecord> };

export const PARTICIPANT_STORE_ENDPOINT = "/api/participants/store";
