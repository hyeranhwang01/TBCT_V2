import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { ProtocolGraphEdge, ProtocolGraphNode, ProtocolNodeType } from "@/types/protocol-runtime";

export type FlowNode = Node<{ step: ProtocolGraphNode }>;

export const nodeTypeOptions: ProtocolNodeType[] = [
  "session_start",
  "orientation",
  "dialogue",
  "question",
  "assessment",
  "condition",
  "activity",
  "visualization",
  "homework",
  "safety_check",
  "clinician_escalation",
  "session_complete",
];

export function nodeTone(status: ProtocolGraphNode["data"]["status"]) {
  if (status === "approved") return "border-clinical-blue";
  if (status === "needs_review") return "border-warning";
  if (status === "validation_error") return "border-critical";
  if (status === "published") return "border-success";
  return "border-border-strong";
}

export function toNodes(steps: ProtocolGraphNode[]): FlowNode[] {
  return steps.map((step) => ({ id: step.id, type: "protocolNode", position: step.position, data: { step } }));
}

export function toEdges(edges: ProtocolGraphEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

/** Clinician-safe label chips computed from existing data — no new fields invented. */
export type ClinicianStepLabel = "required" | "conditional" | "repeated" | "safety";

export function getClinicianStepLabels(step: ProtocolGraphNode): ClinicianStepLabel[] {
  const labels: ClinicianStepLabel[] = [];
  if (step.data.required) labels.push("required");
  if (step.data.safetyRuleIds.length > 0 || step.type === "safety_check") labels.push("safety");
  if (step.type === "condition") labels.push("conditional");
  if (step.data.completionConditionIds.length > 1) labels.push("repeated");
  return labels;
}

/** Best-effort plain-language summary of a structured condition — never JSON.stringify in visible UI. */
export function summarizeCondition(condition: { kind?: string; field?: string; operator?: string; value?: unknown } | null | undefined): string | null {
  if (!condition || condition.kind === "always" || !condition.field) return null;
  const field = String(condition.field).replaceAll(/[._]/g, " ");
  const operator = condition.operator ?? "equals";
  const value = condition.value;
  const opText = operator === "equals" ? "is"
    : operator === "not_equals" ? "is not"
    : operator === "greater_than" ? "is greater than"
    : operator === "less_than" ? "is less than"
    : operator === "contains" ? "includes"
    : operator === "exists" ? "is provided"
    : operator === "in" ? "is one of"
    : operator;
  if (operator === "exists") return `${field} ${opText}`;
  return `${field} ${opText} ${Array.isArray(value) ? value.join(", ") : String(value ?? "")}`.trim();
}
