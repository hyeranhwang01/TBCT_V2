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

// Minimal in-memory stand-in for src/shared/data/server/safety-monitoring-store.ts.
// Every normal (non-crisis) runtime turn unconditionally calls
// cleanupExpiredTriggerSuppressions/findActiveTriggerSuppression, so those two
// need to work offline even for tests that never touch clinician escalation.
// The rest is straightforward CRUD kept only for type-exhaustiveness.

const events = new Map<string, SafetyEvent>();
const transitions = new Map<string, SafetyStatusTransition>();
const triageRecords = new Map<string, SafetyTriageRecord>();
const interventions = new Map<string, HumanInterventionRecord>();
const followUps = new Map<string, SafetyFollowUpTask>();
const clinicians = new Map<string, RuntimeClinician>();
const notifications = new Map<string, SafetyNotification>();
const reports = new Map<string, SafetyReport>();
const handoffs = new Map<string, ClinicianHandoffRecord>();
const resumeRequests = new Map<string, SessionResumeRequest>();
const triggerSuppressions = new Map<string, SafetyTriggerSuppression>();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function resetFakeSafetyStore() {
  events.clear();
  transitions.clear();
  triageRecords.clear();
  interventions.clear();
  followUps.clear();
  clinicians.clear();
  notifications.clear();
  reports.clear();
  handoffs.clear();
  resumeRequests.clear();
  triggerSuppressions.clear();
}

export async function dispatchFakeSafetyStoreOp(op: SafetyStoreOp): Promise<unknown> {
  switch (op.op) {
    case "listSafetyEvents": return [...events.values()].map(clone);
    case "getSafetyEvent": return events.has(op.eventId) ? clone(events.get(op.eventId)) : undefined;
    case "saveSafetyEvent": events.set(op.event.id, clone(op.event)); return op.event;
    case "updateSafetyEvent": {
      const current = events.get(op.eventId);
      if (!current) throw new Error("Safety event not found");
      const next = { ...current, ...op.patch };
      events.set(op.eventId, clone(next));
      return next;
    }
    case "saveSafetyTransition": transitions.set(op.transition.id, clone(op.transition)); return op.transition;
    case "listSafetyTransitions": return [...transitions.values()].filter((item) => item.safetyEventId === op.safetyEventId).map(clone);
    case "saveSafetyTriageRecord": triageRecords.set(op.record.id, clone(op.record)); return op.record;
    case "listSafetyTriageRecords": return [...triageRecords.values()].filter((item) => item.safetyEventId === op.safetyEventId).map(clone);
    case "saveInterventionRecord": interventions.set(op.record.id, clone(op.record)); return op.record;
    case "updateInterventionRecord": {
      const current = interventions.get(op.interventionId);
      if (!current) throw new Error("Intervention record not found");
      const next = { ...current, ...op.patch };
      interventions.set(op.interventionId, clone(next));
      return next;
    }
    case "getInterventionRecord": return interventions.has(op.interventionId) ? clone(interventions.get(op.interventionId)) : undefined;
    case "listInterventionRecords": return [...interventions.values()].filter((item) => item.safetyEventId === op.safetyEventId).map(clone);
    case "saveFollowUpTask": followUps.set(op.task.id, clone(op.task)); return op.task;
    case "updateFollowUpTask": {
      const current = followUps.get(op.taskId);
      if (!current) throw new Error("Follow-up task not found");
      const next = { ...current, ...op.patch };
      followUps.set(op.taskId, clone(next));
      return next;
    }
    case "listFollowUpTasks": return [...followUps.values()].map(clone);
    case "listClinicians": return [...clinicians.values()].map(clone);
    case "getClinician": return clinicians.has(op.clinicianId) ? clone(clinicians.get(op.clinicianId)) : undefined;
    case "updateClinician": {
      const current = clinicians.get(op.clinicianId);
      if (!current) throw new Error("Clinician not found");
      const next = { ...current, ...op.patch };
      clinicians.set(op.clinicianId, clone(next));
      return next;
    }
    case "saveNotification": notifications.set(op.notification.id, clone(op.notification)); return op.notification;
    case "updateNotification": {
      const current = notifications.get(op.notificationId);
      if (!current) throw new Error("Notification not found");
      const next = { ...current, ...op.patch };
      notifications.set(op.notificationId, clone(next));
      return next;
    }
    case "listNotifications": return [...notifications.values()].map(clone);
    case "saveSafetyReport": reports.set(op.report.id, clone(op.report)); return op.report;
    case "getSafetyReport": return reports.has(op.reportId) ? clone(reports.get(op.reportId)) : undefined;
    case "listSafetyReports": return [...reports.values()].map(clone);
    case "saveClinicianHandoff": handoffs.set(op.record.id, clone(op.record)); return op.record;
    case "updateClinicianHandoff": {
      const current = handoffs.get(op.recordId);
      if (!current) throw new Error("Clinician handoff not found");
      const next = { ...current, ...op.patch };
      handoffs.set(op.recordId, clone(next));
      return next;
    }
    case "getClinicianHandoff": return handoffs.has(op.recordId) ? clone(handoffs.get(op.recordId)) : undefined;
    case "listClinicianHandoffs": return [...handoffs.values()].filter((item) => item.safetyEventId === op.safetyEventId).map(clone);
    case "listPendingClinicianHandoffs": return [...handoffs.values()].filter((item) => item.toClinicianId === op.clinicianId).map(clone);
    case "saveResumeRequest": resumeRequests.set(op.request.id, clone(op.request)); return op.request;
    case "updateResumeRequest": {
      const current = resumeRequests.get(op.requestId);
      if (!current) throw new Error("Resume request not found");
      const next = { ...current, ...op.patch };
      resumeRequests.set(op.requestId, clone(next));
      return next;
    }
    case "listResumeRequests": return [...resumeRequests.values()].filter((item) => item.safetyEventId === op.safetyEventId).map(clone);
    case "getPendingResumeRequest": return [...resumeRequests.values()].find((item) => item.safetyEventId === op.safetyEventId && item.status === "pending");
    case "saveTriggerSuppression": triggerSuppressions.set(op.record.id, clone(op.record)); return op.record;
    case "findActiveTriggerSuppression": {
      const now = new Date().toISOString();
      const match = [...triggerSuppressions.values()].find((item) =>
        item.runtimeSessionId === op.input.runtimeSessionId
        && item.expiresAt > now
        && (op.input.sourceNodeId === undefined || item.sourceNodeId === op.input.sourceNodeId)
        && (op.input.safetyRuleId === undefined || item.safetyRuleId === op.input.safetyRuleId)
        && (op.input.inputFingerprint === undefined || item.inputFingerprint === op.input.inputFingerprint));
      return match ? clone(match) : undefined;
    }
    case "updateTriggerSuppression": {
      const current = triggerSuppressions.get(op.recordId);
      if (!current) throw new Error("Trigger suppression not found");
      const next = { ...current, ...op.patch };
      triggerSuppressions.set(op.recordId, clone(next));
      return next;
    }
    case "cleanupExpiredTriggerSuppressions": {
      for (const [id, record] of triggerSuppressions) if (record.expiresAt <= op.referenceTime) triggerSuppressions.delete(id);
      return undefined;
    }
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown safety store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
