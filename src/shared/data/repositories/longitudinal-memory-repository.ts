import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { PARTICIPANT_STORE_ENDPOINT, type ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type { GoalTrackingRecord, HomeworkTrackingRecord, LongitudinalMemory, MemoryCandidate, MemoryRetrievalResult, MemoryUsageLog } from "@/types/longitudinal-memory";

// Longitudinal memories (including clinician_note entries, i.e. clinician
// notes added from Patient Monitoring) now live in Neon Postgres alongside
// the participant roster (src/shared/data/server/participant-store.ts) -- so a note
// added by a clinician is visible from any browser/session, not just the
// one it was written in. Memory candidates, goal/homework tracking, and
// usage logs are not yet part of this migration and remain local-only.
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

export async function listMemoryCandidates(participantId?: string) {
  const table = getLocalDb().memoryCandidates;
  return participantId
    ? table.where("participantId").equals(participantId).sortBy("updatedAt")
    : table.orderBy("updatedAt").reverse().toArray();
}

export async function getMemoryCandidate(candidateId: string) {
  return getLocalDb().memoryCandidates.get(candidateId);
}

export async function saveMemoryCandidate(candidate: MemoryCandidate) {
  await getLocalDb().memoryCandidates.put(candidate);
  return candidate;
}

export async function updateMemoryCandidate(candidateId: string, patch: Partial<MemoryCandidate>) {
  const db = getLocalDb();
  const current = await db.memoryCandidates.get(candidateId);
  if (!current) throw new Error("Memory candidate not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.memoryCandidates.put(next);
  return next;
}

export async function saveMemoryRetrievalRun(run: MemoryRetrievalResult) {
  await getLocalDb().memoryRetrievalRuns.put(run);
  return run;
}

export async function listMemoryRetrievalRuns(runtimeSessionId: string) {
  return getLocalDb().memoryRetrievalRuns.where("runtimeSessionId").equals(runtimeSessionId).sortBy("createdAt");
}

export async function saveMemoryUsageLog(log: MemoryUsageLog) {
  await getLocalDb().memoryUsageLogs.put(log);
  return log;
}

export async function listMemoryUsageLogs(runtimeSessionId: string) {
  return getLocalDb().memoryUsageLogs.where("runtimeSessionId").equals(runtimeSessionId).sortBy("createdAt");
}

export async function listAllMemoryUsageLogs(participantId: string) {
  return getLocalDb().memoryUsageLogs.where("participantId").equals(participantId).sortBy("createdAt");
}

export async function listRetentionPolicies() {
  return getLocalDb().memoryRetentionPolicies.toArray();
}

export async function getRetentionPolicy(policyId: string) {
  return getLocalDb().memoryRetentionPolicies.get(policyId);
}

export async function listGoalTrackingRecords(participantId: string) {
  return getLocalDb().goalTrackingRecords.where("participantId").equals(participantId).sortBy("updatedAt");
}

export async function saveGoalTrackingRecord(record: GoalTrackingRecord) {
  await getLocalDb().goalTrackingRecords.put(record);
  return record;
}

export async function updateGoalTrackingRecord(recordId: string, patch: Partial<GoalTrackingRecord>) {
  const db = getLocalDb();
  const current = await db.goalTrackingRecords.get(recordId);
  if (!current) throw new Error("Goal tracking record not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.goalTrackingRecords.put(next);
  return next;
}

export async function listHomeworkTrackingRecords(participantId: string) {
  return getLocalDb().homeworkTrackingRecords.where("participantId").equals(participantId).sortBy("assignedAt");
}

export async function saveHomeworkTrackingRecord(record: HomeworkTrackingRecord) {
  await getLocalDb().homeworkTrackingRecords.put(record);
  return record;
}

export async function updateHomeworkTrackingRecord(recordId: string, patch: Partial<HomeworkTrackingRecord>) {
  const db = getLocalDb();
  const current = await db.homeworkTrackingRecords.get(recordId);
  if (!current) throw new Error("Homework tracking record not found");
  const next = { ...current, ...patch };
  await db.homeworkTrackingRecords.put(next);
  return next;
}
