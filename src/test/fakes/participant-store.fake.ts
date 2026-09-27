import type {
  GoalTrackingRecord,
  HomeworkTrackingRecord,
  LongitudinalMemory,
  MemoryCandidate,
  MemoryConsentEvent,
  MemoryRetrievalResult,
  MemoryReviewDecision,
  MemoryUsageLog,
  RuntimeParticipant,
  RuntimeSessionSummary,
} from "@/types/longitudinal-memory";
import type { ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import type { MemoryChunk, MemoryChunkRetrieval } from "@/types/memory-chunks";
import { fakeIsSupersededAttempt } from "@/test/fakes/runtime-session-store.fake";

// Minimal in-memory stand-in for src/shared/data/server/participant-store.ts, used
// only so offline tests that touch the participant roster (e.g. session
// creation resolving/creating a demo participant) don't fail on a relative
// fetch() URL. Not a full behavioral mirror -- just enough CRUD to keep the
// runtime pipeline's participant lookups working. The longitudinal-memory
// pipeline ops (sql/023) are mirrored the same way, including the ordering
// the real store applies, so the memory tests can run end to end offline.

const participants = new Map<string, RuntimeParticipant>();
const memories = new Map<string, LongitudinalMemory>();
const summaries = new Map<string, RuntimeSessionSummary>();
const candidates = new Map<string, MemoryCandidate>();
const reviewDecisions = new Map<string, MemoryReviewDecision>();
const retrievalRuns = new Map<string, MemoryRetrievalResult>();
const usageLogs = new Map<string, MemoryUsageLog>();
const goalRecords = new Map<string, GoalTrackingRecord>();
const homeworkRecords = new Map<string, HomeworkTrackingRecord>();
const consentEvents: MemoryConsentEvent[] = [];
const memoryChunks = new Map<string, MemoryChunk>();
const chunkRetrievals: MemoryChunkRetrieval[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function sortedBy<T>(items: T[], key: (item: T) => string, direction: "asc" | "desc" = "asc") {
  const sorted = [...items].sort((left, right) => key(left).localeCompare(key(right)));
  return (direction === "asc" ? sorted : sorted.reverse()).map(clone);
}

export function resetFakeParticipantStore() {
  participants.clear();
  memories.clear();
  summaries.clear();
  candidates.clear();
  reviewDecisions.clear();
  retrievalRuns.clear();
  usageLogs.clear();
  goalRecords.clear();
  homeworkRecords.clear();
  consentEvents.length = 0;
  memoryChunks.clear();
  chunkRetrievals.length = 0;
}

export async function dispatchFakeParticipantStoreOp(op: ParticipantStoreOp): Promise<unknown> {
  switch (op.op) {
    case "listParticipants": return [...participants.values()].map(clone);
    case "getParticipant": return participants.has(op.participantId) ? clone(participants.get(op.participantId)) : undefined;
    case "getParticipantByAuthUserId": {
      const match = [...participants.values()].find((participant) => participant.authUserId === op.authUserId);
      return match ? clone(match) : undefined;
    }
    case "saveParticipant": {
      // Like the real store: an existing row keeps its memoryConsent.
      const existing = participants.get(op.participant.id);
      const { memoryConsent: _given, ...rest } = op.participant;
      const next = existing ? { ...rest, ...(existing.memoryConsent ? { memoryConsent: existing.memoryConsent } : {}) } : op.participant;
      participants.set(op.participant.id, clone(next));
      return next;
    }
    case "updateParticipant": {
      const current = participants.get(op.participantId);
      if (!current) throw new Error("Participant not found");
      const { memoryConsent: _ignored, ...patch } = op.patch;
      const next = { ...current, ...patch };
      participants.set(op.participantId, clone(next));
      return next;
    }
    case "recordMemoryConsent": {
      const current = participants.get(op.participantId);
      if (!current) throw new Error("Participant not found");
      const now = new Date().toISOString();
      consentEvents.push({ id: `CONS-${consentEvents.length + 1}`, participantId: op.participantId, consentKind: "memory", decision: op.decision, textVersion: op.textVersion, source: op.source, locale: op.locale, decidedAt: now, actorUserId: op.actor?.actorUserId, actorRole: op.actor?.actorRole ?? "server", previousDecision: current.memoryConsent?.decision });
      const next = { ...current, memoryConsent: { decision: op.decision, textVersion: op.textVersion, source: op.source, decidedAt: now }, consent: { ...current.consent, crossSessionUseAllowed: op.decision === "granted", updatedAt: now }, updatedAt: now };
      participants.set(op.participantId, clone(next));
      return clone(next);
    }
    case "listMemoryConsentEvents": return consentEvents.filter((event) => event.participantId === op.participantId).map(clone);
    case "saveMemoryChunks": {
      let inserted = 0;
      for (const chunk of op.chunks) {
        if (memoryChunks.has(chunk.id)) continue;
        memoryChunks.set(chunk.id, clone({ ...chunk, suppressed: false }));
        inserted += 1;
      }
      return inserted;
    }
    case "listMemoryChunks":
      return [...memoryChunks.values()]
        .filter((chunk) => chunk.participantId === op.participantId && (op.beforeSessionIndex === undefined || chunk.sessionIndex < op.beforeSessionIndex) && (op.includeSuppressed || !chunk.suppressed))
        .filter((chunk) => !op.officialAttemptsOnly || chunk.chunkKind === "homework" || chunk.chunkKind === "clinician_note" || !fakeIsSupersededAttempt(chunk.runtimeSessionId))
        .sort((left, right) => left.sessionIndex - right.sessionIndex || left.sourceCreatedAt.localeCompare(right.sourceCreatedAt) || left.id.localeCompare(right.id))
        .map(clone);
    case "listMemoryChunksBySession":
      return [...memoryChunks.values()].filter((chunk) => chunk.runtimeSessionId === op.runtimeSessionId).sort((left, right) => left.sourceCreatedAt.localeCompare(right.sourceCreatedAt) || left.id.localeCompare(right.id)).map(clone);
    case "saveMemoryChunkRetrieval":
      if (!chunkRetrievals.some((item) => item.id === op.retrieval.id)) chunkRetrievals.push(clone(op.retrieval));
      return op.retrieval;
    case "listMemoryChunkRetrievals":
      return chunkRetrievals.filter((item) => item.runtimeSessionId === op.runtimeSessionId).map(clone);
    case "listUntaggedMemoryChunks":
      return [...memoryChunks.values()].filter((chunk) => chunk.participantId === op.participantId && !chunk.taggedAt && !chunk.suppressed).sort((left, right) => left.sessionIndex - right.sessionIndex || left.sourceCreatedAt.localeCompare(right.sourceCreatedAt) || left.id.localeCompare(right.id)).map(clone);
    case "setMemoryChunkTags": {
      const chunk = memoryChunks.get(op.chunkId);
      if (!chunk || chunk.taggedAt) return false;
      memoryChunks.set(op.chunkId, clone({ ...chunk, tags: op.tags, taggedAt: new Date().toISOString(), tagModel: op.tagModel, tagPromptVersion: op.tagPromptVersion }));
      return true;
    }
    case "suppressMemoryChunk": {
      const chunk = memoryChunks.get(op.chunkId);
      if (!chunk) throw new Error("Memory chunk not found");
      if (!op.reason?.trim()) throw new Error("A reason is required to suppress a memory chunk");
      const next = { ...chunk, suppressed: true, suppressedAt: new Date().toISOString(), suppressedBy: op.actorUserId, suppressedReason: op.reason.trim() };
      memoryChunks.set(op.chunkId, clone(next));
      return clone(next);
    }
    case "listMemories": return [...memories.values()].filter((memory) => memory.participantId === op.participantId).map(clone);
    case "getMemory": return memories.has(op.memoryId) ? clone(memories.get(op.memoryId)) : undefined;
    case "saveMemory": memories.set(op.memory.id, clone(op.memory)); return op.memory;
    case "updateMemory": {
      const current = memories.get(op.memoryId);
      if (!current) throw new Error("Memory not found");
      const next = { ...current, ...op.patch };
      memories.set(op.memoryId, clone(next));
      return next;
    }
    case "listExpiredApprovedMemories": {
      const now = Date.now();
      return [...memories.values()].filter((memory) => memory.status === "approved" && memory.validUntil && new Date(memory.validUntil).getTime() < now).map(clone);
    }
    case "getSessionSummaryBySession": {
      const match = sortedBy([...summaries.values()].filter((summary) => summary.runtimeSessionId === op.runtimeSessionId), (summary) => summary.createdAt)[0];
      return match;
    }
    case "getSessionSummary": return summaries.has(op.summaryId) ? clone(summaries.get(op.summaryId)) : undefined;
    case "saveSessionSummary": summaries.set(op.summary.id, clone(op.summary)); return op.summary;
    case "updateSessionSummary": {
      const current = summaries.get(op.summaryId);
      if (!current) throw new Error("Session summary not found");
      const next = { ...current, ...op.patch, updatedAt: new Date().toISOString() };
      summaries.set(op.summaryId, clone(next));
      return next;
    }
    case "listMemoryCandidates":
      return op.participantId
        ? sortedBy([...candidates.values()].filter((candidate) => candidate.participantId === op.participantId), (candidate) => candidate.updatedAt)
        : sortedBy([...candidates.values()], (candidate) => candidate.updatedAt, "desc");
    case "getMemoryCandidate": return candidates.has(op.candidateId) ? clone(candidates.get(op.candidateId)) : undefined;
    case "saveMemoryCandidate": candidates.set(op.candidate.id, clone(op.candidate)); return op.candidate;
    case "updateMemoryCandidate": {
      const current = candidates.get(op.candidateId);
      if (!current) throw new Error("Memory candidate not found");
      const next = { ...current, ...op.patch, updatedAt: new Date().toISOString() };
      candidates.set(op.candidateId, clone(next));
      return next;
    }
    case "deleteMemoryCandidate": candidates.delete(op.candidateId); return undefined;
    case "saveMemoryReviewDecision": reviewDecisions.set(op.decision.id, clone(op.decision)); return op.decision;
    case "listMemoryReviewDecisions":
      return sortedBy([...reviewDecisions.values()].filter((decision) => decision.memoryId === op.memoryId), (decision) => decision.createdAt);
    case "saveMemoryRetrievalRun": retrievalRuns.set(op.run.id, clone(op.run)); return op.run;
    case "listMemoryRetrievalRuns":
      return sortedBy([...retrievalRuns.values()].filter((run) => run.runtimeSessionId === op.runtimeSessionId), (run) => run.createdAt);
    case "saveMemoryUsageLog": usageLogs.set(op.log.id, clone(op.log)); return op.log;
    case "listMemoryUsageLogs":
      return sortedBy([...usageLogs.values()].filter((log) => log.runtimeSessionId === op.runtimeSessionId), (log) => log.createdAt);
    case "listAllMemoryUsageLogs":
      return sortedBy([...usageLogs.values()].filter((log) => log.participantId === op.participantId), (log) => log.createdAt);
    case "listGoalTrackingRecords":
      return sortedBy([...goalRecords.values()].filter((record) => record.participantId === op.participantId), (record) => record.updatedAt);
    case "saveGoalTrackingRecord": goalRecords.set(op.record.id, clone(op.record)); return op.record;
    case "updateGoalTrackingRecord": {
      const current = goalRecords.get(op.recordId);
      if (!current) throw new Error("Goal tracking record not found");
      const next = { ...current, ...op.patch, updatedAt: new Date().toISOString() };
      goalRecords.set(op.recordId, clone(next));
      return next;
    }
    case "listHomeworkTrackingRecords":
      return sortedBy([...homeworkRecords.values()].filter((record) => record.participantId === op.participantId), (record) => record.assignedAt);
    case "saveHomeworkTrackingRecord": homeworkRecords.set(op.record.id, clone(op.record)); return op.record;
    case "updateHomeworkTrackingRecord": {
      const current = homeworkRecords.get(op.recordId);
      if (!current) throw new Error("Homework tracking record not found");
      const next = { ...current, ...op.patch };
      homeworkRecords.set(op.recordId, clone(next));
      return next;
    }
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown participant store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
