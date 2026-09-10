import type { AuditEntry } from "@/types";
import type { MemorySensitivity, MemoryType } from "@/types/longitudinal-memory";
import { makeId } from "@/shared/id";

export function createMemoryAuditEntry(input: Partial<AuditEntry> & Pick<AuditEntry, "action" | "resource" | "version">): AuditEntry {
  const now = new Date().toISOString();
  return {
    id: makeId("AUD"),
    timestamp: now,
    user: "Codex",
    initials: "CX",
    role: "System",
    action: input.action,
    resource: input.resource,
    previousValue: input.previousValue ?? "",
    newValue: input.newValue ?? "",
    reason: input.reason ?? "",
    result: input.result ?? "Success",
    version: input.version,
  };
}

export function defaultPolicyIdForType(memoryType: MemoryType) {
  if (memoryType === "temporary_session_fact") return "RET-TEMP";
  if (memoryType === "homework_assignment") return "RET-HW-ASG";
  if (["homework_outcome", "activity_history", "barrier"].includes(memoryType)) return "RET-HW-OUT";
  if (["patient_preference", "communication_preference"].includes(memoryType)) return "RET-PREF";
  if (["session_goal", "treatment_goal", "coping_strategy", "progress_marker"].includes(memoryType)) return "RET-GOAL";
  if (["safety_relevant", "clinician_note"].includes(memoryType)) return "RET-SAFE";
  return "RET-TEMP";
}

export function defaultSensitivityForType(memoryType: MemoryType): MemorySensitivity {
  if (memoryType === "safety_relevant") return "safety_restricted";
  if (memoryType === "clinician_note") return "highly_sensitive";
  if (["barrier", "reported_context"].includes(memoryType)) return "sensitive";
  return "standard";
}
