import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { approveMemoryCandidate, rejectMemoryCandidate } from "@/shared/api/longitudinal-memory-api";
import { saveMemoryReviewDecision } from "@/shared/data/repositories/memory-review-repository";
import { getPendingMemoryCandidates } from "@/shared/api/longitudinal-memory-api";
import { makeId } from "@/shared/id";
import type { MemoryReviewDecision } from "@/types/longitudinal-memory";

export async function getMemoryReviewQueue() {
  return getPendingMemoryCandidates();
}

export async function approveMemoryCandidateWithReview(candidateId: string, reason: string) {
  const approved = await approveMemoryCandidate(candidateId);
  const decision: MemoryReviewDecision = {
    id: makeId("MRD"),
    memoryId: approved.id,
    participantId: approved.participantId,
    action: "approve",
    reason,
    previousValue: "",
    newValue: approved.content,
    createdAt: new Date().toISOString(),
    createdBy: "Clinician",
  };
  await saveMemoryReviewDecision(decision);
  return approved;
}

export async function rejectMemoryCandidateWithReview(candidateId: string, reason: string) {
  await rejectMemoryCandidate(candidateId, reason);
  const candidate = await getLocalDb().memoryCandidates.get(candidateId);
  const decision: MemoryReviewDecision = {
    id: makeId("MRD"),
    memoryId: candidateId,
    participantId: candidate?.participantId ?? "unknown",
    action: "reject",
    reason,
    previousValue: candidate?.content ?? "",
    newValue: "",
    createdAt: new Date().toISOString(),
    createdBy: "Clinician",
  };
  await saveMemoryReviewDecision(decision);
}
