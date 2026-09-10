import { SAFETY_STORE_ENDPOINT } from "@/shared/runtime/safety-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type { SafetyStoreOp } from "@/shared/runtime/safety-store-ops";
import type {
  ClinicianHandoffRecord,
  HumanInterventionRecord,
  RuntimeClinician,
  SafetyEvent,
  SafetyFollowUpTask,
  SafetyNotification,
  SafetyReport,
  SafetyStatusTransition,
  SafetyTriageRecord,
  SafetyTriggerSuppression,
  SessionResumeRequest,
} from "@/types/safety-operations";

// Thin fetch client over src/app/api/safety/store/route.ts. The clinician
// safety-monitoring domain (safety events, transitions, triage,
// interventions, follow-ups, clinicians, notifications, reports, handoffs,
// resume requests, trigger suppressions) now lives in Neon Postgres, not
// local IndexedDB -- every function here keeps its original name and
// signature so call sites across the app (src/lib/api/safety-operations-api.ts
// for clinician screens, src/lib/api/runtime-execution-api.ts for the
// patient-facing runtime) are unaffected.
async function callStore<T>(op: SafetyStoreOp): Promise<T> {
  const response = await runtimeFetch(resolveStoreUrl(SAFETY_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Safety store operation failed.");
  return body.result as T;
}

export async function listSafetyEvents() {
  return callStore<SafetyEvent[]>({ op: "listSafetyEvents" });
}

export async function getSafetyEvent(eventId: string) {
  return callStore<SafetyEvent | undefined>({ op: "getSafetyEvent", eventId });
}

export async function saveSafetyEvent(event: SafetyEvent) {
  await callStore<SafetyEvent>({ op: "saveSafetyEvent", event });
  return event;
}

export async function updateSafetyEvent(eventId: string, patch: Partial<SafetyEvent>) {
  return callStore<SafetyEvent>({ op: "updateSafetyEvent", eventId, patch });
}

export async function saveSafetyTransition(transition: SafetyStatusTransition) {
  await callStore<SafetyStatusTransition>({ op: "saveSafetyTransition", transition });
  return transition;
}

export async function listSafetyTransitions(safetyEventId: string) {
  return callStore<SafetyStatusTransition[]>({ op: "listSafetyTransitions", safetyEventId });
}

export async function saveSafetyTriageRecord(record: SafetyTriageRecord) {
  await callStore<SafetyTriageRecord>({ op: "saveSafetyTriageRecord", record });
  return record;
}

export async function listSafetyTriageRecords(safetyEventId: string) {
  return callStore<SafetyTriageRecord[]>({ op: "listSafetyTriageRecords", safetyEventId });
}

export async function saveInterventionRecord(record: HumanInterventionRecord) {
  await callStore<HumanInterventionRecord>({ op: "saveInterventionRecord", record });
  return record;
}

export async function updateInterventionRecord(interventionId: string, patch: Partial<HumanInterventionRecord>) {
  return callStore<HumanInterventionRecord>({ op: "updateInterventionRecord", interventionId, patch });
}

export async function getInterventionRecord(interventionId: string) {
  return callStore<HumanInterventionRecord | undefined>({ op: "getInterventionRecord", interventionId });
}

export async function listInterventionRecords(safetyEventId: string) {
  return callStore<HumanInterventionRecord[]>({ op: "listInterventionRecords", safetyEventId });
}

export async function saveFollowUpTask(task: SafetyFollowUpTask) {
  await callStore<SafetyFollowUpTask>({ op: "saveFollowUpTask", task });
  return task;
}

export async function updateFollowUpTask(taskId: string, patch: Partial<SafetyFollowUpTask>) {
  return callStore<SafetyFollowUpTask>({ op: "updateFollowUpTask", taskId, patch });
}

export async function listFollowUpTasks() {
  return callStore<SafetyFollowUpTask[]>({ op: "listFollowUpTasks" });
}

export async function listClinicians() {
  return callStore<RuntimeClinician[]>({ op: "listClinicians" });
}

export async function getClinician(clinicianId: string) {
  return callStore<RuntimeClinician | undefined>({ op: "getClinician", clinicianId });
}

export async function updateClinician(clinicianId: string, patch: Partial<RuntimeClinician>) {
  return callStore<RuntimeClinician>({ op: "updateClinician", clinicianId, patch });
}

export async function saveNotification(notification: SafetyNotification) {
  await callStore<SafetyNotification>({ op: "saveNotification", notification });
  return notification;
}

export async function updateNotification(notificationId: string, patch: Partial<SafetyNotification>) {
  return callStore<SafetyNotification>({ op: "updateNotification", notificationId, patch });
}

export async function listNotifications() {
  return callStore<SafetyNotification[]>({ op: "listNotifications" });
}

export async function saveSafetyReport(report: SafetyReport) {
  await callStore<SafetyReport>({ op: "saveSafetyReport", report });
  return report;
}

export async function getSafetyReport(reportId: string) {
  return callStore<SafetyReport | undefined>({ op: "getSafetyReport", reportId });
}

export async function listSafetyReports() {
  return callStore<SafetyReport[]>({ op: "listSafetyReports" });
}

export async function saveClinicianHandoff(record: ClinicianHandoffRecord) {
  await callStore<ClinicianHandoffRecord>({ op: "saveClinicianHandoff", record });
  return record;
}

export async function getClinicianHandoff(recordId: string) {
  return callStore<ClinicianHandoffRecord | undefined>({ op: "getClinicianHandoff", recordId });
}

export async function updateClinicianHandoff(recordId: string, patch: Partial<ClinicianHandoffRecord>) {
  return callStore<ClinicianHandoffRecord>({ op: "updateClinicianHandoff", recordId, patch });
}

export async function listClinicianHandoffs(safetyEventId: string) {
  return callStore<ClinicianHandoffRecord[]>({ op: "listClinicianHandoffs", safetyEventId });
}

export async function listPendingClinicianHandoffs(clinicianId: string) {
  return callStore<ClinicianHandoffRecord[]>({ op: "listPendingClinicianHandoffs", clinicianId });
}

export async function saveResumeRequest(request: SessionResumeRequest) {
  await callStore<SessionResumeRequest>({ op: "saveResumeRequest", request });
  return request;
}

export async function updateResumeRequest(requestId: string, patch: Partial<SessionResumeRequest>) {
  return callStore<SessionResumeRequest>({ op: "updateResumeRequest", requestId, patch });
}

export async function listResumeRequests(safetyEventId: string) {
  return callStore<SessionResumeRequest[]>({ op: "listResumeRequests", safetyEventId });
}

export async function getPendingResumeRequest(safetyEventId: string) {
  return callStore<SessionResumeRequest | undefined>({ op: "getPendingResumeRequest", safetyEventId });
}

export async function saveTriggerSuppression(record: SafetyTriggerSuppression) {
  await callStore<SafetyTriggerSuppression>({ op: "saveTriggerSuppression", record });
  return record;
}

export async function findActiveTriggerSuppression(input: { runtimeSessionId: string; sourceNodeId?: string; safetyRuleId?: string; inputFingerprint?: string }) {
  return callStore<SafetyTriggerSuppression | null>({ op: "findActiveTriggerSuppression", input });
}

export async function updateTriggerSuppression(recordId: string, patch: Partial<SafetyTriggerSuppression>) {
  return callStore<SafetyTriggerSuppression>({ op: "updateTriggerSuppression", recordId, patch });
}

export async function cleanupExpiredTriggerSuppressions(referenceTime = new Date().toISOString()) {
  return callStore<number>({ op: "cleanupExpiredTriggerSuppressions", referenceTime });
}
