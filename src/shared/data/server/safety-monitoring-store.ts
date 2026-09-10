import { getPgPool } from "@/shared/data/db/pg-pool";
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
import type { SafetyStoreOp } from "@/shared/runtime/safety-store-ops";

// Server-only: the real (Neon Postgres) implementation of the clinician
// safety-monitoring store -- reached only through
// src/app/api/safety/store/route.ts, never imported by client components
// (DATABASE_URL is not exposed to the browser bundle). This is now the
// operational source of truth for safety events, triage, interventions,
// follow-ups, clinicians, notifications, reports, handoffs, resume
// requests, and trigger suppressions -- replacing the local IndexedDB
// (Dexie) tables of the same purpose, for both the patient-facing runtime
// (which creates safety events) and the clinician safety-monitoring
// screens (which read/act on them).

export async function listSafetyEvents(): Promise<SafetyEvent[]> {
  const { rows } = await getPgPool().query<{ data: SafetyEvent }>("SELECT data FROM safety_events ORDER BY created_at DESC");
  return rows.map((row) => row.data);
}

export async function getSafetyEvent(eventId: string): Promise<SafetyEvent | undefined> {
  const { rows } = await getPgPool().query<{ data: SafetyEvent }>("SELECT data FROM safety_events WHERE id = $1", [eventId]);
  return rows[0]?.data;
}

export async function saveSafetyEvent(event: SafetyEvent) {
  await getPgPool().query(
    `INSERT INTO safety_events (id, participant_id, runtime_session_id, severity, urgency, status, created_at, updated_at, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET severity=EXCLUDED.severity, urgency=EXCLUDED.urgency, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [event.id, event.participantId, event.runtimeSessionId, event.severity, event.urgency, event.status, event.createdAt, event.updatedAt, JSON.stringify(event)],
  );
  return event;
}

export async function updateSafetyEvent(eventId: string, patch: Partial<SafetyEvent>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: SafetyEvent }>("SELECT data FROM safety_events WHERE id = $1", [eventId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Safety event not found");
  const next: SafetyEvent = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query(
    `UPDATE safety_events SET participant_id=$2, runtime_session_id=$3, severity=$4, urgency=$5, status=$6, updated_at=$7, data=$8 WHERE id=$1`,
    [eventId, next.participantId, next.runtimeSessionId, next.severity, next.urgency, next.status, next.updatedAt, JSON.stringify(next)],
  );
  return next;
}

export async function saveSafetyTransition(transition: SafetyStatusTransition) {
  await getPgPool().query(
    `INSERT INTO safety_status_transitions (id, safety_event_id, created_at, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [transition.id, transition.safetyEventId, transition.createdAt, JSON.stringify(transition)],
  );
  return transition;
}

export async function listSafetyTransitions(safetyEventId: string): Promise<SafetyStatusTransition[]> {
  const { rows } = await getPgPool().query<{ data: SafetyStatusTransition }>(
    "SELECT data FROM safety_status_transitions WHERE safety_event_id = $1 ORDER BY created_at ASC",
    [safetyEventId],
  );
  return rows.map((row) => row.data);
}

export async function saveSafetyTriageRecord(record: SafetyTriageRecord) {
  await getPgPool().query(
    `INSERT INTO safety_triage_records (id, safety_event_id, created_at, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [record.id, record.safetyEventId, record.createdAt, JSON.stringify(record)],
  );
  return record;
}

export async function listSafetyTriageRecords(safetyEventId: string): Promise<SafetyTriageRecord[]> {
  const { rows } = await getPgPool().query<{ data: SafetyTriageRecord }>(
    "SELECT data FROM safety_triage_records WHERE safety_event_id = $1 ORDER BY created_at ASC",
    [safetyEventId],
  );
  return rows.map((row) => row.data);
}

export async function saveInterventionRecord(record: HumanInterventionRecord) {
  await getPgPool().query(
    `INSERT INTO human_intervention_records (id, safety_event_id, status, created_at, updated_at, data) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [record.id, record.safetyEventId, record.status, record.createdAt, record.updatedAt, JSON.stringify(record)],
  );
  return record;
}

export async function getInterventionRecord(interventionId: string): Promise<HumanInterventionRecord | undefined> {
  const { rows } = await getPgPool().query<{ data: HumanInterventionRecord }>("SELECT data FROM human_intervention_records WHERE id = $1", [interventionId]);
  return rows[0]?.data;
}

export async function updateInterventionRecord(interventionId: string, patch: Partial<HumanInterventionRecord>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: HumanInterventionRecord }>("SELECT data FROM human_intervention_records WHERE id = $1", [interventionId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Intervention record not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query("UPDATE human_intervention_records SET status=$2, updated_at=$3, data=$4 WHERE id=$1", [interventionId, next.status, next.updatedAt, JSON.stringify(next)]);
  return next;
}

export async function listInterventionRecords(safetyEventId: string): Promise<HumanInterventionRecord[]> {
  const { rows } = await getPgPool().query<{ data: HumanInterventionRecord }>(
    "SELECT data FROM human_intervention_records WHERE safety_event_id = $1 ORDER BY created_at ASC",
    [safetyEventId],
  );
  return rows.map((row) => row.data);
}

export async function saveFollowUpTask(task: SafetyFollowUpTask) {
  await getPgPool().query(
    `INSERT INTO safety_follow_up_tasks (id, safety_event_id, participant_id, status, updated_at, created_at, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [task.id, task.safetyEventId, task.participantId, task.status, task.updatedAt, task.createdAt, JSON.stringify(task)],
  );
  return task;
}

export async function updateFollowUpTask(taskId: string, patch: Partial<SafetyFollowUpTask>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: SafetyFollowUpTask }>("SELECT data FROM safety_follow_up_tasks WHERE id = $1", [taskId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Follow-up task not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query("UPDATE safety_follow_up_tasks SET status=$2, updated_at=$3, data=$4 WHERE id=$1", [taskId, next.status, next.updatedAt, JSON.stringify(next)]);
  return next;
}

export async function listFollowUpTasks(): Promise<SafetyFollowUpTask[]> {
  const { rows } = await getPgPool().query<{ data: SafetyFollowUpTask }>("SELECT data FROM safety_follow_up_tasks ORDER BY updated_at DESC");
  return rows.map((row) => row.data);
}

export async function listClinicians(): Promise<RuntimeClinician[]> {
  const { rows } = await getPgPool().query<{ data: RuntimeClinician }>("SELECT data FROM runtime_clinicians ORDER BY id ASC");
  return rows.map((row) => row.data);
}

export async function getClinician(clinicianId: string): Promise<RuntimeClinician | undefined> {
  const { rows } = await getPgPool().query<{ data: RuntimeClinician }>("SELECT data FROM runtime_clinicians WHERE id = $1", [clinicianId]);
  return rows[0]?.data;
}

export async function updateClinician(clinicianId: string, patch: Partial<RuntimeClinician>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: RuntimeClinician }>("SELECT data FROM runtime_clinicians WHERE id = $1", [clinicianId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Clinician not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query(
    `INSERT INTO runtime_clinicians (id, role, updated_at, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [clinicianId, next.role, next.updatedAt, JSON.stringify(next)],
  );
  return next;
}

export async function saveNotification(notification: SafetyNotification) {
  await getPgPool().query(
    `INSERT INTO safety_notifications (id, clinician_id, created_at, read_at, data) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET read_at=EXCLUDED.read_at, data=EXCLUDED.data`,
    [notification.id, notification.clinicianId ?? null, notification.createdAt, notification.readAt ?? null, JSON.stringify(notification)],
  );
  return notification;
}

export async function updateNotification(notificationId: string, patch: Partial<SafetyNotification>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: SafetyNotification }>("SELECT data FROM safety_notifications WHERE id = $1", [notificationId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Notification not found");
  const next = { ...current, ...patch };
  await pool.query("UPDATE safety_notifications SET read_at=$2, data=$3 WHERE id=$1", [notificationId, next.readAt ?? null, JSON.stringify(next)]);
  return next;
}

export async function listNotifications(): Promise<SafetyNotification[]> {
  const { rows } = await getPgPool().query<{ data: SafetyNotification }>("SELECT data FROM safety_notifications ORDER BY created_at DESC");
  return rows.map((row) => row.data);
}

export async function saveSafetyReport(report: SafetyReport) {
  await getPgPool().query(
    `INSERT INTO safety_reports (id, safety_event_id, participant_id, created_at, data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [report.id, report.safetyEventId, report.participantId, report.createdAt, JSON.stringify(report)],
  );
  return report;
}

export async function getSafetyReport(reportId: string): Promise<SafetyReport | undefined> {
  const { rows } = await getPgPool().query<{ data: SafetyReport }>("SELECT data FROM safety_reports WHERE id = $1", [reportId]);
  return rows[0]?.data;
}

export async function listSafetyReports(): Promise<SafetyReport[]> {
  const { rows } = await getPgPool().query<{ data: SafetyReport }>("SELECT data FROM safety_reports ORDER BY created_at DESC");
  return rows.map((row) => row.data);
}

export async function saveClinicianHandoff(record: ClinicianHandoffRecord) {
  await getPgPool().query(
    `INSERT INTO clinician_handoff_records (id, safety_event_id, to_clinician_id, status, created_at, updated_at, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [record.id, record.safetyEventId, record.toClinicianId, record.status, record.createdAt, record.updatedAt, JSON.stringify(record)],
  );
  return record;
}

export async function getClinicianHandoff(recordId: string): Promise<ClinicianHandoffRecord | undefined> {
  const { rows } = await getPgPool().query<{ data: ClinicianHandoffRecord }>("SELECT data FROM clinician_handoff_records WHERE id = $1", [recordId]);
  return rows[0]?.data;
}

export async function updateClinicianHandoff(recordId: string, patch: Partial<ClinicianHandoffRecord>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: ClinicianHandoffRecord }>("SELECT data FROM clinician_handoff_records WHERE id = $1", [recordId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Handoff not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query("UPDATE clinician_handoff_records SET status=$2, updated_at=$3, data=$4 WHERE id=$1", [recordId, next.status, next.updatedAt, JSON.stringify(next)]);
  return next;
}

export async function listClinicianHandoffs(safetyEventId: string): Promise<ClinicianHandoffRecord[]> {
  const { rows } = await getPgPool().query<{ data: ClinicianHandoffRecord }>(
    "SELECT data FROM clinician_handoff_records WHERE safety_event_id = $1 ORDER BY created_at ASC",
    [safetyEventId],
  );
  return rows.map((row) => row.data);
}

export async function listPendingClinicianHandoffs(clinicianId: string): Promise<ClinicianHandoffRecord[]> {
  const { rows } = await getPgPool().query<{ data: ClinicianHandoffRecord }>(
    "SELECT data FROM clinician_handoff_records WHERE to_clinician_id = $1 AND status = 'pending' ORDER BY created_at ASC",
    [clinicianId],
  );
  return rows.map((row) => row.data);
}

export async function saveResumeRequest(request: SessionResumeRequest) {
  await getPgPool().query(
    `INSERT INTO session_resume_requests (id, safety_event_id, status, created_at, updated_at, data) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, data=EXCLUDED.data`,
    [request.id, request.safetyEventId, request.status, request.createdAt, request.updatedAt, JSON.stringify(request)],
  );
  return request;
}

export async function updateResumeRequest(requestId: string, patch: Partial<SessionResumeRequest>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: SessionResumeRequest }>("SELECT data FROM session_resume_requests WHERE id = $1", [requestId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Resume request not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await pool.query("UPDATE session_resume_requests SET status=$2, updated_at=$3, data=$4 WHERE id=$1", [requestId, next.status, next.updatedAt, JSON.stringify(next)]);
  return next;
}

export async function listResumeRequests(safetyEventId: string): Promise<SessionResumeRequest[]> {
  const { rows } = await getPgPool().query<{ data: SessionResumeRequest }>(
    "SELECT data FROM session_resume_requests WHERE safety_event_id = $1 ORDER BY created_at ASC",
    [safetyEventId],
  );
  return rows.map((row) => row.data);
}

export async function getPendingResumeRequest(safetyEventId: string): Promise<SessionResumeRequest | undefined> {
  const { rows } = await getPgPool().query<{ data: SessionResumeRequest }>(
    "SELECT data FROM session_resume_requests WHERE safety_event_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT 1",
    [safetyEventId],
  );
  return rows[0]?.data;
}

export async function saveTriggerSuppression(record: SafetyTriggerSuppression) {
  await getPgPool().query(
    `INSERT INTO safety_trigger_suppressions (id, runtime_session_id, expires_at, created_at, data) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET expires_at=EXCLUDED.expires_at, data=EXCLUDED.data`,
    [record.id, record.runtimeSessionId, record.expiresAt, record.createdAt, JSON.stringify(record)],
  );
  return record;
}

export async function findActiveTriggerSuppression(input: { runtimeSessionId: string; sourceNodeId?: string; safetyRuleId?: string; inputFingerprint?: string }) {
  const { rows } = await getPgPool().query<{ data: SafetyTriggerSuppression }>(
    "SELECT data FROM safety_trigger_suppressions WHERE runtime_session_id = $1 AND expires_at > now() ORDER BY created_at DESC",
    [input.runtimeSessionId],
  );
  const match = rows
    .map((row) => row.data)
    .find((item) => item.sourceNodeId === input.sourceNodeId && item.safetyRuleId === input.safetyRuleId && item.inputFingerprint === input.inputFingerprint);
  return match ?? null;
}

export async function updateTriggerSuppression(recordId: string, patch: Partial<SafetyTriggerSuppression>) {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: SafetyTriggerSuppression }>("SELECT data FROM safety_trigger_suppressions WHERE id = $1", [recordId]);
  const current = rows[0]?.data;
  if (!current) throw new Error("Safety trigger suppression not found");
  const next = { ...current, ...patch };
  await pool.query("UPDATE safety_trigger_suppressions SET expires_at=$2, data=$3 WHERE id=$1", [recordId, next.expiresAt, JSON.stringify(next)]);
  return next;
}

export async function cleanupExpiredTriggerSuppressions(referenceTime: string) {
  const { rows } = await getPgPool().query("DELETE FROM safety_trigger_suppressions WHERE expires_at < $1 RETURNING id", [referenceTime]);
  return rows.length;
}

export async function dispatchSafetyStoreOp(op: SafetyStoreOp): Promise<unknown> {
  switch (op.op) {
    case "listSafetyEvents": return listSafetyEvents();
    case "getSafetyEvent": return getSafetyEvent(op.eventId);
    case "saveSafetyEvent": return saveSafetyEvent(op.event);
    case "updateSafetyEvent": return updateSafetyEvent(op.eventId, op.patch);
    case "saveSafetyTransition": return saveSafetyTransition(op.transition);
    case "listSafetyTransitions": return listSafetyTransitions(op.safetyEventId);
    case "saveSafetyTriageRecord": return saveSafetyTriageRecord(op.record);
    case "listSafetyTriageRecords": return listSafetyTriageRecords(op.safetyEventId);
    case "saveInterventionRecord": return saveInterventionRecord(op.record);
    case "updateInterventionRecord": return updateInterventionRecord(op.interventionId, op.patch);
    case "getInterventionRecord": return getInterventionRecord(op.interventionId);
    case "listInterventionRecords": return listInterventionRecords(op.safetyEventId);
    case "saveFollowUpTask": return saveFollowUpTask(op.task);
    case "updateFollowUpTask": return updateFollowUpTask(op.taskId, op.patch);
    case "listFollowUpTasks": return listFollowUpTasks();
    case "listClinicians": return listClinicians();
    case "getClinician": return getClinician(op.clinicianId);
    case "updateClinician": return updateClinician(op.clinicianId, op.patch);
    case "saveNotification": return saveNotification(op.notification);
    case "updateNotification": return updateNotification(op.notificationId, op.patch);
    case "listNotifications": return listNotifications();
    case "saveSafetyReport": return saveSafetyReport(op.report);
    case "getSafetyReport": return getSafetyReport(op.reportId);
    case "listSafetyReports": return listSafetyReports();
    case "saveClinicianHandoff": return saveClinicianHandoff(op.record);
    case "updateClinicianHandoff": return updateClinicianHandoff(op.recordId, op.patch);
    case "getClinicianHandoff": return getClinicianHandoff(op.recordId);
    case "listClinicianHandoffs": return listClinicianHandoffs(op.safetyEventId);
    case "listPendingClinicianHandoffs": return listPendingClinicianHandoffs(op.clinicianId);
    case "saveResumeRequest": return saveResumeRequest(op.request);
    case "updateResumeRequest": return updateResumeRequest(op.requestId, op.patch);
    case "listResumeRequests": return listResumeRequests(op.safetyEventId);
    case "getPendingResumeRequest": return getPendingResumeRequest(op.safetyEventId);
    case "saveTriggerSuppression": return saveTriggerSuppression(op.record);
    case "findActiveTriggerSuppression": return findActiveTriggerSuppression(op.input);
    case "updateTriggerSuppression": return updateTriggerSuppression(op.recordId, op.patch);
    case "cleanupExpiredTriggerSuppressions": return cleanupExpiredTriggerSuppressions(op.referenceTime);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown safety store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
