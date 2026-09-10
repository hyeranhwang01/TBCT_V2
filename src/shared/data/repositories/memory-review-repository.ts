import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import type { MemoryReviewDecision } from "@/types/longitudinal-memory";

export async function saveMemoryReviewDecision(decision: MemoryReviewDecision) {
  await getLocalDb().memoryReviewDecisions.put(decision);
  return decision;
}

export async function listMemoryReviewDecisions(memoryId: string) {
  return getLocalDb().memoryReviewDecisions.where("memoryId").equals(memoryId).sortBy("createdAt");
}
