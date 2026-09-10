import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createMemoryAuditEntry } from "@/shared/memory/memory-helpers";
import type { RuntimeClinician } from "@/types/safety-operations";

export type SafetyPermissionAction =
  | "event_acknowledge"
  | "event_triage"
  | "event_assign"
  | "event_reassign"
  | "intervention_create"
  | "intervention_start"
  | "intervention_complete"
  | "intervention_cancel"
  | "intervention_fail"
  | "handoff_create"
  | "handoff_acknowledge"
  | "handoff_cancel"
  | "false_positive"
  | "event_reopen"
  | "resume_request"
  | "resume_reject"
  | "resume_authorize"
  | "session_resume"
  | "session_terminate"
  | "follow_up_create"
  | "follow_up_assign"
  | "follow_up_start"
  | "follow_up_complete"
  | "follow_up_reopen"
  | "follow_up_cancel"
  | "report_generate"
  | "report_export"
  | "analytics_view";

const supervisorOnly: SafetyPermissionAction[] = [
  "resume_authorize",
  "session_resume",
  "session_terminate",
];

const reviewerOnly: SafetyPermissionAction[] = ["false_positive", "event_reopen"];

const coordinatorDenied: SafetyPermissionAction[] = [
  "session_terminate",
  "resume_authorize",
  "session_resume",
  "false_positive",
  "event_reopen",
  "intervention_complete",
  "intervention_fail",
];

export function canPerformSafetyAction(clinician: RuntimeClinician | undefined, action: SafetyPermissionAction) {
  if (!clinician?.active) {
    return { allowed: false, reason: "Active clinician context is required" };
  }

  if (supervisorOnly.includes(action)) {
    return clinician.role === "supervisor"
      ? { allowed: true }
      : { allowed: false, reason: "Supervisor permission is required" };
  }

  if (reviewerOnly.includes(action)) {
    return ["supervisor", "safety_reviewer"].includes(clinician.role)
      ? { allowed: true }
      : { allowed: false, reason: "Safety reviewer or supervisor permission is required" };
  }

  if (action === "analytics_view") {
    return clinician.role === "research_coordinator" || clinician.role === "clinician" || clinician.role === "safety_reviewer" || clinician.role === "supervisor"
      ? { allowed: true }
      : { allowed: false, reason: "Analytics access is restricted" };
  }

  if (coordinatorDenied.includes(action) && clinician.role === "research_coordinator") {
    return { allowed: false, reason: "Research coordinator role cannot perform this action" };
  }

  return { allowed: true };
}

export async function recordDeniedSafetyAction(input: {
  clinician: RuntimeClinician | undefined;
  action: SafetyPermissionAction;
  resourceType: string;
  resourceId?: string;
  participantId?: string;
  runtimeSessionId?: string;
  reason: string;
}) {
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: `Denied safety action: ${input.action}`,
      resource: input.resourceId ? `${input.resourceType} ${input.resourceId}` : input.resourceType,
      version: "stage4",
      previousValue: "",
      newValue: JSON.stringify({
        actorId: input.clinician?.id ?? "unknown",
        actorRole: input.clinician?.role ?? "unknown",
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        participantId: input.participantId,
        runtimeSessionId: input.runtimeSessionId,
        reason: input.reason,
        result: "denied",
        demoMode: true,
      }),
      reason: input.reason,
      result: "Blocked",
    }),
  );
}

export async function assertSafetyPermission(input: {
  clinician: RuntimeClinician | undefined;
  action: SafetyPermissionAction;
  resourceType: string;
  resourceId?: string;
  participantId?: string;
  runtimeSessionId?: string;
}) {
  const result = canPerformSafetyAction(input.clinician, input.action);
  if (result.allowed) return;
  await recordDeniedSafetyAction({
    clinician: input.clinician,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    participantId: input.participantId,
    runtimeSessionId: input.runtimeSessionId,
    reason: result.reason ?? "Insufficient permission",
  });
  throw new Error(result.reason ?? "Insufficient permission");
}
