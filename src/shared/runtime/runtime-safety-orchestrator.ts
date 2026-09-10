import { safetyRules } from "@/shared/mocks/data";
import type { ClinicalStageNode } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeContext, SafetyOrchestrationResult, StateExtractionResult } from "@/types/runtime-session";

export async function runSafetyOrchestrator(input: {
  currentNode: ClinicalStageNode;
  extractedState?: StateExtractionResult;
  runtimeContext: RuntimeContext;
}) {
  const globalRuleIds = safetyRules
    .filter((rule) => rule.active && rule.status === "approved" && rule.sessions.includes("All Sessions"))
    .map((rule) => rule.id);
  const linkedRuleIds = [...new Set([...globalRuleIds, ...input.currentNode.safetyRuleIds])];
  const linkedRules = safetyRules.filter((rule) => linkedRuleIds.includes(rule.id));
  const riskLevel = input.extractedState?.riskLevel ?? input.runtimeContext.riskLevel ?? "low";
  const triggered = linkedRules.length > 0 && riskLevel !== "low";
  if (!triggered) {
    return {
      triggered: false,
      ruleIds: linkedRuleIds,
      action: "continue",
      escalationRequired: false,
    } satisfies SafetyOrchestrationResult;
  }
  const severity = riskLevel === "high" ? "high" : "medium";
  const rule = linkedRules[0];
  return {
    triggered: true,
    severity,
    ruleIds: linkedRuleIds,
    action: severity === "high" ? "escalate_clinician" : "pause_session",
    fixedResponse: rule?.fixedResponse ?? "We will pause the conversation and check safety status first.",
    escalationRequired: severity === "high",
    reason: rule?.title ?? "Safety rule triggered",
  } satisfies SafetyOrchestrationResult;
}
