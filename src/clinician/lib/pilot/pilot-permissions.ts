import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createMemoryAuditEntry } from "@/shared/memory/memory-helpers";
import type { DemoActorRole } from "@/shared/demo-actor";

export type PilotRole = DemoActorRole;

export type PilotPermissionAction =
  | "study_view"
  | "study_configure"
  | "site_manage"
  | "participant_create"
  | "screening_manage"
  | "eligibility_decide"
  | "eligibility_override"
  | "consent_record"
  | "consent_withdraw"
  | "enrollment_manage"
  | "allocation_execute"
  | "allocation_override"
  | "protocol_assign"
  | "protocol_override"
  | "session_schedule"
  | "clinician_session_manage"
  | "runtime_session_start"
  | "assessment_manage"
  | "deviation_create"
  | "deviation_review"
  | "deviation_resolve"
  | "data_quality_run"
  | "data_quality_resolve"
  | "snapshot_create"
  | "snapshot_validate"
  | "snapshot_lock"
  | "export_generate"
  | "report_generate"
  | "analytics_view";

const permissionMap: Record<PilotRole, Set<PilotPermissionAction>> = {
  research_coordinator: new Set([
    "study_view", "participant_create", "screening_manage", "eligibility_decide", "consent_record", "consent_withdraw",
    "enrollment_manage", "allocation_execute", "protocol_assign", "session_schedule", "assessment_manage",
    "deviation_create", "deviation_review", "data_quality_run", "data_quality_resolve", "snapshot_create",
    "snapshot_validate", "report_generate", "analytics_view",
  ]),
  clinician: new Set([
    "study_view", "clinician_session_manage", "assessment_manage", "deviation_create", "analytics_view",
  ]),
  supervisor: new Set([
    "study_view", "study_configure", "site_manage", "eligibility_override", "allocation_override", "protocol_override",
    "deviation_review", "deviation_resolve", "snapshot_validate", "snapshot_lock", "report_generate", "analytics_view",
  ]),
  safety_reviewer: new Set([
    "study_view", "assessment_manage", "deviation_review", "data_quality_run", "report_generate", "analytics_view",
  ]),
  research_analyst: new Set([
    "study_view", "analytics_view", "export_generate",
  ]),
};

export function canPerformPilotAction(role: PilotRole, action: PilotPermissionAction) {
  return permissionMap[role]?.has(action) ?? false;
}

export async function recordDeniedPilotAction(input: {
  actorId: string;
  actorRole: PilotRole;
  action: PilotPermissionAction;
  resourceType: string;
  resourceId?: string;
  reason: string;
}) {
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: `Pilot denied: ${input.action}`,
      resource: `${input.resourceType}${input.resourceId ? ` ${input.resourceId}` : ""}`,
      version: "stage5",
      previousValue: "",
      newValue: JSON.stringify({
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        reason: input.reason,
        result: "denied",
        demoMode: true,
        timestamp: new Date().toISOString(),
      }),
      reason: input.reason,
      result: "Blocked",
    }),
  );
}

export async function assertPilotPermission(input: {
  actorId: string;
  actorRole: PilotRole;
  action: PilotPermissionAction;
  resourceType: string;
  resourceId?: string;
}) {
  if (canPerformPilotAction(input.actorRole, input.action)) {
    return;
  }
  await recordDeniedPilotAction({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    reason: "Insufficient pilot permission",
  });
  throw new Error(`Insufficient permission for ${input.action}`);
}
