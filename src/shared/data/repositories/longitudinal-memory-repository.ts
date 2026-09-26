import { PARTICIPANT_STORE_ENDPOINT, type ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import { getRetentionPolicy as getRetentionPolicyConstant, listRetentionPolicies as listRetentionPoliciesConstant } from "@/shared/memory/retention-policies";
import type { GoalTrackingRecord, HomeworkTrackingRecord, LongitudinalMemory, MemoryCandidate, MemoryRetrievalResult, MemoryUsageLog } from "@/types/longitudinal-memory";

// Every longitudinal-memory record now lives in Neon Postgres alongside the
// participant roster (src/shared/data/server/participant-store.ts): approved
// memories (incl. clinician notes), memory candidates, retrieval runs,
// usage logs and goal/homework tracking (sql/023_memory_pipeline.sql).
// Until 2026-09-13 only the approved memories had moved; the rest were
// browser IndexedDB (Dexie) tables -- and a patient turn runs on the
// server, where Dexie throws on first access, so candidates were never
// created, the clinician review screen (a different browser) could never
// see them, and retrieval logging failed on every turn. Every function
// keeps its original name/signature so call sites are unaffected.
// Retention policies are a code constant (src/shared/memory/retention-
// policies.ts), not stored data -- see that file for why.
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

export async function listLongitudinalMemories(participantId: string): Promise<LongitudinalMemory[]> {
  return callStore<LongitudinalMemory[]>({ op: "listMemories", participantId });
}

export async function getLongitudinalMemory(memoryId: string): Promise<LongitudinalMemory | undefined> {
  return callStore<LongitudinalMemory | undefined>({ op: "getMemory", memoryId });
}

export async function saveLongitudinalMemory(memory: LongitudinalMemory) {
  await callStore<LongitudinalMemory>({ op: "saveMemory", memory });
  return memory;
}

export async function updateLongitudinalMemory(memoryId: string, patch: Partial<LongitudinalMemory>) {
  return callStore<LongitudinalMemory>({ op: "updateMemory", memoryId, patch });
}

/** Approved memories whose validUntil has passed -- the input of
 * expireEligibleMemories (longitudinal-memory-api.ts). */
export async function listExpiredApprovedMemories(): Promise<LongitudinalMemory[]> {
  return callStore<LongitudinalMemory[]>({ op: "listExpiredApprovedMemories" });
}

export async function listMemoryCandidates(participantId?: string) {
  return callStore<MemoryCandidate[]>({ op: "listMemoryCandidates", participantId });
}

export async function getMemoryCandidate(candidateId: string) {
  return callStore<MemoryCandidate | undefined>({ op: "getMemoryCandidate", candidateId });
}

export async function saveMemoryCandidate(candidate: MemoryCandidate) {
  await callStore<MemoryCandidate>({ op: "saveMemoryCandidate", candidate });
  return candidate;
}

export async function updateMemoryCandidate(candidateId: string, patch: Partial<MemoryCandidate>) {
  return callStore<MemoryCandidate>({ op: "updateMemoryCandidate", candidateId, patch });
}

export async function deleteMemoryCandidate(candidateId: string) {
  await callStore<void>({ op: "deleteMemoryCandidate", candidateId });
}

export async function saveMemoryRetrievalRun(run: MemoryRetrievalResult) {
  await callStore<MemoryRetrievalResult>({ op: "saveMemoryRetrievalRun", run });
  return run;
}

export async function listMemoryRetrievalRuns(runtimeSessionId: string) {
  return callStore<MemoryRetrievalResult[]>({ op: "listMemoryRetrievalRuns", runtimeSessionId });
}

export async function saveMemoryUsageLog(log: MemoryUsageLog) {
  await callStore<MemoryUsageLog>({ op: "saveMemoryUsageLog", log });
  return log;
}

export async function listMemoryUsageLogs(runtimeSessionId: string) {
  return callStore<MemoryUsageLog[]>({ op: "listMemoryUsageLogs", runtimeSessionId });
}

export async function listAllMemoryUsageLogs(participantId: string) {
  return callStore<MemoryUsageLog[]>({ op: "listAllMemoryUsageLogs", participantId });
}

export async function listRetentionPolicies() {
  return listRetentionPoliciesConstant();
}

export async function getRetentionPolicy(policyId: string) {
  return getRetentionPolicyConstant(policyId);
}

export async function listGoalTrackingRecords(participantId: string) {
  return callStore<GoalTrackingRecord[]>({ op: "listGoalTrackingRecords", participantId });
}

export async function saveGoalTrackingRecord(record: GoalTrackingRecord) {
  await callStore<GoalTrackingRecord>({ op: "saveGoalTrackingRecord", record });
  return record;
}

export async function updateGoalTrackingRecord(recordId: string, patch: Partial<GoalTrackingRecord>) {
  return callStore<GoalTrackingRecord>({ op: "updateGoalTrackingRecord", recordId, patch });
}

export async function listHomeworkTrackingRecords(participantId: string) {
  return callStore<HomeworkTrackingRecord[]>({ op: "listHomeworkTrackingRecords", participantId });
}

export async function saveHomeworkTrackingRecord(record: HomeworkTrackingRecord) {
  await callStore<HomeworkTrackingRecord>({ op: "saveHomeworkTrackingRecord", record });
  return record;
}

export async function updateHomeworkTrackingRecord(recordId: string, patch: Partial<HomeworkTrackingRecord>) {
  return callStore<HomeworkTrackingRecord>({ op: "updateHomeworkTrackingRecord", recordId, patch });
}
