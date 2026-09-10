import {
  CANONICAL_PROTOCOL_ID,
  CANONICAL_PROMPT_ITEMS,
  CANONICAL_SESSION_COMMON_RULES,
  CANONICAL_SESSION_DEFINITIONS,
  CANONICAL_SESSION_PLAN,
  CANONICAL_SOURCE_EDGES,
  CANONICAL_SOURCE_VERSION,
  CANONICAL_STAGE_NODES,
  resolveCanonicalSessionId,
} from "@/shared/protocol/source-fidelity-catalog";
import { TBCT_SOURCE_TEXT_HASH } from "@/shared/protocol/tbct-source-text.generated";
import type { ClinicalStageNode, PromptItem, SourceFidelityEdge, SourceFidelityStatus, SourceTrace } from "@/shared/protocol/source-fidelity-types";
import type { ProtocolDefinition, ProtocolGraphEdge, ProtocolGraphNode, ProtocolNodeType, ProtocolSession, RuntimeAction, SourceFidelityReleaseSnapshot } from "@/types/protocol-runtime";

const CANONICAL_ADAPTER_TIMESTAMP = "2025-01-01T00:00:00.000Z";

const interactivePromptTypes = new Set<PromptItem["type"]>([
  "question",
  "clarification",
  "follow_up",
  "confirmation",
  "reflection",
  "rating",
]);

function cloneSnapshotValue<T>(value: T): T {
  return structuredClone(value);
}

function protocolNodeTypeFor(stageNode: ClinicalStageNode): ProtocolNodeType {
  switch (stageNode.type) {
    case "session_start":
    case "orientation":
    case "dialogue":
    case "question":
    case "assessment":
    case "condition":
    case "activity":
    case "visualization":
    case "homework":
    case "safety_check":
    case "clinician_escalation":
    case "session_complete":
      return stageNode.type;
    case "opening":
    case "instruction":
    case "role_transition":
    case "worksheet_instruction":
      return "orientation";
    default:
      return "dialogue";
  }
}

function sourceEvidenceId(sourceTrace: SourceTrace) {
  return `tbct-source:${sourceTrace.sourceTextHash}:${sourceTrace.sourceLineStart}-${sourceTrace.sourceLineEnd}`;
}

function sourceFidelityStatusFor(sourceTrace: SourceTrace): SourceFidelityStatus {
  return sourceTrace.reviewWarnings?.length ? "review_required" : "structured_from_source";
}

function runtimeActionFor(stageNode: ClinicalStageNode, promptItems: PromptItem[]): RuntimeAction {
  const type = protocolNodeTypeFor(stageNode);
  const payload = {
    canonicalNodeId: stageNode.id,
    promptItemIds: promptItems.map((promptItem) => promptItem.id),
  };

  if (type === "session_complete") return { actionType: "complete_session", payload };
  if (type === "safety_check") return { actionType: "run_safety_check", payload };
  if (type === "clinician_escalation") return { actionType: "escalate_clinician", payload };
  if (type === "activity") return { actionType: "start_activity", payload };
  if (type === "homework") return { actionType: "assign_homework", payload };
  if (type === "visualization") return { actionType: "show_visualization", payload };
  if (type === "condition" || type === "assessment") return { actionType: "collect_field", payload };
  if (promptItems.some((promptItem) => promptItem.outputFields.length > 0 || interactivePromptTypes.has(promptItem.type))) {
    return { actionType: "ask_question", payload };
  }
  return { actionType: "send_message", payload };
}

function toProtocolGraphNode(stageNode: ClinicalStageNode, promptItems: PromptItem[]): ProtocolGraphNode {
  const nodeType = protocolNodeTypeFor(stageNode);
  const sourceFidelityStatus = sourceFidelityStatusFor(stageNode.sourceTrace);

  return {
    id: stageNode.id,
    protocolId: CANONICAL_PROTOCOL_ID,
    sessionId: stageNode.sessionId,
    type: nodeType,
    position: { ...stageNode.position },
    data: {
      protocolNodeId: stageNode.id,
      protocolId: CANONICAL_PROTOCOL_ID,
      sessionId: stageNode.sessionId,
      nodeType,
      title: stageNode.title,
      clinicalIntent: stageNode.clinicalPurpose,
      content: stageNode.clinicalPurpose,
      required: stageNode.status === "active",
      status: sourceFidelityStatus === "review_required" ? "needs_review" : "approved",
      sourceStructuredItemIds: [...stageNode.promptItemIds],
      sourceEvidenceIds: [sourceEvidenceId(stageNode.sourceTrace)],
      safetyRuleIds: [...stageNode.safetyRuleIds],
      completionConditionIds: [...stageNode.promptItemIds],
      canonicalNodeId: stageNode.id,
      promptItemIds: [...stageNode.promptItemIds],
      sourceTrace: cloneSnapshotValue(stageNode.sourceTrace),
      sourceFidelityStatus,
      runtimeAction: runtimeActionFor(stageNode, promptItems),
      metadata: {
        createdBy: "TBCT source import",
        createdAt: CANONICAL_ADAPTER_TIMESTAMP,
        updatedBy: "TBCT source import",
        updatedAt: CANONICAL_ADAPTER_TIMESTAMP,
        reviewStatus: sourceFidelityStatus,
      },
    },
  };
}

function toProtocolGraphEdge(edge: SourceFidelityEdge): ProtocolGraphEdge {
  return {
    id: edge.id,
    protocolId: CANONICAL_PROTOCOL_ID,
    sessionId: edge.sessionId,
    source: edge.source,
    target: edge.target,
    edgeType: edge.edgeType,
    label: edge.label,
    condition: edge.condition ? { id: `${edge.id}-condition`, ...edge.condition } : undefined,
    priority: edge.priority,
    isFallback: edge.isFallback,
    sourceEvidenceIds: [sourceEvidenceId(edge.sourceTrace)],
    sourceTrace: cloneSnapshotValue(edge.sourceTrace),
    sourceFidelityStatus: sourceFidelityStatusFor(edge.sourceTrace),
    createdAt: CANONICAL_ADAPTER_TIMESTAMP,
    updatedAt: CANONICAL_ADAPTER_TIMESTAMP,
  };
}

export function isCanonicalProtocolId(protocolId?: string) {
  return protocolId?.toLowerCase() === CANONICAL_PROTOCOL_ID;
}

export function createCanonicalProtocolDefinition(version = CANONICAL_SOURCE_VERSION): ProtocolDefinition {
  return {
    id: CANONICAL_PROTOCOL_ID,
    projectId: CANONICAL_PROTOCOL_ID,
    title: "TBCT Brazil Pilot Protocol",
    locale: "en-US",
    country: "BR",
    currentVersion: version,
    status: "validated",
    sessionIds: CANONICAL_SESSION_PLAN.orderedEntries.map((entry) => entry.sessionId),
    globalSafetyRuleIds: [],
    runtimeSchemaVersion: "source-fidelity-1.0",
    createdAt: CANONICAL_SESSION_PLAN.createdAt,
    updatedAt: CANONICAL_SESSION_PLAN.updatedAt,
  };
}

export function createCanonicalProtocolSession(sessionId: string): ProtocolSession | null {
  const canonicalSessionId = resolveCanonicalSessionId(sessionId) ?? sessionId;
  const definition = CANONICAL_SESSION_DEFINITIONS.find((item) => item.id === canonicalSessionId);
  if (!definition) return null;
  const graph = createCanonicalProtocolGraphSnapshot(canonicalSessionId);
  return {
    id: definition.id,
    protocolId: CANONICAL_PROTOCOL_ID,
    title: definition.title,
    order: definition.number,
    goals: [definition.sessionObjective],
    entryNodeId: definition.startNodeId,
    completionNodeIds: [definition.completionNodeId],
    nodeIds: graph.nodes.map((node) => node.id),
    edgeIds: graph.edges.map((edge) => edge.id),
    status: definition.sourceFidelityStatus === "review_required" ? "needs_review" : "approved",
    locale: "en-US",
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

export function createCanonicalSourceFidelityReleaseSnapshot(): SourceFidelityReleaseSnapshot {
  return {
    canonicalProtocolId: CANONICAL_PROTOCOL_ID,
    sourceVersion: CANONICAL_SOURCE_VERSION,
    sourceTextHash: TBCT_SOURCE_TEXT_HASH,
    sessionPlan: cloneSnapshotValue(CANONICAL_SESSION_PLAN),
    sessionDefinitions: cloneSnapshotValue(CANONICAL_SESSION_DEFINITIONS),
    sessionCommonRules: cloneSnapshotValue(CANONICAL_SESSION_COMMON_RULES),
    clinicalStageNodes: cloneSnapshotValue(CANONICAL_STAGE_NODES),
    promptItems: cloneSnapshotValue(CANONICAL_PROMPT_ITEMS),
    sourceFidelityEdges: cloneSnapshotValue(CANONICAL_SOURCE_EDGES),
  };
}

export function createCanonicalProtocolGraphSnapshot(sessionId?: string) {
  const canonicalSessionId = sessionId ? resolveCanonicalSessionId(sessionId) : undefined;
  const sourceSnapshot = createCanonicalSourceFidelityReleaseSnapshot();
  const clinicalStageNodes = canonicalSessionId
    ? sourceSnapshot.clinicalStageNodes.filter((stageNode) => stageNode.sessionId === canonicalSessionId)
    : sourceSnapshot.clinicalStageNodes;
  const nodeIds = new Set(clinicalStageNodes.map((stageNode) => stageNode.id));
  const promptItems = sourceSnapshot.promptItems.filter((promptItem) => nodeIds.has(promptItem.nodeId));
  const promptItemsByNode = new Map<string, PromptItem[]>();
  for (const promptItem of promptItems) {
    const items = promptItemsByNode.get(promptItem.nodeId) ?? [];
    items.push(promptItem);
    promptItemsByNode.set(promptItem.nodeId, items);
  }

  return {
    nodes: clinicalStageNodes.map((stageNode) => toProtocolGraphNode(stageNode, promptItemsByNode.get(stageNode.id) ?? [])),
    edges: sourceSnapshot.sourceFidelityEdges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map(toProtocolGraphEdge),
  };
}

export function createCanonicalProtocolReleaseSnapshot() {
  const sourceFidelity = createCanonicalSourceFidelityReleaseSnapshot();
  const graph = createCanonicalProtocolGraphSnapshot();
  return { ...graph, sourceFidelity };
}