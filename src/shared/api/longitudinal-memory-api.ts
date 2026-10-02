import { makeId } from "@/shared/id";
import { defaultPolicyIdForType, recordMemoryAudit } from "@/shared/memory/memory-helpers";
import { clinicianNoteChunk, clinicianNoteChunkId } from "@/shared/memory/chunk-builder";
import { listMemoryChunks, saveMemoryChunks, suppressMemoryChunk } from "@/shared/data/repositories/memory-chunk-repository";
import { getParticipant } from "@/shared/data/repositories/participant-repository";
import {
  getLongitudinalMemory,
  listExpiredApprovedMemories,
  listGoalTrackingRecords,
  listHomeworkTrackingRecords,
  listLongitudinalMemories,
  saveLongitudinalMemory,
  updateLongitudinalMemory,
} from "@/shared/data/repositories/longitudinal-memory-repository";
import type { LongitudinalMemory } from "@/types/longitudinal-memory";

// No browser IndexedDB access here any more: every record this file touches lives in Neon
// (see longitudinal-memory-repository.ts), and the audit entries go through
// recordMemoryAudit, which never throws. Function names/signatures unchanged.

export async function getParticipantMemories(participantId: string) {
  return listLongitudinalMemories(participantId);
}

export async function supersedeMemory(memoryId: string, replacementMemoryId: string, reason: string) {
  const [current, replacement] = await Promise.all([getLongitudinalMemory(memoryId), getLongitudinalMemory(replacementMemoryId)]);
  if (!current || !replacement) throw new Error("Memory not found");
  await updateLongitudinalMemory(memoryId, { status: "superseded", supersededByMemoryId: replacementMemoryId });
  await updateLongitudinalMemory(replacementMemoryId, { supersedesMemoryId: memoryId });
  await recordMemoryAudit({
    action: "Memory superseded",
    resource: `Memory ${memoryId}`,
    version: "stage3",
    previousValue: JSON.stringify(current),
    newValue: JSON.stringify(replacement),
    reason,
  });
}

export async function expireEligibleMemories() {
  const expired = await listExpiredApprovedMemories();
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
  // Its chunk stays (append-only) but is kept out of retrieval.
  await suppressMemoryChunk(clinicianNoteChunkId(memoryId), `Clinical note deleted by ${deletedBy}`).catch(() => undefined);
  await recordMemoryAudit({
    action: "Clinical note deleted",
    resource: `Participant ${existing.participantId}`,
    version: "stage3",
    previousValue: JSON.stringify(existing),
    newValue: JSON.stringify({ status: "deleted" }),
    reason: `Deleted by ${deletedBy} from Patient Monitoring`,
  });
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
  // The note is also a memory chunk, so later sessions can draw on it
  // (memory-retrieval.ts) -- for participants who agreed to memory use.
  const chunk = clinicianNoteChunk(note);
  if (chunk) await saveMemoryChunks([chunk]);
  await recordMemoryAudit({
    action: "Clinical note added",
    resource: `Participant ${input.participantId}`,
    version: "stage3",
    previousValue: "",
    newValue: JSON.stringify(note),
    reason: "Clinician-entered note from Patient Monitoring",
  });
  return note;
}

export async function getParticipantLongitudinalDashboard(participantId: string) {
  const [participant, chunks, homework, goals] = await Promise.all([
    getParticipant(participantId),
    listMemoryChunks(participantId, { includeSuppressed: true, includeInvalid: true }),
    listHomeworkTrackingRecords(participantId),
    listGoalTrackingRecords(participantId),
  ]);
  if (!participant) throw new Error("Participant not found");
  return { participant, chunks, homework, goals };
}
