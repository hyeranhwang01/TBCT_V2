import type { MemoryRetentionPolicy } from "@/types/longitudinal-memory";

// The six retention policies are fixed rules of the intervention, not data a
// user edits, so they live here as a versioned constant. They used to be
// seeded only inside tbct-local-db.ts's Dexie version(4).upgrade() callback,
// which never runs on a freshly created browser database (and never runs on
// the server at all, where there is no IndexedDB) -- so on every new
// browser and every server turn getRetentionPolicy() returned undefined and
// memory-retrieval-engine.ts excluded every memory as "policy blocks
// runtime injection". A code constant behaves identically everywhere and is
// part of what gets frozen with the intervention (rules, model, prompts).
// Changing any value here changes the intervention: bump POLICY_VERSION.
export const RETENTION_POLICY_VERSION = "2026-09-13";
const FROZEN_AT = "2026-09-13T00:00:00.000Z";

export const RETENTION_POLICIES: readonly MemoryRetentionPolicy[] = [
  { id: "RET-TEMP", name: "Temporary Session Facts", memoryTypes: ["temporary_session_fact"], defaultDurationDays: 7, requiresReview: false, autoExpire: true, allowPatientView: false, allowPatientEdit: false, allowRuntimeInjection: true, sensitivityLimit: ["standard"], createdAt: FROZEN_AT, updatedAt: FROZEN_AT },
  { id: "RET-HW-ASG", name: "Homework Assignment", memoryTypes: ["homework_assignment"], requiresReview: false, autoExpire: false, allowPatientView: true, allowPatientEdit: true, allowRuntimeInjection: true, sensitivityLimit: ["standard", "sensitive"], createdAt: FROZEN_AT, updatedAt: FROZEN_AT },
  { id: "RET-HW-OUT", name: "Homework Outcome", memoryTypes: ["homework_outcome", "activity_history", "barrier"], defaultDurationDays: 90, requiresReview: false, autoExpire: true, allowPatientView: true, allowPatientEdit: true, allowRuntimeInjection: true, sensitivityLimit: ["standard", "sensitive"], createdAt: FROZEN_AT, updatedAt: FROZEN_AT },
  { id: "RET-PREF", name: "Preferences", memoryTypes: ["patient_preference", "communication_preference"], requiresReview: false, autoExpire: false, allowPatientView: true, allowPatientEdit: true, allowRuntimeInjection: true, sensitivityLimit: ["standard", "sensitive"], createdAt: FROZEN_AT, updatedAt: FROZEN_AT },
  { id: "RET-GOAL", name: "Goals", memoryTypes: ["session_goal", "treatment_goal", "coping_strategy", "progress_marker"], defaultDurationDays: 180, requiresReview: false, autoExpire: false, allowPatientView: true, allowPatientEdit: true, allowRuntimeInjection: true, sensitivityLimit: ["standard", "sensitive"], createdAt: FROZEN_AT, updatedAt: FROZEN_AT },
  { id: "RET-SAFE", name: "Safety Restricted", memoryTypes: ["safety_relevant", "clinician_note"], requiresReview: true, autoExpire: false, allowPatientView: false, allowPatientEdit: false, allowRuntimeInjection: false, sensitivityLimit: ["safety_restricted", "highly_sensitive"], createdAt: FROZEN_AT, updatedAt: FROZEN_AT },
];

function copy(policy: MemoryRetentionPolicy): MemoryRetentionPolicy {
  return { ...policy, memoryTypes: [...policy.memoryTypes], sensitivityLimit: [...policy.sensitivityLimit], allowedNodeTypes: policy.allowedNodeTypes ? [...policy.allowedNodeTypes] : undefined };
}

export function listRetentionPolicies(): MemoryRetentionPolicy[] {
  return RETENTION_POLICIES.map(copy);
}

export function getRetentionPolicy(policyId: string): MemoryRetentionPolicy | undefined {
  const policy = RETENTION_POLICIES.find((item) => item.id === policyId);
  return policy ? copy(policy) : undefined;
}
