import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { getCurrentDemoActor } from "@/shared/demo-actor";
import { findActiveTriggerSuppression, getClinicianHandoff, getInterventionRecord, getPendingResumeRequest, listClinicianHandoffs, listFollowUpTasks, listInterventionRecords, listNotifications, listResumeRequests, listSafetyEvents, listSafetyReports, listSafetyTransitions, listSafetyTriageRecords, listPendingClinicianHandoffs, saveClinicianHandoff, saveFollowUpTask, saveInterventionRecord, saveNotification, saveResumeRequest, saveSafetyEvent, saveSafetyReport, saveSafetyTransition, saveSafetyTriageRecord, saveTriggerSuppression, updateClinician, updateClinicianHandoff, updateFollowUpTask, updateInterventionRecord, updateNotification, updateResumeRequest, updateSafetyEvent, updateTriggerSuppression, getSafetyEvent, listClinicians, getClinician, getSafetyReport } from "@/shared/data/repositories/safety-event-repository";
// The clinician safety-monitoring domain (events, transitions, triage,
// interventions, follow-ups, clinicians, notifications, reports, handoffs,
// resume requests, trigger suppressions) is migrated to Neon Postgres --
// see sql/003_safety_monitoring.sql. safety-event-repository.ts above is now
// a thin fetch client over src/app/api/safety/store/route.ts, so every
// function below is unchanged and unaffected by the storage backend swap.
import { getLongitudinalMemory } from "@/shared/data/repositories/longitudinal-memory-repository";
import { createMemoryAuditEntry } from "@/shared/memory/memory-helpers";
import { makeId } from "@/shared/id";
import { assertSafetyPermission } from "@/shared/safety-operations/safety-permissions";
import { assertSafetyTransition } from "@/shared/safety-operations/safety-event-transitions";
import { getRuntimeSession } from "@/shared/api/runtime-session-api";
import type { ClinicianHandoffRecord, HumanInterventionRecord, RuntimeClinician, SafetyEvent, SafetyEventStatus, SafetyFollowUpTask, SafetyReport, SafetyTriageRecord, SessionResumeRequest } from "@/types/safety-operations";

function actorId() {
  return getCurrentDemoActor().id;
}

async function currentClinician() {
  return getClinician(actorId());
}

function stableSafetyHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `fp-${(hash >>> 0).toString(16)}`;
}

function createSuppressionFingerprint(input: {
  runtimeSessionId: string;
  sourceNodeId?: string;
  safetyRuleId?: string;
  text: string;
}) {
  const normalized = input.text.trim().toLowerCase().replace(/\s+/g, " ");
  return stableSafetyHash([
    "text",
    normalized.length > 120 ? stableSafetyHash(normalized) : normalized,
    input.runtimeSessionId,
    input.sourceNodeId ?? "unknown-node",
    input.safetyRuleId ?? "no-rule",
  ].join("::"));
}

async function requirePermission(action: Parameters<typeof assertSafetyPermission>[0]["action"], input: { resourceType: string; resourceId?: string; participantId?: string; runtimeSessionId?: string; clinicianId?: string }) {
  const clinician = await getClinician(input.clinicianId ?? actorId());
  await assertSafetyPermission({
    clinician,
    action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    participantId: input.participantId,
    runtimeSessionId: input.runtimeSessionId,
  });
  return clinician;
}

async function audit(action: string, resource: string, previousValue: string, newValue: string, reason: string) {
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({ action, resource, version: "stage4", previousValue, newValue, reason }),
  );
}

async function transition(eventId: string, previousStatus: SafetyEventStatus | undefined, nextStatus: SafetyEventStatus, reason: string) {
  await saveSafetyTransition({
    id: makeId("ST"),
    safetyEventId: eventId,
    actorId: actorId(),
    actorRole: ((await currentClinician())?.role ?? "system") as RuntimeClinician["role"] | "system",
    previousStatus,
    nextStatus,
    reason,
    createdAt: new Date().toISOString(),
  });
}

export async function getSafetyEvents() {
  return listSafetyEvents();
}

export async function patchSafetyEvent(eventId: string, patch: Partial<SafetyEvent>, reason = "Safety event patched") {
  const current = await getSafetyEvent(eventId);
  if (!current) throw new Error("Safety event not found");
  const next = await updateSafetyEvent(eventId, patch);
  await audit("Safety event updated", `SafetyEvent ${eventId}`, JSON.stringify(current), JSON.stringify(next), reason);
  return next;
}

export async function findOpenSafetyEventByTriggerKey(input: {
  runtimeSessionId: string;
  sourceNodeId?: string;
  safetyRuleId?: string;
  executionSequence?: number;
}) {
  const events = await listSafetyEvents();
  return (
    events.find(
      (event) =>
        event.runtimeSessionId === input.runtimeSessionId &&
        event.sourceNodeId === input.sourceNodeId &&
        (event.safetyRuleIds[0] ?? undefined) === input.safetyRuleId &&
        event.executionSequence === input.executionSequence &&
        !["resolved", "closed", "false_positive", "cancelled"].includes(event.status),
    ) ?? null
  );
}

export async function getSafetyEventDetail(eventId: string) {
  const event = await getSafetyEvent(eventId);
  if (!event) return null;
  const [triage, interventions, transitions, followUps, session, safetyMemories, handoffs, resumeRequests, reports] = await Promise.all([
    listSafetyTriageRecords(eventId),
    listInterventionRecords(eventId),
    listSafetyTransitions(eventId),
    listFollowUpTasks(),
    getRuntimeSession(event.runtimeSessionId),
    Promise.all(event.linkedSafetyMemoryIds.map((id) => getLongitudinalMemory(id))),
    listClinicianHandoffs(eventId),
    listResumeRequests(eventId),
    listSafetyReports(),
  ]);
  return {
    event,
    triage,
    interventions,
    transitions,
    followUps: followUps.filter((item) => item.safetyEventId === eventId),
    session,
    safetyMemories: safetyMemories.filter(Boolean),
    handoffs,
    resumeRequests,
    reports: reports.filter((item) => item.safetyEventId === eventId),
  };
}

export async function createSafetyEvent(input: Omit<SafetyEvent, "id" | "createdAt" | "updatedAt" | "status"> & { status?: SafetyEventStatus }) {
  const now = new Date().toISOString();
  const event: SafetyEvent = { ...input, id: makeId("SE"), status: input.status ?? "queued", createdAt: now, updatedAt: now };
  await saveSafetyEvent(event);
  await transition(event.id, undefined, event.status, "Safety event created");
  await saveNotification({
    id: makeId("SN"),
    type: event.urgency === "immediate" ? "new_immediate_event" : "urgent_unacknowledged",
    title: `Safety event ${event.severity}`,
    body: event.triggerSummary,
    linkedEventId: event.id,
    linkedSessionId: event.runtimeSessionId,
    createdAt: now,
  });
  await audit("Safety event created", `SafetyEvent ${event.id}`, "", JSON.stringify(event), event.triggerSummary);
  return event;
}

export async function acknowledgeSafetyEvent(eventId: string, clinicianId = actorId()) {
  await requirePermission("event_acknowledge", { clinicianId, resourceType: "SafetyEvent", resourceId: eventId });
  const event = await getSafetyEvent(eventId);
  if (!event) throw new Error("Safety event not found");
  if (event.status !== "queued") throw new Error("Event is already acknowledged or closed");
  assertSafetyTransition(event.status, "acknowledged");
  const next = await updateSafetyEvent(eventId, { status: "acknowledged", acknowledgedBy: clinicianId, acknowledgedAt: new Date().toISOString() });
  await transition(eventId, event.status, "acknowledged", "Event acknowledged");
  await audit("Safety event acknowledged", `SafetyEvent ${eventId}`, JSON.stringify(event), JSON.stringify(next), "Acknowledge");
  return next;
}

export async function createSafetyTriageRecord(input: Omit<SafetyTriageRecord, "id" | "createdAt">) {
  if (!input.recommendedActions.length || !input.rationale) throw new Error("Triage validation failed");
  const event = await getSafetyEvent(input.safetyEventId);
  if (!event) throw new Error("Safety event not found");
  const record: SafetyTriageRecord = { ...input, id: makeId("TRI"), createdAt: new Date().toISOString() };
  await saveSafetyTriageRecord(record);
  const nextStatus: SafetyEventStatus = input.selectedSeverity === "low" ? "monitoring" : "triaging";
  await updateSafetyEvent(input.safetyEventId, {
    severity: input.selectedSeverity,
    urgency: input.selectedUrgency,
    triagedBy: input.clinicianId,
    triagedAt: record.createdAt,
    sessionHoldRequired: input.sessionHoldRequired,
    status: nextStatus,
  });
  await transition(input.safetyEventId, event.status, nextStatus, input.rationale);
  await audit("Safety triage created", `SafetyEvent ${input.safetyEventId}`, JSON.stringify(event), JSON.stringify(record), input.rationale);
  return record;
}

export async function assignSafetyEvent(eventId: string, clinicianId: string, reason: string) {
  await requirePermission("event_assign", { resourceType: "SafetyEvent", resourceId: eventId });
  const event = await getSafetyEvent(eventId);
  if (!event) throw new Error("Safety event not found");
  const clinician = await getClinician(clinicianId);
  if (!clinician?.available) throw new Error("Clinician unavailable");
  const next = await updateSafetyEvent(eventId, { assignedClinicianId: clinicianId, status: "assigned" });
  await updateClinician(clinicianId, { assignedSafetyEventIds: [...new Set([...(clinician.assignedSafetyEventIds ?? []), eventId])] });
  await transition(eventId, event.status, "assigned", reason);
  await saveNotification({ id: makeId("SN"), clinicianId, type: "assignment_received", title: "Safety event assigned", body: reason, linkedEventId: eventId, linkedSessionId: event.runtimeSessionId, createdAt: new Date().toISOString() });
  await audit("Safety event assigned", `SafetyEvent ${eventId}`, JSON.stringify(event), JSON.stringify(next), reason);
  return next;
}

export async function createHumanIntervention(input: Omit<HumanInterventionRecord, "id" | "createdAt" | "updatedAt" | "status"> & { status?: HumanInterventionRecord["status"] }) {
  await requirePermission("intervention_create", { clinicianId: input.clinicianId, resourceType: "SafetyEvent", resourceId: input.safetyEventId, participantId: input.participantId, runtimeSessionId: input.runtimeSessionId });
  const record: HumanInterventionRecord = { ...input, id: makeId("INT"), status: input.status ?? "planned", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await saveInterventionRecord(record);
  const event = await getSafetyEvent(input.safetyEventId);
  if (!event) throw new Error("Safety event not found");
  const next = await updateSafetyEvent(input.safetyEventId, { status: "intervention_required" });
  await transition(input.safetyEventId, event.status, "intervention_required", "Intervention created");
  await audit("Intervention created", `SafetyEvent ${input.safetyEventId}`, JSON.stringify(event), JSON.stringify(record), input.internalNote);
  if (input.channel !== "in_app") {
    await saveNotification({
      id: makeId("SN"),
      clinicianId: input.clinicianId,
      type: "assignment_received",
      title: "Demo Placeholder - no real-world contact is performed",
      body: `${input.channel} intervention created`,
      linkedEventId: input.safetyEventId,
      linkedSessionId: input.runtimeSessionId,
      createdAt: new Date().toISOString(),
    });
  }
  return record;
}

export async function startHumanIntervention(interventionId: string) {
  await requirePermission("intervention_start", { resourceType: "Intervention", resourceId: interventionId });
  const current = await getInterventionRecord(interventionId);
  if (!current) throw new Error("Intervention not found");
  if (current.status !== "planned") throw new Error("Invalid intervention transition");
  return updateInterventionRecord(interventionId, { status: "in_progress", startedAt: new Date().toISOString() });
}

export async function completeHumanIntervention(interventionId: string, input: { outcomeCode: string; outcomeSummary: string; nextAction?: string }) {
  await requirePermission("intervention_complete", { resourceType: "Intervention", resourceId: interventionId });
  if (!input.outcomeCode && !input.outcomeSummary) throw new Error("Intervention completion requires outcome");
  const current = await getInterventionRecord(interventionId);
  if (!current) throw new Error("Intervention not found");
  if (!["planned", "in_progress"].includes(current.status)) throw new Error("Invalid intervention transition");
  const updated = await updateInterventionRecord(interventionId, { status: "completed", completedAt: new Date().toISOString(), ...input });
  await audit("Intervention completed", `Intervention ${interventionId}`, JSON.stringify(current), JSON.stringify(updated), input.outcomeSummary);
  return updated;
}

export async function cancelHumanIntervention(interventionId: string, reason: string) {
  await requirePermission("intervention_cancel", { resourceType: "Intervention", resourceId: interventionId });
  if (!reason) throw new Error("Cancellation reason is required");
  return updateInterventionRecord(interventionId, { status: "cancelled", nextAction: reason });
}

export async function failHumanIntervention(interventionId: string, reason: string) {
  await requirePermission("intervention_fail", { resourceType: "Intervention", resourceId: interventionId });
  if (!reason) throw new Error("Failure reason is required");
  return updateInterventionRecord(interventionId, { status: "failed", nextAction: reason });
}

export async function getHumanInterventions(eventId: string) {
  return listInterventionRecords(eventId);
}

export async function createSafetyFollowUp(input: Omit<SafetyFollowUpTask, "id" | "createdAt" | "updatedAt" | "status"> & { status?: SafetyFollowUpTask["status"] }) {
  await requirePermission("follow_up_create", { resourceType: "SafetyEvent", resourceId: input.safetyEventId, participantId: input.participantId, runtimeSessionId: input.runtimeSessionId });
  const task: SafetyFollowUpTask = { ...input, id: makeId("FUP"), status: input.status ?? "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await saveFollowUpTask(task);
  const event = await getSafetyEvent(input.safetyEventId);
  if (event) {
    await updateSafetyEvent(input.safetyEventId, { followUpRequired: true, followUpTaskIds: [...new Set([...event.followUpTaskIds, task.id])] });
  }
  return task;
}

export async function completeSafetyFollowUp(taskId: string, note: string) {
  await requirePermission("follow_up_complete", { resourceType: "FollowUp", resourceId: taskId });
  if (!note) throw new Error("Completion note is required");
  return updateFollowUpTask(taskId, { status: "completed", completionNote: note, completedAt: new Date().toISOString() });
}

export async function assignSafetyFollowUp(taskId: string, clinicianId: string) {
  await requirePermission("follow_up_assign", { resourceType: "FollowUp", resourceId: taskId, clinicianId });
  return updateFollowUpTask(taskId, { status: "assigned", assignedClinicianId: clinicianId });
}

export async function startSafetyFollowUp(taskId: string) {
  await requirePermission("follow_up_start", { resourceType: "FollowUp", resourceId: taskId });
  return updateFollowUpTask(taskId, { status: "in_progress" });
}

export async function reopenSafetyFollowUp(taskId: string, reason: string) {
  await requirePermission("follow_up_reopen", { resourceType: "FollowUp", resourceId: taskId });
  if (!reason) throw new Error("Reopen reason is required");
  return updateFollowUpTask(taskId, { status: "open", completionNote: reason, completedAt: undefined });
}

export async function cancelSafetyFollowUp(taskId: string, reason: string) {
  await requirePermission("follow_up_cancel", { resourceType: "FollowUp", resourceId: taskId });
  if (!reason) throw new Error("Cancellation reason is required");
  return updateFollowUpTask(taskId, { status: "cancelled", completionNote: reason });
}

export async function getSafetyFollowUps() {
  const now = Date.now();
  const tasks = await listFollowUpTasks();
  return tasks.map((task) =>
    task.status !== "completed" && task.dueAt && new Date(task.dueAt).getTime() < now ? { ...task, status: "overdue" as const } : task,
  );
}

export async function placeSessionOnSafetyHold(sessionId: string, eventId: string, reason: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("Source session missing");
  await updateRuntimeSessionRecord(sessionId, { status: "safety_paused" });
  const event = await updateSafetyEvent(eventId, { sessionHoldRequired: true, patientFacingStatus: "session_paused" });
  await transition(eventId, event.status, event.status, reason);
  return event;
}

export async function requestSessionResume(sessionId: string, eventId: string, clinicianId: string, reason: string) {
  await requirePermission("resume_request", { clinicianId, resourceType: "SafetyEvent", resourceId: eventId, runtimeSessionId: sessionId });
  const event = await getSafetyEvent(eventId);
  if (!event) throw new Error("Safety event not found");
  const session = await getRuntimeSession(sessionId);
  if (!session) throw new Error("Source session missing");
  if (event.status === "closed" || event.status === "cancelled") throw new Error("Closed event mutation is not allowed");
  if (!event.acknowledgedAt) throw new Error("Missing acknowledgement");
  const triage = await listSafetyTriageRecords(eventId);
  if (!triage.length) throw new Error("Missing triage");
  if (!["safety_paused", "escalated"].includes(session.session.status)) throw new Error("Resume request is allowed only for held sessions");
  const existing = await getPendingResumeRequest(eventId);
  if (existing) throw new Error("Duplicate resume request");
  const request: SessionResumeRequest = {
    id: makeId("RSR"),
    safetyEventId: eventId,
    runtimeSessionId: sessionId,
    requestedBy: clinicianId,
    reason,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveResumeRequest(request);
  await saveNotification({ id: makeId("SN"), type: "resume_requested", title: "Resume requested", body: reason, linkedEventId: eventId, linkedSessionId: sessionId, createdAt: new Date().toISOString() });
  await updateSafetyEvent(eventId, { resolutionSummary: reason, patientFacingStatus: "waiting_for_review" });
  return request;
}

async function resolveResumeNode(sessionId: string, inputNodeId?: string) {
  const session = await getRuntimeSession(sessionId);
  if (!session) throw new Error("Source session missing");
  const orientation = session.nodes.find((node) => node.type === "orientation");
  const chosen = inputNodeId ? session.nodes.find((node) => node.id === inputNodeId) : undefined;
  const candidate = chosen ?? orientation;
  if (!candidate) throw new Error("Missing resume-safe node");
  if (candidate.type === "session_complete" || candidate.type === "safety_check" || candidate.type === "clinician_escalation") throw new Error("Invalid resume-safe node");
  return candidate.id;
}

export async function authorizeSessionResume(sessionId: string, eventId: string, clinicianId: string, input: { reason: string; patientFacingMessage: string; proposedResumeNodeId?: string }) {
  const clinician = await requirePermission("resume_authorize", { clinicianId, resourceType: "SafetyEvent", resourceId: eventId, runtimeSessionId: sessionId });
  const event = await getSafetyEvent(eventId);
  if (!event) throw new Error("Safety event not found");
  const session = await getRuntimeSession(sessionId);
  if (!session) throw new Error("Source session missing");
  const request = await getPendingResumeRequest(eventId);
  if (!request) throw new Error("Missing pending resume request");
  const triage = await listSafetyTriageRecords(eventId);
  if (!triage.length) throw new Error("Missing triage");
  const interventions = await listInterventionRecords(eventId);
  if (event.severity === "high" && clinician?.role !== "supervisor") throw new Error("Missing supervisor approval");
  if (event.severity === "high" && interventions.some((item) => item.status !== "completed" && item.status !== "cancelled" && item.status !== "failed")) throw new Error("Missing intervention completion");
  if (!["safety_paused", "escalated"].includes(session.session.status)) throw new Error("Session is not on safety hold");
  if (!input.patientFacingMessage) throw new Error("Patient-facing resume message is required");
  const resumeNodeId = await resolveResumeNode(sessionId, input.proposedResumeNodeId);
  await updateResumeRequest(request.id, {
    status: "authorized",
    authorizedBy: clinicianId,
    authorizedAt: new Date().toISOString(),
    authorizationReason: input.reason,
    proposedResumeNodeId: resumeNodeId,
    patientFacingMessage: input.patientFacingMessage,
    conditionsVerified: ["acknowledged", "triage", "held-session", "resume-safe-node"],
    resolvedAt: new Date().toISOString(),
  });
  return updateSafetyEvent(eventId, { sessionResumeAuthorized: true, patientFacingStatus: "review_completed", resolutionSummary: input.patientFacingMessage });
}

export async function resumeSafetyHeldSession(sessionId: string, eventId: string) {
  await requirePermission("session_resume", { resourceType: "SafetyEvent", resourceId: eventId, runtimeSessionId: sessionId });
  const view = await getRuntimeSession(sessionId);
  const event = await getSafetyEvent(eventId);
  if (!view || !event) throw new Error("Safety resume target missing");
  if (!event.sessionResumeAuthorized) throw new Error("Resume conditions not met");
  const request = await getPendingResumeRequest(eventId).catch(() => null);
  const authorized = (await listResumeRequests(eventId)).find((item) => item.status === "authorized");
  const resumeNodeId = authorized?.proposedResumeNodeId ?? (await resolveResumeNode(sessionId));
  await updateRuntimeSessionRecord(sessionId, { status: "active", currentNodeId: resumeNodeId });
  const nextStatus: SafetyEventStatus = event.severity === "low" ? "monitoring" : "resolved";
  const updated = await updateSafetyEvent(eventId, { status: nextStatus, patientFacingStatus: "review_completed" });
  const lastPatientMessage = view.messages.filter((message) => message.role === "patient").at(-1)?.content ?? view.session.runtimeContext.lastPatientMessage ?? "";
  await saveTriggerSuppression({
    id: makeId("SUP"),
    runtimeSessionId: sessionId,
    safetyEventId: eventId,
    sourceNodeId: event.sourceNodeId,
    safetyRuleId: event.safetyRuleIds[0],
    inputFingerprint: createSuppressionFingerprint({
      runtimeSessionId: sessionId,
      sourceNodeId: event.sourceNodeId,
      safetyRuleId: event.safetyRuleIds[0],
      text: lastPatientMessage,
    }),
    executionSequence: event.executionSequence,
    riskLevel: event.severity,
    riskSignalSignature: [...event.safetyRuleIds].sort().join("|"),
    usageCount: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 5).toISOString(),
  });
  await transition(eventId, event.status, nextStatus, "Safety hold resumed");
  return updated;
}

export async function terminateSessionForSafety(sessionId: string, eventId: string, input: { reason: string; patientFacingMessage: string }) {
  await requirePermission("session_terminate", { resourceType: "SafetyEvent", resourceId: eventId, runtimeSessionId: sessionId });
  const event = await getSafetyEvent(eventId);
  const view = await getRuntimeSession(sessionId);
  if (!event || !view) throw new Error("Safety termination target missing");
  await updateRuntimeSessionRecord(sessionId, { status: "terminated", terminatedAt: new Date().toISOString() });
  const next = await updateSafetyEvent(eventId, { status: "resolved", patientFacingStatus: "session_terminated", resolutionSummary: input.patientFacingMessage });
  await transition(eventId, event.status, "resolved", input.reason);
  return next;
}

export async function resolveSafetyEvent(eventId: string, input: { code: string; summary: string }) {
  const event = await getSafetyEvent(eventId);
  if (!event) throw new Error("Safety event not found");
  assertSafetyTransition(event.status, "resolved");
  const next = await updateSafetyEvent(eventId, { status: "resolved", resolvedBy: actorId(), resolvedAt: new Date().toISOString(), resolutionCode: input.code, resolutionSummary: input.summary });
  await transition(eventId, event.status, "resolved", input.summary);
  return next;
}

export async function markSafetyEventFalsePositive(eventId: string, input: { reviewerId: string; reason: string; evidenceReviewed: boolean; safetyRuleReviewRequired: boolean; sessionResumeRecommended: boolean; note?: string }) {
  await requirePermission("false_positive", { clinicianId: input.reviewerId, resourceType: "SafetyEvent", resourceId: eventId });
  const event = await getSafetyEvent(eventId);
  if (!event) throw new Error("Safety event not found");
  const next = await updateSafetyEvent(eventId, {
    status: "false_positive",
    falsePositiveReason: input.reason,
    falsePositiveReviewedBy: input.reviewerId,
    falsePositiveReviewedAt: new Date().toISOString(),
    falsePositiveEvidenceReviewed: input.evidenceReviewed,
    falsePositiveRuleReviewRequired: input.safetyRuleReviewRequired,
    falsePositiveResumeRecommended: input.sessionResumeRecommended,
  });
  await transition(eventId, event.status, "false_positive", input.reason);
  return next;
}

export async function reopenSafetyEvent(eventId: string, input: { actorId: string; reason: string; newEvidenceSummary?: string; sessionReviewRequired: boolean; createFollowUp: boolean }) {
  await requirePermission("event_reopen", { clinicianId: input.actorId, resourceType: "SafetyEvent", resourceId: eventId });
  const event = await getSafetyEvent(eventId);
  if (!event) throw new Error("Safety event not found");
  if (!["resolved", "closed", "false_positive"].includes(event.status)) throw new Error("Reopen forbidden state");
  const nextStatus: SafetyEventStatus = event.status === "resolved" ? "monitoring" : "in_review";
  const updated = await updateSafetyEvent(eventId, { status: nextStatus, resolutionSummary: input.newEvidenceSummary ?? event.resolutionSummary });
  await transition(eventId, event.status, nextStatus, input.reason);
  await saveNotification({ id: makeId("SN"), type: "event_reopened", title: "Safety event reopened", body: input.reason, linkedEventId: eventId, linkedSessionId: event.runtimeSessionId, createdAt: new Date().toISOString() });
  if (input.createFollowUp) {
    await createSafetyFollowUp({
      safetyEventId: eventId,
      participantId: event.participantId,
      runtimeSessionId: event.runtimeSessionId,
      title: "Reopened event follow-up",
      description: input.reason,
      priority: event.urgency,
      linkedMemoryIds: event.linkedSafetyMemoryIds,
      linkedGoalIds: [],
      linkedHomeworkIds: [],
    });
  }
  return updated;
}

export async function createClinicianHandoff(input: Omit<ClinicianHandoffRecord, "id" | "createdAt" | "updatedAt" | "status" | "acknowledgedByRecipient">) {
  await requirePermission("handoff_create", { clinicianId: input.fromClinicianId, resourceType: "SafetyEvent", resourceId: input.safetyEventId });
  if (!input.summary) throw new Error("Summary is required");
  if (!input.pendingActions.length) throw new Error("Pending action is required");
  if (input.fromClinicianId && input.fromClinicianId === input.toClinicianId) throw new Error("Handoff recipient same as sender");
  const recipient = await getClinician(input.toClinicianId);
  if (!recipient?.active) throw new Error("Clinician unavailable");
  const event = await getSafetyEvent(input.safetyEventId);
  if (!event) throw new Error("Safety event not found");
  if (["closed", "cancelled"].includes(event.status)) throw new Error("Closed event mutation");
  const record: ClinicianHandoffRecord = {
    ...input,
    id: makeId("HOF"),
    status: "pending",
    acknowledgedByRecipient: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClinicianHandoff(record);
  await saveNotification({ id: makeId("SN"), clinicianId: input.toClinicianId, type: "handoff_received", title: "Handoff received", body: input.summary, linkedEventId: input.safetyEventId, linkedSessionId: event.runtimeSessionId, createdAt: new Date().toISOString() });
  await transition(input.safetyEventId, event.status, event.status, "Clinician handoff created");
  return record;
}

export async function acknowledgeClinicianHandoff(handoffId: string, clinicianId: string) {
  await requirePermission("handoff_acknowledge", { clinicianId, resourceType: "Handoff", resourceId: handoffId });
  const current = await getClinicianHandoff(handoffId);
  if (!current) throw new Error("Handoff not found");
  if (current.status !== "pending") throw new Error("Handoff already acknowledged");
  if (current.toClinicianId !== clinicianId) throw new Error("Insufficient permission");
  const updated = await updateClinicianHandoff(handoffId, { status: "acknowledged", acknowledgedByRecipient: true, acknowledgedAt: new Date().toISOString() });
  const event = await getSafetyEvent(current.safetyEventId);
  if (event && current.applyAssignmentOnAcknowledge) {
    await updateSafetyEvent(current.safetyEventId, { assignedClinicianId: clinicianId });
  }
  return updated;
}

export async function cancelClinicianHandoff(handoffId: string, reason: string) {
  await requirePermission("handoff_cancel", { resourceType: "Handoff", resourceId: handoffId });
  if (!reason) throw new Error("Cancellation reason is required");
  return updateClinicianHandoff(handoffId, { status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: reason });
}

export async function getPendingClinicianHandoffs() {
  return listPendingClinicianHandoffs(actorId());
}

export async function closeSafetyEvent(eventId: string, reason: string) {
  const event = await getSafetyEvent(eventId);
  if (!event) throw new Error("Safety event not found");
  assertSafetyTransition(event.status, "closed");
  const next = await updateSafetyEvent(eventId, { status: "closed" });
  await transition(eventId, event.status, "closed", reason);
  return next;
}

export async function markSafetyNotificationRead(notificationId: string) {
  return updateNotification(notificationId, { readAt: new Date().toISOString() });
}

export async function markAllSafetyNotificationsRead() {
  const all = await listNotifications();
  await Promise.all(all.filter((item) => !item.readAt).map((item) => updateNotification(item.id, { readAt: new Date().toISOString() })));
}

export async function getSafetyNotifications() {
  return listNotifications();
}

export async function generateSafetyEventReport(eventId: string) {
  await requirePermission("report_generate", { resourceType: "SafetyEvent", resourceId: eventId });
  const detail = await getSafetyEventDetail(eventId);
  if (!detail) throw new Error("Event not found");
  const report: SafetyReport = {
    id: makeId("RPT"),
    safetyEventId: eventId,
    participantId: detail.event.participantId,
    createdAt: new Date().toISOString(),
    generatedBy: actorId(),
    reportType: ["resolved", "closed", "false_positive"].includes(detail.event.status) ? "final" : "interim",
    eventStatusAtGeneration: detail.event.status,
    payload: detail as unknown as Record<string, unknown>,
  };
  await saveSafetyReport(report);
  return report;
}

export async function exportSafetyReportJson(reportId: string) {
  await requirePermission("report_export", { resourceType: "SafetyReport", resourceId: reportId });
  const report = await getSafetyReport(reportId);
  if (!report) throw new Error("Report not found");
  return JSON.stringify(report.payload, null, 2);
}

export async function getSafetyDashboardData() {
  await requirePermission("analytics_view", { resourceType: "SafetyAnalytics" });
  const [events, followUps, clinicians] = await Promise.all([listSafetyEvents(), getSafetyFollowUps(), listClinicians()]);
  return {
    open: events.filter((item) => !["closed", "false_positive", "cancelled"].includes(item.status)).length,
    immediate: events.filter((item) => item.urgency === "immediate").length,
    urgent: events.filter((item) => item.urgency === "urgent").length,
    unacknowledged: events.filter((item) => item.status === "queued").length,
    sessionsOnHold: events.filter((item) => item.sessionHoldRequired && !item.sessionResumeAuthorized).length,
    awaitingAssignment: events.filter((item) => !item.assignedClinicianId && !["closed", "resolved", "false_positive"].includes(item.status)).length,
    overdueFollowUps: followUps.filter((item) => item.status === "overdue").length,
    resolvedToday: events.filter((item) => item.resolvedAt?.startsWith(new Date().toISOString().slice(0, 10))).length,
    events,
    followUps,
    clinicians,
  };
}
