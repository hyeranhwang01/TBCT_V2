import type { SafetyEventStatus } from "@/types/safety-operations";

const allowedTransitions: Record<SafetyEventStatus, SafetyEventStatus[]> = {
  detected: ["queued"],
  queued: ["acknowledged", "cancelled"],
  acknowledged: ["triaging", "assigned"],
  triaging: ["assigned", "intervention_required", "monitoring"],
  assigned: ["in_review", "intervention_required"],
  in_review: ["intervention_required", "monitoring", "resolved", "false_positive"],
  intervention_required: ["intervention_in_progress"],
  intervention_in_progress: ["monitoring", "resolved"],
  monitoring: ["resolved", "intervention_required"],
  resolved: ["closed", "monitoring"],
  closed: [],
  false_positive: ["closed"],
  cancelled: [],
};

export function assertSafetyTransition(current: SafetyEventStatus, next: SafetyEventStatus) {
  if (!allowedTransitions[current].includes(next)) {
    throw new Error(`Invalid safety event transition: ${current} -> ${next}`);
  }
}
