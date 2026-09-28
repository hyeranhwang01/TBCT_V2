import { makeId } from "@/shared/id";
import { recordMemoryAudit } from "@/shared/memory/memory-helpers";
import { generateDeterministicSessionSummary } from "@/shared/memory/session-summary-generator";
import { saveGoalTrackingRecord, saveHomeworkTrackingRecord } from "@/shared/data/repositories/longitudinal-memory-repository";
import { getSessionSummary, getSessionSummaryBySession, saveSessionSummary, updateSessionSummary } from "@/shared/data/repositories/session-summary-repository";
import { getRuntimeSession } from "@/shared/api/runtime-session-api";

// Runs on the server at session completion (runtime-execution-api.ts
// completeRuntimeSession) as well as from the clinician's browser -- every
// store it touches is Neon-backed and the audit entry never throws.

export async function generateSessionSummary(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("Runtime session not found");
  const existing = await getSessionSummaryBySession(sessionId);
  if (existing) return existing;
  const summary = generateDeterministicSessionSummary(view);
  await saveSessionSummary(summary);
  await recordMemoryAudit({
    action: "Session summary generated",
    resource: `Runtime Session ${sessionId}`,
    version: view.session.protocolVersion,
    newValue: JSON.stringify(summary),
    reason: "Stage 3 session completion summary",
  });
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

/** Homework and goal tracking from a session summary. This used to also
 * extract memory candidates for clinician review; that step is gone --
 * cross-session memory is the participant's own words, chunked at
 * completion and used with their consent (memory-indexer.ts,
 * note2026_09_27_memory_rag_m3_m7). */
export async function recordSummaryTracking(summaryId: string) {
  const summary = await getSessionSummary(summaryId);
  if (!summary) throw new Error("Session summary not found");
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
}
