import { defaultPolicyIdForType, defaultSensitivityForType } from "@/shared/memory/memory-helpers";
import { makeId } from "@/shared/id";
import type { MemoryCandidate, MemoryType, RuntimeSessionSummary } from "@/types/longitudinal-memory";

function candidateFrom(summary: RuntimeSessionSummary, memoryType: MemoryType, title: string, content: string, overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  const now = new Date().toISOString();
  return {
    id: makeId("MEM"),
    participantId: summary.participantId,
    projectId: summary.protocolId,
    memoryType,
    title,
    content,
    status: "candidate",
    sensitivity: defaultSensitivityForType(memoryType),
    sourceType: overrides.sourceType ?? "session_summary",
    sourceSessionId: summary.runtimeSessionId,
    sourceMessageIds: summary.sourceMessageIds,
    sourceNodeIds: [],
    sourceExecutionLogIds: summary.sourceExecutionLogIds,
    isDirectlyReported: overrides.isDirectlyReported ?? true,
    isSystemDerived: overrides.isSystemDerived ?? false,
    confidence: overrides.confidence,
    validFrom: now,
    validUntil: overrides.validUntil,
    retentionPolicyId: defaultPolicyIdForType(memoryType),
    createdAt: now,
    updatedAt: now,
    createdBy: "System",
    ...overrides,
  };
}

export function extractMemoryCandidatesFromSummary(summary: RuntimeSessionSummary) {
  const candidates: MemoryCandidate[] = [];
  summary.goalsAddressed.forEach((goal) => candidates.push(candidateFrom(summary, "treatment_goal", "Active treatment goal", goal)));
  summary.homeworkAssigned.forEach((item) =>
    candidates.push(candidateFrom(summary, "homework_assignment", "Assigned homework", item, { validUntil: undefined })),
  );
  summary.homeworkOutcomes.forEach((item) => candidates.push(candidateFrom(summary, "homework_outcome", "Homework outcome", item)));
  summary.activitiesCompleted.forEach((item) => candidates.push(candidateFrom(summary, "activity_history", "Completed activity", item)));
  summary.patientReportedBarriers.forEach((item) => candidates.push(candidateFrom(summary, "barrier", "Reported barrier", item)));
  summary.copingStrategies.forEach((item) => candidates.push(candidateFrom(summary, "coping_strategy", "Reported coping strategy", item)));
  summary.progressMarkers.forEach((item) => candidates.push(candidateFrom(summary, "progress_marker", "Progress marker", item)));
  summary.safetyEvents.forEach((item) =>
    candidates.push(candidateFrom(summary, "safety_relevant", "Safety relevant event", item, { isDirectlyReported: false, isSystemDerived: true })),
  );
  return candidates;
}
