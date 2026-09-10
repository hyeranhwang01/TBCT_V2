import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import type { RuntimeSessionSummary } from "@/types/longitudinal-memory";

export async function getSessionSummaryBySession(runtimeSessionId: string) {
  return getLocalDb().runtimeSessionSummaries.where("runtimeSessionId").equals(runtimeSessionId).first();
}

export async function getSessionSummary(summaryId: string) {
  return getLocalDb().runtimeSessionSummaries.get(summaryId);
}

export async function saveSessionSummary(summary: RuntimeSessionSummary) {
  await getLocalDb().runtimeSessionSummaries.put(summary);
  return summary;
}

export async function updateSessionSummary(summaryId: string, patch: Partial<RuntimeSessionSummary>) {
  const db = getLocalDb();
  const current = await db.runtimeSessionSummaries.get(summaryId);
  if (!current) throw new Error("Session summary not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.runtimeSessionSummaries.put(next);
  return next;
}
