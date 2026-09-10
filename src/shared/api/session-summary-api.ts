import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { makeId } from "@/shared/id";
import { createMemoryAuditEntry } from "@/shared/memory/memory-helpers";
import { extractMemoryCandidatesFromSummary } from "@/shared/memory/memory-candidate-extractor";
import { generateDeterministicSessionSummary } from "@/shared/memory/session-summary-generator";
import { saveMemoryCandidate, saveGoalTrackingRecord, saveHomeworkTrackingRecord, updateMemoryCandidate } from "@/shared/data/repositories/longitudinal-memory-repository";
import { getSessionSummary, getSessionSummaryBySession, saveSessionSummary, updateSessionSummary } from "@/shared/data/repositories/session-summary-repository";
import { getRuntimeSession } from "@/shared/api/runtime-session-api";

export async function generateSessionSummary(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("Runtime session not found");
  const existing = await getSessionSummaryBySession(sessionId);
  if (existing) return existing;
  const summary = generateDeterministicSessionSummary(view);
  await saveSessionSummary(summary);
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Session summary generated",
      resource: `Runtime Session ${sessionId}`,
      version: view.session.protocolVersion,
      newValue: JSON.stringify(summary),
      reason: "Stage 3 session completion summary",
    }),
  );
  return summary;
}

export async function getRuntimeSessionSummary(sessionId: string) {
  return getSessionSummaryBySession(sessionId);
}

export async function updateRuntimeSessionSummary(summaryId: string, patch: Parameters<typeof updateSessionSummary>[1]) {
  return updateSessionSummary(summaryId, patch);
}

export async function submitSessionSummaryForReview(summaryId: string) {
  return updateSessionSummary(summaryId, { summaryStatus: "pending_review" });
}

export async function approveSessionSummary(summaryId: string, reviewedBy = "Clinician") {
  return updateSessionSummary(summaryId, { summaryStatus: "approved", reviewedBy, reviewedAt: new Date().toISOString() });
}

export async function rejectSessionSummary(summaryId: string, reason: string) {
  return updateSessionSummary(summaryId, { summaryStatus: "rejected", reviewedBy: "Clinician", reviewedAt: new Date().toISOString(), unresolvedItems: [reason] });
}

export async function extractMemoryCandidates(summaryId: string) {
  const summary = await getSessionSummary(summaryId);
  if (!summary) throw new Error("Session summary not found");
  const existingCandidates = extractMemoryCandidatesFromSummary(summary);
  for (const candidate of existingCandidates) {
    await saveMemoryCandidate(candidate);
  }
  await updateSessionSummary(summaryId, { memoryCandidateIds: existingCandidates.map((candidate) => candidate.id) });
  await Promise.all(
    summary.homeworkAssigned.map((title) =>
      saveHomeworkTrackingRecord({
        id: makeId("HW"),
        participantId: summary.participantId,
        assignedSessionId: summary.runtimeSessionId,
        sourceNodeId: summary.sessionDefinitionId,
        title: "Assigned homework",
        description: title,
        assignedAt: new Date().toISOString(),
        dueBeforeSessionDefinitionId: summary.sessionDefinitionId,
        status: "assigned",
      }),
    ),
  );
  await Promise.all(
    summary.goalsAddressed.map((goal) =>
      saveGoalTrackingRecord({
        id: makeId("GOAL"),
        participantId: summary.participantId,
        sourceSessionId: summary.runtimeSessionId,
        sourceNodeId: summary.sessionDefinitionId,
        title: goal,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ),
  );
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Memory candidates extracted",
      resource: `Session Summary ${summaryId}`,
      version: summary.protocolVersion,
      newValue: JSON.stringify(existingCandidates.map((candidate) => candidate.id)),
      reason: "Deterministic memory extraction",
    }),
  );
  return existingCandidates;
}

export async function updateRuntimeMemoryCandidate(candidateId: string, patch: Parameters<typeof updateMemoryCandidate>[1]) {
  return updateMemoryCandidate(candidateId, patch);
}
