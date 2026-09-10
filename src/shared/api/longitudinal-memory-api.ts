import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { makeId } from "@/shared/id";
import { createMemoryAuditEntry, defaultPolicyIdForType } from "@/shared/memory/memory-helpers";
import { retrieveSelectiveMemory } from "@/shared/memory/memory-retrieval-engine";
import {
  getLongitudinalMemory,
  getMemoryCandidate,
  listAllMemoryUsageLogs,
  listGoalTrackingRecords,
  listHomeworkTrackingRecords,
  listLongitudinalMemories,
  listMemoryCandidates,
  listMemoryRetrievalRuns,
  listMemoryUsageLogs,
  saveLongitudinalMemory,
  updateLongitudinalMemory,
} from "@/shared/data/repositories/longitudinal-memory-repository";
import { getParticipant } from "@/shared/data/repositories/participant-repository";
import type { LongitudinalMemory, MemoryRetrievalRequest } from "@/types/longitudinal-memory";

export async function getParticipantMemories(participantId: string) {
  return listLongitudinalMemories(participantId);
}

export async function getPendingMemoryCandidates(participantId?: string) {
  const candidates = await listMemoryCandidates(participantId);
  return candidates.filter((candidate) => ["candidate", "pending_review"].includes(candidate.status));
}

export async function approveMemoryCandidate(candidateId: string, approvedBy = "Clinician") {
  const candidate = await getMemoryCandidate(candidateId);
  if (!candidate) throw new Error("Memory candidate not found");
  const approved: LongitudinalMemory = {
    ...candidate,
    status: "approved",
    approvedBy,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveLongitudinalMemory(approved);
  await getLocalDb().memoryCandidates.delete(candidateId);
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Memory approved",
      resource: `Memory ${candidateId}`,
      version: "stage3",
      previousValue: JSON.stringify(candidate),
      newValue: JSON.stringify(approved),
      reason: "Approved for longitudinal use",
    }),
  );
  return approved;
}

export async function rejectMemoryCandidate(candidateId: string, reason: string) {
  const candidate = await getMemoryCandidate(candidateId);
  if (!candidate) throw new Error("Memory candidate not found");
  await getLocalDb().memoryCandidates.put({ ...candidate, status: "rejected", rejectionReason: reason, updatedAt: new Date().toISOString() });
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Memory rejected",
      resource: `Memory ${candidateId}`,
      version: "stage3",
      previousValue: JSON.stringify(candidate),
      newValue: JSON.stringify({ status: "rejected", reason }),
      reason,
    }),
  );
}

export async function supersedeMemory(memoryId: string, replacementMemoryId: string, reason: string) {
  const [current, replacement] = await Promise.all([getLongitudinalMemory(memoryId), getLongitudinalMemory(replacementMemoryId)]);
  if (!current || !replacement) throw new Error("Memory not found");
  await updateLongitudinalMemory(memoryId, { status: "superseded", supersededByMemoryId: replacementMemoryId });
  await updateLongitudinalMemory(replacementMemoryId, { supersedesMemoryId: memoryId });
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Memory superseded",
      resource: `Memory ${memoryId}`,
      version: "stage3",
      previousValue: JSON.stringify(current),
      newValue: JSON.stringify(replacement),
      reason,
    }),
  );
}

export async function expireEligibleMemories() {
  const all = await getLocalDb().longitudinalMemories.toArray();
  const now = Date.now();
  const expired = all.filter((memory) => memory.validUntil && new Date(memory.validUntil).getTime() < now && memory.status === "approved");
  for (const memory of expired) {
    await updateLongitudinalMemory(memory.id, { status: "expired" });
  }
  return expired.length;
}

export async function revokeMemory(memoryId: string, reason: string) {
  return updateLongitudinalMemory(memoryId, { status: "revoked", rejectionReason: reason });
}

export async function deleteMemory(memoryId: string, reason: string) {
  return updateLongitudinalMemory(memoryId, { status: "deleted", rejectionReason: reason });
}

export async function runMemoryRetrieval(request: MemoryRetrievalRequest) {
  const participant = await getParticipant(request.participantId);
  if (!participant) throw new Error("Participant not found");
  if (!participant.consent.crossSessionUseAllowed) throw new Error("Cross-session retrieval is disabled for this participant");
  return retrieveSelectiveMemory(request);
}

export async function getRuntimeMemoryRuns(runtimeSessionId: string) {
  return listMemoryRetrievalRuns(runtimeSessionId);
}

export async function getRuntimeMemoryUsage(runtimeSessionId: string) {
  return listMemoryUsageLogs(runtimeSessionId);
}

/** Clinician-only notes are modeled as "clinician_note" longitudinal memories — no separate notes table. */
export async function getClinicianNotes(participantId: string) {
  const memories = await listLongitudinalMemories(participantId);
  return memories
    .filter((memory) => memory.memoryType === "clinician_note" && memory.status !== "deleted")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** Soft-deletes a clinician note (status -> "deleted"). getClinicianNotes
 * already filters status !== "deleted", and the underlying memory row is
 * never removed, so this only ever hides the note from clinician views --
 * it stays in the audit trail below and in the store for later recovery
 * if that's ever needed. */
export async function deleteClinicianNote(memoryId: string, deletedBy = "Clinician"): Promise<LongitudinalMemory> {
  const existing = await getLongitudinalMemory(memoryId);
  if (!existing) throw new Error("Clinical note not found");
  const deleted = await updateLongitudinalMemory(memoryId, { status: "deleted" });
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Clinical note deleted",
      resource: `Participant ${existing.participantId}`,
      version: "stage3",
      previousValue: JSON.stringify(existing),
      newValue: JSON.stringify({ status: "deleted" }),
      reason: `Deleted by ${deletedBy} from Patient Monitoring`,
    }),
  );
  return deleted;
}

export async function addClinicianNote(input: {
  participantId: string;
  projectId: string;
  sourceSessionId: string;
  content: string;
  createdBy?: string;
}): Promise<LongitudinalMemory> {
  const now = new Date().toISOString();
  const note: LongitudinalMemory = {
    id: makeId("MEM"),
    participantId: input.participantId,
    projectId: input.projectId,
    memoryType: "clinician_note",
    title: "Clinical note",
    content: input.content,
    status: "approved",
    sensitivity: "standard",
    sourceType: "clinician_entry",
    sourceSessionId: input.sourceSessionId,
    sourceMessageIds: [],
    sourceNodeIds: [],
    sourceExecutionLogIds: [],
    isDirectlyReported: false,
    isSystemDerived: false,
    validFrom: now,
    retentionPolicyId: defaultPolicyIdForType("clinician_note"),
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? "Clinician",
  };
  await saveLongitudinalMemory(note);
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Clinical note added",
      resource: `Participant ${input.participantId}`,
      version: "stage3",
      previousValue: "",
      newValue: JSON.stringify(note),
      reason: "Clinician-entered note from Patient Monitoring",
    }),
  );
  return note;
}

export async function getParticipantLongitudinalDashboard(participantId: string) {
  const [participant, memories, homework, goals, usage] = await Promise.all([
    getParticipant(participantId),
    listLongitudinalMemories(participantId),
    listHomeworkTrackingRecords(participantId),
    listGoalTrackingRecords(participantId),
    listAllMemoryUsageLogs(participantId),
  ]);
  if (!participant) throw new Error("Participant not found");
  return { participant, memories, homework, goals, usage };
}
