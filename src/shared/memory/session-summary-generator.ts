import type { RuntimeSessionView } from "@/types/runtime-session";
import { makeId } from "@/shared/id";
import type { RuntimeSessionSummary } from "@/types/longitudinal-memory";

export function generateDeterministicSessionSummary(view: RuntimeSessionView): RuntimeSessionSummary {
  const now = new Date().toISOString();
  const patientMessages = view.messages.filter((message) => message.role === "patient");
  const assistantMessages = view.messages.filter((message) => message.role === "assistant");
  const homeworkAssigned = assistantMessages
    .filter((message) => message.actionType === "assign_homework")
    .map((message) => message.content);
  const activitiesCompleted = patientMessages
    .filter((message) => message.actionType === "start_activity")
    .map((message) => message.content);
  const homeworkOutcomes = patientMessages
    .filter((message) => message.actionType === "assign_homework")
    .map((message) => message.content);
  const barriers = patientMessages
    .map((message) => message.content)
    .filter((content) => /barrier|difficult|hard|struggle/i.test(content));
  const copingStrategies = patientMessages
    .map((message) => message.content)
    .filter((content) => /help|strategy|walk|breath|organize/i.test(content));
  const progressMarkers = patientMessages
    .map((message) => message.content)
    .filter((content) => /done|completed|commit|yes|finished/i.test(content));
  const safetyEvents = view.logs.filter((log) => log.stage === "safety_check" || log.stage === "escalation").map((log) => log.summary);
  return {
    id: makeId("SUM"),
    runtimeSessionId: view.session.id,
    participantId: view.session.participantId,
    protocolId: view.session.protocolId,
    protocolVersion: view.session.protocolVersion,
    sessionDefinitionId: view.session.sessionDefinitionId,
    sessionStatus: view.session.status,
    startedAt: view.session.startedAt,
    completedAt: view.session.completedAt,
    summaryStatus: "draft",
    goalsAddressed: view.session.runtimeContext.longitudinalMemory?.treatmentGoals ?? [],
    activitiesCompleted,
    homeworkAssigned,
    homeworkOutcomes,
    patientReportedBarriers: barriers,
    copingStrategies,
    progressMarkers,
    unresolvedItems: [...new Set([...homeworkAssigned.filter((item) => !homeworkOutcomes.includes(item)), ...barriers])],
    safetyEvents,
    nextSessionConsiderations: [...new Set([...(view.session.runtimeContext.longitudinalMemory?.activeHomework ?? []), ...barriers])],
    memoryCandidateIds: [],
    sourceMessageIds: patientMessages.map((message) => message.id),
    sourceExecutionLogIds: view.logs.map((log) => log.id),
    createdAt: now,
    updatedAt: now,
  };
}
