// Shared client/server contract for the clinician safety-monitoring store
// (Neon Postgres). Mirrors the pattern in runtime-store-ops.ts: no
// server-only imports, so this is safe to import from both the
// browser-facing repository client (safety-event-repository.ts) and the
// server-side store implementation (safety-monitoring-store.ts).
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

export type SafetyStoreOp =
  | { op: "listSafetyEvents" }
  | { op: "getSafetyEvent"; eventId: string }
  | { op: "saveSafetyEvent"; event: SafetyEvent }
  | { op: "updateSafetyEvent"; eventId: string; patch: Partial<SafetyEvent> }
  | { op: "saveSafetyTransition"; transition: SafetyStatusTransition }
  | { op: "listSafetyTransitions"; safetyEventId: string }
  | { op: "saveSafetyTriageRecord"; record: SafetyTriageRecord }
  | { op: "listSafetyTriageRecords"; safetyEventId: string }
  | { op: "saveInterventionRecord"; record: HumanInterventionRecord }
  | { op: "updateInterventionRecord"; interventionId: string; patch: Partial<HumanInterventionRecord> }
  | { op: "getInterventionRecord"; interventionId: string }
  | { op: "listInterventionRecords"; safetyEventId: string }
  | { op: "saveFollowUpTask"; task: SafetyFollowUpTask }
  | { op: "updateFollowUpTask"; taskId: string; patch: Partial<SafetyFollowUpTask> }
  | { op: "listFollowUpTasks" }
  | { op: "listClinicians" }
  | { op: "getClinician"; clinicianId: string }
  | { op: "updateClinician"; clinicianId: string; patch: Partial<RuntimeClinician> }
  | { op: "saveNotification"; notification: SafetyNotification }
  | { op: "updateNotification"; notificationId: string; patch: Partial<SafetyNotification> }
  | { op: "listNotifications" }
  | { op: "saveSafetyReport"; report: SafetyReport }
  | { op: "getSafetyReport"; reportId: string }
  | { op: "listSafetyReports" }
  | { op: "saveClinicianHandoff"; record: ClinicianHandoffRecord }
  | { op: "updateClinicianHandoff"; recordId: string; patch: Partial<ClinicianHandoffRecord> }
  | { op: "getClinicianHandoff"; recordId: string }
  | { op: "listClinicianHandoffs"; safetyEventId: string }
  | { op: "listPendingClinicianHandoffs"; clinicianId: string }
  | { op: "saveResumeRequest"; request: SessionResumeRequest }
  | { op: "updateResumeRequest"; requestId: string; patch: Partial<SessionResumeRequest> }
  | { op: "listResumeRequests"; safetyEventId: string }
  | { op: "getPendingResumeRequest"; safetyEventId: string }
  | { op: "saveTriggerSuppression"; record: SafetyTriggerSuppression }
  | { op: "findActiveTriggerSuppression"; input: { runtimeSessionId: string; sourceNodeId?: string; safetyRuleId?: string; inputFingerprint?: string } }
  | { op: "updateTriggerSuppression"; recordId: string; patch: Partial<SafetyTriggerSuppression> }
  | { op: "cleanupExpiredTriggerSuppressions"; referenceTime: string };

export const SAFETY_STORE_ENDPOINT = "/api/safety/store";
