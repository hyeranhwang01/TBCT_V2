import JSZip from "jszip";
import type { AuditEntry } from "@/types";
import type { SafetyRule } from "@/types";
import { getProtocolDraftCandidateApi } from "@/clinician/lib/api/clinical-assets-api";
import { safetyRules } from "@/shared/mocks/data";
import { importRealSession03 } from "@/clinician/lib/protocol-drafts/session-03-importer";
import { getSessionBuilderDraftSnapshot } from "@/clinician/lib/session-catalog";
import { compileRuntimeRelease } from "@/shared/runtime/runtime-release-compiler";
import {
  CANONICAL_PROTOCOL_ID,
  getCanonicalSourceFidelityIssues,
  resolveCanonicalSessionId,
} from "@/shared/protocol/source-fidelity-catalog";
import {
  createCanonicalProtocolDefinition,
  createCanonicalProtocolGraphSnapshot,
  createCanonicalProtocolReleaseSnapshot,
  createCanonicalProtocolSession,
  isCanonicalProtocolId,
} from "@/shared/protocol/source-fidelity-protocol-adapter";
import {
  createProtocolEdgeRecord,
  createProtocolNodeRecord,
  deleteProtocolEdgeRecord,
  deleteProtocolNodeRecord,
  getProtocolEdge,
  getProtocolDefinition,
  getProtocolGraph,
  getProtocolNode,
  getProtocolRelease,
  getProtocolReleases,
  getProtocolSession,
  getReleasePackage,
  getValidationRun,
  saveProtocolImport,
  saveReleasePackage,
  saveRuntimeExecutionLog,
  saveValidationRun,
  updateProtocolEdge as updateProtocolEdgeRepo,
  updateProtocolNode as updateProtocolNodeRepo,
} from "@/shared/data/repositories/protocol-repository";
import type {
  ProtocolDefinition,
  ProtocolGraphEdge,
  ProtocolGraphNode,
  ProtocolImportResult,
  ProtocolImportWarning,
  ProtocolNodeType,
  ProtocolReleasePackage,
  ProtocolReleaseVersion,
  ProtocolSession,
  ProtocolValidationIssue,
  ProtocolValidationRun,
  RuntimeRelease,
  RuntimeExecutionLog,
  SourceFidelityReleaseSnapshot,
} from "@/types/protocol-runtime";
import type { ProtocolDraftCandidate } from "@/types/clinical-assets";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";

export interface CreateProtocolNodeInput {
  protocolId: string;
  sessionId: string;
  nodeType: ProtocolNodeType;
  title: string;
  position?: { x: number; y: number };
  clinicalIntent?: string;
  content?: string;
  required?: boolean;
  sourceStructuredItemIds?: string[];
  sourceEvidenceIds?: string[];
  safetyRuleIds?: string[];
  reason: string;
}

export interface CreateProtocolEdgeInput {
  protocolId: string;
  sessionId: string;
  source: string;
  target: string;
  edgeType: ProtocolGraphEdge["edgeType"];
  label?: string;
  condition?: ProtocolGraphEdge["condition"];
  priority?: number;
  isFallback?: boolean;
  sourceStructuredItemId?: string;
  sourceEvidenceIds?: string[];
  reason: string;
}

export interface RuntimeContext {
  fields: Record<string, unknown>;
  expectedResponseCategory?: string;
  riskLevel?: "low" | "medium" | "high";
  homeworkStatus?: "not_assigned" | "pending" | "completed";
  iterationCounts: Record<string, number>;
}

export interface RuntimeScenario {
  id: string;
  protocolId: string;
  protocolVersion: string;
  sessionId: string;
  title: string;
  description?: string;
  initialContext: RuntimeContext;
  expectedPathNodeIds?: string[];
  expectedSafetyRuleIds?: string[];
  createdAt: string;
  updatedAt: string;
}

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") {
    return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  }

  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${timePart}-${randomPart}`;
}

function createAuditEntry(input: Partial<AuditEntry> & Pick<AuditEntry, "action" | "resource" | "version">): AuditEntry {
  return {
    id: makeId("AUD"),
    timestamp: new Date().toISOString(),
    user: "Demo User",
    initials: "DM",
    role: "Clinical Research Operator",
    previousValue: "",
    newValue: "",
    reason: "",
    result: "Success",
    ...input,
  };
}

function nodeTypeForMapping(mappingType: string): ProtocolNodeType {
  switch (mappingType) {
    case "session_goal":
      return "session_start";
    case "clinical_intent":
      return "dialogue";
    case "basic_question":
      return "question";
    case "expected_response":
      return "condition";
    case "follow_up_branch":
      return "condition";
    case "therapeutic_activity":
      return "activity";
    case "homework":
      return "homework";
    case "visualization":
      return "visualization";
    case "completion_condition":
      return "session_complete";
    case "safety_rule":
      return "safety_check";
    case "clinician_intervention_condition":
      return "clinician_escalation";
    default:
      return "dialogue";
  }
}

function runtimeActionForType(nodeType: ProtocolNodeType, content: string) {
  const map = {
    question: "ask_question",
    activity: "start_activity",
    homework: "assign_homework",
    visualization: "show_visualization",
    safety_check: "run_safety_check",
    clinician_escalation: "escalate_clinician",
    session_complete: "complete_session",
    dialogue: "send_message",
    condition: "collect_field",
    orientation: "send_message",
    assessment: "collect_field",
    session_start: "send_message",
  } as const;
  return {
    actionType: map[nodeType],
    payload: { content },
  };
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonicalStringify(val)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(text: string) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return `fallback-${Math.abs(hash).toString(16)}`;
}

function buildStepId(sessionId: string, nodeType: ProtocolNodeType, existingIds: string[]) {
  const short = {
    session_start: "START",
    orientation: "ORG",
    dialogue: "DLG",
    question: "Q",
    assessment: "ASM",
    condition: "COND",
    activity: "ACT",
    visualization: "VIS",
    homework: "HW",
    safety_check: "SAFE",
    clinician_escalation: "ESC",
    session_complete: "END",
  }[nodeType];
  const base = `${sessionId.replace("SESSION-", "S")}-${short}-`;
  let counter = 1;
  while (existingIds.includes(`${base}${String(counter).padStart(3, "0")}`)) counter += 1;
  return `${base}${String(counter).padStart(3, "0")}`;
}

function compareConditionValue(actual: unknown, operator: NonNullable<ProtocolGraphEdge["condition"]>["operator"], expected: unknown) {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return typeof actual === "string" && typeof expected === "string" ? actual.includes(expected) : Array.isArray(actual) ? actual.includes(expected) : false;
    case "greater_than":
      return typeof actual === "number" && typeof expected === "number" ? actual > expected : false;
    case "less_than":
      return typeof actual === "number" && typeof expected === "number" ? actual < expected : false;
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "in":
      return Array.isArray(expected) ? expected.includes(actual as never) : false;
    case "custom":
      return false;
    default:
      return false;
  }
}

function resolveConditionValue(condition: NonNullable<ProtocolGraphEdge["condition"]>, context: RuntimeContext) {
  if (condition.field in context.fields) return context.fields[condition.field];
  if (condition.field === "expectedResponseCategory") return context.expectedResponseCategory;
  if (condition.field === "riskLevel") return context.riskLevel;
  if (condition.field === "homeworkStatus") return context.homeworkStatus;
  if (condition.field.startsWith("iterationCounts.")) return context.iterationCounts[condition.field.replace("iterationCounts.", "")];
  return undefined;
}

export function evaluateProtocolCondition(condition: NonNullable<ProtocolGraphEdge["condition"]>, context: RuntimeContext) {
  if (condition.operator === "custom") {
    return { matched: false, unsupported: true };
  }
  const actual = resolveConditionValue(condition, context);
  return { matched: compareConditionValue(actual, condition.operator, condition.value), unsupported: false };
}

export async function getProtocolNodeApi(nodeId: string) {
  return getProtocolNode(nodeId);
}

async function getActiveProtocolGraph(protocolId: string, sessionId?: string) {
  if (isCanonicalProtocolId(protocolId)) {
    const canonicalSessionId = resolveCanonicalSessionId(sessionId ?? "SESSION-03");
    if (!canonicalSessionId) throw new Error(`Unknown canonical TBCT session: ${sessionId ?? "SESSION-03"}`);
    return createCanonicalProtocolGraphSnapshot(canonicalSessionId);
  }
  return getProtocolGraph(protocolId, sessionId);
}

function assertMutableProtocol(protocolId: string) {
  if (isCanonicalProtocolId(protocolId)) {
    throw new Error("Canonical source-fidelity TBCT content is immutable. Regenerate it from the verified source baseline instead of editing the legacy graph.");
  }
}

function createDefaultProtocolDefinition(protocolId: string, version = "0.4.0"): ProtocolDefinition {
  const now = new Date().toISOString();
  return {
    id: protocolId,
    projectId: "TBCT-BR-001",
    title: "TBCT Brazil Pilot Protocol",
    locale: "pt-BR",
    country: "BR",
    currentVersion: version,
    status: "draft",
    sessionIds: ["SESSION-03"],
    globalSafetyRuleIds: [],
    runtimeSchemaVersion: "1.0",
    createdAt: now,
    updatedAt: now,
  };
}

async function getOrCreateProtocolDefinition(protocolId: string, version = "0.4.0") {
  const db = getLocalDb();
  const existing = await db.protocolDefinitions.get(protocolId);
  if (existing) return existing;
  const next = createDefaultProtocolDefinition(protocolId, version);
  await db.protocolDefinitions.put(next);
  return next;
}

function createDefaultProtocolSession(protocolId: string, sessionId = "SESSION-03"): ProtocolSession {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    protocolId,
    title: sessionId === "SESSION-03" ? "Session 03" : sessionId,
    order: sessionId === "SESSION-03" ? 3 : 1,
    goals: [],
    entryNodeId: undefined,
    completionNodeIds: [],
    nodeIds: [],
    edgeIds: [],
    status: "draft",
    locale: "pt-BR",
    createdAt: now,
    updatedAt: now,
  };
}

async function getOrCreateProtocolSession(protocolId: string, sessionId = "SESSION-03") {
  const db = getLocalDb();
  const existing = await db.protocolSessions.get(sessionId);
  if (existing) return existing;
  const next = createDefaultProtocolSession(protocolId, sessionId);
  await db.protocolSessions.put(next);
  return next;
}

export async function getProtocolDefinitionApi(protocolId: string) {
  if (isCanonicalProtocolId(protocolId)) return createCanonicalProtocolDefinition();
  return getOrCreateProtocolDefinition(protocolId);
}

export async function upsertProtocolDefinition(protocolId: string, patch: Partial<ProtocolDefinition>) {
  assertMutableProtocol(protocolId);
  const db = getLocalDb();
  const current = await db.protocolDefinitions.get(protocolId);
  const now = new Date().toISOString();
  const next: ProtocolDefinition = {
    id: protocolId,
    projectId: patch.projectId ?? current?.projectId ?? protocolId,
    title: patch.title ?? current?.title ?? "TBCT Brazil Pilot Protocol",
    description: patch.description ?? current?.description,
    locale: patch.locale ?? current?.locale ?? "pt-BR",
    country: patch.country ?? current?.country ?? "BR",
    currentVersion: patch.currentVersion ?? current?.currentVersion ?? "0.4.0",
    status: patch.status ?? current?.status ?? "draft",
    sessionIds: patch.sessionIds ?? current?.sessionIds ?? ["SESSION-03"],
    globalSafetyRuleIds: patch.globalSafetyRuleIds ?? current?.globalSafetyRuleIds ?? [],
    runtimeSchemaVersion: patch.runtimeSchemaVersion ?? current?.runtimeSchemaVersion ?? "1.0",
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  await db.protocolDefinitions.put(next);
  return next;
}

export async function getProtocolEdgeApi(edgeId: string) {
  return getProtocolEdge(edgeId);
}

export async function createProtocolNode(input: CreateProtocolNodeInput) {
  assertMutableProtocol(input.protocolId);
  const graph = await getProtocolGraph(input.protocolId, input.sessionId);
  const protocolNodeId = buildStepId(input.sessionId, input.nodeType, graph.nodes.map((node) => node.data.protocolNodeId));
  const now = new Date().toISOString();
  const node: ProtocolGraphNode = {
    id: `NODE-${makeId("P")}`,
    protocolId: input.protocolId,
    sessionId: input.sessionId,
    type: input.nodeType,
    position: input.position ?? { x: 200 + graph.nodes.length * 40, y: 140 + graph.nodes.length * 24 },
    data: {
      protocolNodeId,
      protocolId: input.protocolId,
      sessionId: input.sessionId,
      nodeType: input.nodeType,
      title: input.title,
      clinicalIntent: input.clinicalIntent,
      content: input.content,
      required: input.required ?? true,
      status: "draft",
      sourceStructuredItemIds: input.sourceStructuredItemIds ?? [],
      sourceEvidenceIds: input.sourceEvidenceIds ?? [],
      safetyRuleIds: input.safetyRuleIds ?? [],
      completionConditionIds: [],
      runtimeAction: runtimeActionForType(input.nodeType, input.content ?? input.title),
      metadata: {
        createdBy: "Demo User",
        createdAt: now,
        updatedBy: "Demo User",
        updatedAt: now,
      },
    },
  };
  await createProtocolNodeRecord(
    node,
    createAuditEntry({
      action: "Protocol node created",
      resource: node.id,
      version: "",
      newValue: JSON.stringify({ protocolNodeId, nodeType: input.nodeType, title: input.title }),
      reason: input.reason,
    }),
  );
  return node;
}

export async function duplicateProtocolNode(nodeId: string, options?: { keepSourceEvidence?: boolean; duplicateOutgoingEdges?: boolean }) {
  const node = await getProtocolNode(nodeId);
  if (!node) throw new Error("Protocol node not found");
  assertMutableProtocol(node.protocolId);
  const copy = await createProtocolNode({
    protocolId: node.protocolId,
    sessionId: node.sessionId,
    nodeType: node.type,
    title: `${node.data.title} Copy`,
    position: { x: node.position.x + 36, y: node.position.y + 36 },
    clinicalIntent: node.data.clinicalIntent,
    content: node.data.content,
    required: node.data.required,
    sourceStructuredItemIds: [...node.data.sourceStructuredItemIds],
    sourceEvidenceIds: options?.keepSourceEvidence ? [...node.data.sourceEvidenceIds] : [],
    safetyRuleIds: [...node.data.safetyRuleIds],
    reason: "Duplicate node",
  });
  return copy;
}

export async function deleteProtocolNode(nodeId: string, options?: { reason?: string }) {
  const node = await getProtocolNode(nodeId);
  if (!node) throw new Error("Protocol node not found");
  assertMutableProtocol(node.protocolId);
  if (node.data.status === "published") throw new Error("Published node cannot be deleted");
  await deleteProtocolNodeRecord(
    nodeId,
    createAuditEntry({
      action: "Protocol node deleted",
      resource: nodeId,
      version: "",
      previousValue: JSON.stringify(node),
      reason: options?.reason ?? "Delete node",
    }),
  );
}

export async function createProtocolEdge(input: CreateProtocolEdgeInput) {
  assertMutableProtocol(input.protocolId);
  const [sourceNode, targetNode, graph] = await Promise.all([
    getProtocolNode(input.source),
    getProtocolNode(input.target),
    getProtocolGraph(input.protocolId, input.sessionId),
  ]);
  if (!sourceNode || !targetNode) throw new Error("Source or target node is missing");
  if (input.source === input.target) throw new Error("Self-edge is not allowed");
  if (sourceNode.sessionId !== targetNode.sessionId) throw new Error("Cross-session edge is not allowed");
  if (input.edgeType === "conditional" && !input.condition && !input.label) throw new Error("Conditional edge requires a condition or label");
  if (input.isFallback && graph.edges.some((edge) => edge.source === input.source && edge.isFallback)) throw new Error("Only one fallback edge is allowed per source");
  if (graph.edges.some((edge) => edge.source === input.source && edge.target === input.target && edge.label === input.label)) throw new Error("Duplicate edge already exists");
  const edge: ProtocolGraphEdge = {
    id: `EDGE-${makeId("P")}`,
    protocolId: input.protocolId,
    sessionId: input.sessionId,
    source: input.source,
    target: input.target,
    edgeType: input.edgeType,
    label: input.label,
    condition: input.condition,
    priority: input.priority ?? 1,
    isFallback: input.isFallback ?? false,
    sourceStructuredItemId: input.sourceStructuredItemId,
    sourceEvidenceIds: input.sourceEvidenceIds ?? [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await createProtocolEdgeRecord(
    edge,
    createAuditEntry({
      action: "Protocol edge created",
      resource: edge.id,
      version: "",
      newValue: JSON.stringify({ source: edge.source, target: edge.target, edgeType: edge.edgeType }),
      reason: input.reason,
    }),
  );
  return edge;
}

export async function deleteProtocolEdge(edgeId: string) {
  const edge = await getProtocolEdge(edgeId);
  if (!edge) throw new Error("Protocol edge not found");
  assertMutableProtocol(edge.protocolId);
  await deleteProtocolEdgeRecord(
    edgeId,
    createAuditEntry({
      action: "Protocol edge deleted",
      resource: edgeId,
      version: "",
      previousValue: JSON.stringify(edge),
      reason: "Delete edge",
    }),
  );
}

export async function getProtocolReleasesApi(protocolId = "TBCT-BR-001") {
  return getProtocolReleases(isCanonicalProtocolId(protocolId) ? CANONICAL_PROTOCOL_ID : protocolId);
}

export async function getProtocolReleaseApi(releaseId: string) {
  const release = await getProtocolRelease(releaseId);
  if (!release) throw new Error("Release not found");
  const pkg = await getReleasePackage(release.releasePackageId);
  return { release, package: pkg };
}

export async function createDraftFromRelease(releaseId: string, input: { version: string; changeSummary: string }) {
  const release = await getProtocolRelease(releaseId);
  if (!release) throw new Error("Release not found");
  if (release.immutableSnapshot.sourceFidelity?.canonicalProtocolId === CANONICAL_PROTOCOL_ID) {
    throw new Error("Canonical source-fidelity releases are immutable. Regenerate a release from the verified source baseline instead of creating a legacy Session 03 draft.");
  }
  const definition = await getOrCreateProtocolDefinition(release.protocolId, input.version);
  const existing = await getProtocolReleases(release.protocolId);
  if (existing.some((item) => item.version === input.version)) throw new Error("Version already exists");
  const now = new Date().toISOString();
  const copiedNodes = release.immutableSnapshot.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      status: "draft" as const,
      metadata: { ...node.data.metadata, updatedAt: now, updatedBy: "Demo User" },
    },
  }));
  const copiedEdges = release.immutableSnapshot.edges.map((edge) => ({ ...edge, updatedAt: now }));
  const session = await getOrCreateProtocolSession(release.protocolId, "SESSION-03");
  await saveProtocolImport(
    { ...definition, currentVersion: input.version, status: "draft", updatedAt: now },
    {
      ...session,
      nodeIds: copiedNodes.map((node) => node.id),
      edgeIds: copiedEdges.map((edge) => edge.id),
      entryNodeId: copiedNodes.find((node) => node.type === "session_start")?.id ?? copiedNodes[0]?.id,
      completionNodeIds: copiedNodes.filter((node) => node.type === "session_complete").map((node) => node.id),
      updatedAt: now,
    },
    copiedNodes,
    copiedEdges,
    createAuditEntry({
      action: "Draft created from release",
      resource: releaseId,
      version: input.version,
      newValue: JSON.stringify({ basedOn: release.version, changeSummary: input.changeSummary }),
      reason: input.changeSummary,
    }),
  );
  return { version: input.version };
}

export async function getReleaseDiff(leftReleaseId: string, rightReleaseId: string) {
  const [left, right] = await Promise.all([getProtocolRelease(leftReleaseId), getProtocolRelease(rightReleaseId)]);
  if (!left || !right) throw new Error("Release not found");
  const leftNodes = new Map(left.immutableSnapshot.nodes.map((node) => [node.id, node]));
  const rightNodes = new Map(right.immutableSnapshot.nodes.map((node) => [node.id, node]));
  const leftEdges = new Map(left.immutableSnapshot.edges.map((edge) => [edge.id, edge]));
  const rightEdges = new Map(right.immutableSnapshot.edges.map((edge) => [edge.id, edge]));
  return {
    addedNodes: [...rightNodes.values()].filter((node) => !leftNodes.has(node.id)),
    removedNodes: [...leftNodes.values()].filter((node) => !rightNodes.has(node.id)),
    modifiedNodes: [...rightNodes.values()].filter((node) => {
      const previous = leftNodes.get(node.id);
      return previous && canonicalStringify(previous.data) !== canonicalStringify(node.data);
    }),
    addedEdges: [...rightEdges.values()].filter((edge) => !leftEdges.has(edge.id)),
    removedEdges: [...leftEdges.values()].filter((edge) => !rightEdges.has(edge.id)),
    modifiedEdges: [...rightEdges.values()].filter((edge) => {
      const previous = leftEdges.get(edge.id);
      return previous && canonicalStringify(previous) !== canonicalStringify(edge);
    }),
  };
}

export async function getSafetyRulesApi(filters?: { severity?: string; country?: string; active?: boolean }) {
  return safetyRules.filter((rule) => {
    if (filters?.severity && rule.severity.toLowerCase() !== filters.severity.toLowerCase()) return false;
    if (filters?.country && !rule.countries.includes(filters.country)) return false;
    if (typeof filters?.active === "boolean" && rule.active !== filters.active) return false;
    return true;
  });
}

export async function attachSafetyRuleToNode(nodeId: string, ruleId: string, reason = "Safety rule linked") {
  const [node, rule] = await Promise.all([getProtocolNode(nodeId), Promise.resolve(safetyRules.find((item) => item.id === ruleId))]);
  if (!node) throw new Error("Protocol node not found");
  assertMutableProtocol(node.protocolId);
  if (!rule) throw new Error("Safety rule not found");
  if (!rule.active) throw new Error("Inactive safety rule cannot be linked");
  if (rule.severity === "High" && !rule.escalation) throw new Error("High severity rule requires escalation target");
  return updateProtocolNodeApi(nodeId, {
    data: {
      ...node.data,
      safetyRuleIds: [...new Set([...node.data.safetyRuleIds, ruleId])],
    },
  }).then(async (updated) => {
    await updateProtocolNodeRepo(
      nodeId,
      updated,
      createAuditEntry({
        action: "Safety rule attached",
        resource: nodeId,
        version: "",
        newValue: JSON.stringify({ ruleId }),
        reason,
      }),
    ).catch(() => updated);
    return updated;
  });
}

export async function detachSafetyRuleFromNode(nodeId: string, ruleId: string, reason = "Safety rule removed") {
  const node = await getProtocolNode(nodeId);
  if (!node) throw new Error("Protocol node not found");
  assertMutableProtocol(node.protocolId);
  return updateProtocolNodeApi(nodeId, {
    data: {
      ...node.data,
      safetyRuleIds: node.data.safetyRuleIds.filter((item) => item !== ruleId),
    },
  });
}

export async function getSafetyRuleUsage(ruleId: string) {
  const graph = await getProtocolGraph("TBCT-BR-001", "SESSION-03");
  return graph.nodes.filter((node) => node.data.safetyRuleIds.includes(ruleId));
}

export async function previewCandidateImport(candidateId: string, protocolId = "TBCT-BR-001", sessionId = "SESSION-03") {
  const [candidate, existingGraph] = await Promise.all([getProtocolDraftCandidateApi(candidateId), getProtocolGraph(protocolId, sessionId)]);
  const resolvedCandidate: ProtocolDraftCandidate | undefined = candidate ?? (await getLocalDb().protocolDraftCandidates.orderBy("createdAt").last());
  if (!resolvedCandidate) throw new Error("Candidate not found");
  const warnings: ProtocolImportWarning[] = [];
  const existingTitles = new Set(existingGraph.nodes.map((node) => node.data.title.toLowerCase()));
  const createdNodeIds: string[] = [];
  const createdEdgeIds: string[] = [];
  const skippedItemIds: string[] = [];
  const conflictIds: string[] = [];

  for (const item of resolvedCandidate.items) {
    if (existingTitles.has(item.title.toLowerCase())) {
      warnings.push({ id: makeId("WRN"), severity: "warning", structuredItemId: item.structuredItemId, message: `Existing node with the same title: ${item.title}` });
      conflictIds.push(item.structuredItemId);
    }
    createdNodeIds.push(item.structuredItemId);
  }

  return {
    candidate: resolvedCandidate,
    protocolId,
    sessionId,
    warnings,
    createdNodeIds,
    createdEdgeIds,
    skippedItemIds,
    conflictIds,
  };
}

export async function importProtocolDraftCandidate(candidateId: string, protocolId = "TBCT-BR-001", sessionId = "SESSION-03"): Promise<ProtocolImportResult> {
  assertMutableProtocol(protocolId);
  const preview = await previewCandidateImport(candidateId, protocolId, sessionId);
  const definition =
    (await getProtocolDefinition(protocolId)) ??
    ({
      id: protocolId,
      projectId: "TBCT-BR-001",
      title: "TBCT Brazil Pilot Protocol",
      locale: "pt-BR",
      country: "BR",
      currentVersion: "0.4.0",
      status: "draft",
      sessionIds: [sessionId],
      globalSafetyRuleIds: [],
      runtimeSchemaVersion: "1.0",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as ProtocolDefinition);
  const candidateSessionId = preview.candidate.sessionId || sessionId;
  const now = new Date().toISOString();
  const existingSession = await getProtocolSession(candidateSessionId);
  const session: ProtocolSession = existingSession ?? {
    id: candidateSessionId,
    protocolId,
    title: candidateSessionId === "SESSION-03" ? "Session 03" : candidateSessionId,
    order: candidateSessionId === "SESSION-03" ? 3 : 1,
    goals: [],
    completionNodeIds: [],
    nodeIds: [],
    edgeIds: [],
    status: "draft",
    locale: definition?.locale ?? "pt-BR",
    createdAt: now,
    updatedAt: now,
  };

  const nodeIdByStructuredItemId = new Map<string, string>();
  const nodes: ProtocolGraphNode[] = preview.candidate.items
    .map((item, index) => {
      const nodeType = nodeTypeForMapping(item.proposedNodeType === "condition" ? "follow_up_branch" : item.proposedNodeType);
      const nodeId = `NODE-${makeId("P")}`;
      nodeIdByStructuredItemId.set(item.structuredItemId, nodeId);
      return {
        id: nodeId,
        protocolId,
        sessionId: candidateSessionId,
        type: nodeType,
        position: { x: 160 + (index % 3) * 280, y: 120 + Math.floor(index / 3) * 180 },
        data: {
          protocolNodeId: item.id,
          protocolId,
          sessionId: candidateSessionId,
          nodeType,
          title: item.title,
          clinicalIntent: item.content.slice(0, 160),
          content: item.content,
          required: true,
          status: "draft",
          sourceStructuredItemIds: [item.structuredItemId],
          sourceEvidenceIds: item.sourceEvidenceIds,
          safetyRuleIds: nodeType === "safety_check" ? ["GLOBAL-RISK-01"] : [],
          completionConditionIds: nodeType === "session_complete" ? [item.structuredItemId] : [],
          runtimeAction: runtimeActionForType(nodeType, item.content),
          metadata: {
            createdBy: "Demo User",
            createdAt: now,
            updatedBy: "Demo User",
            updatedAt: now,
            importedFromCandidateId: candidateId,
            importedFromSourceDraftId: preview.candidate.sourceDraftId,
          },
        },
      };
    });

  const edges: ProtocolGraphEdge[] = preview.candidate.items
    .flatMap((item) =>
      item.linkedItemIds.map((linkedId, linkedIndex) => ({
        id: `EDGE-${makeId("P")}`,
        protocolId,
        sessionId: candidateSessionId,
        source: nodeIdByStructuredItemId.get(item.structuredItemId) ?? "",
        target: nodeIdByStructuredItemId.get(linkedId) ?? "",
        edgeType: "conditional" as const,
        label: item.title,
        priority: linkedIndex + 1,
        isFallback: false,
        sourceStructuredItemId: item.structuredItemId,
        sourceEvidenceIds: item.sourceEvidenceIds,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .filter((edge: ProtocolGraphEdge) => edge.source && edge.target);

  const nextSession: ProtocolSession = {
    ...session,
    nodeIds: [...new Set([...(session.nodeIds ?? []), ...nodes.map((node) => node.id)])],
    edgeIds: [...new Set([...(session.edgeIds ?? []), ...edges.map((edge) => edge.id)])],
    entryNodeId: session.entryNodeId ?? nodes.find((node) => node.type === "session_start")?.id ?? nodes[0]?.id,
    completionNodeIds: [...new Set([...(session.completionNodeIds ?? []), ...nodes.filter((node) => node.type === "session_complete").map((node) => node.id)])],
    updatedAt: now,
  };

  await saveProtocolImport(
    { ...definition, updatedAt: now },
    nextSession,
    nodes,
    edges,
    createAuditEntry({
      action: "Candidate import",
      resource: candidateId,
      version: definition.currentVersion,
      newValue: JSON.stringify({ nodes: nodes.length, edges: edges.length }),
      reason: "Protocol draft candidate imported into graph",
    }),
  );

  return {
    candidateId,
    protocolId,
    sessionId: candidateSessionId,
    createdNodeIds: nodes.map((node) => node.id),
    createdEdgeIds: edges.map((edge) => edge.id),
    skippedItemIds: preview.skippedItemIds,
    conflictIds: preview.conflictIds,
    warnings: preview.warnings,
  };
}

export async function getProtocolGraphApi(protocolId = "TBCT-BR-001", sessionId = "SESSION-03") {
  if (isCanonicalProtocolId(protocolId)) {
    const canonicalSessionId = resolveCanonicalSessionId(sessionId);
    if (!canonicalSessionId) throw new Error(`Unknown canonical TBCT session: ${sessionId}`);
    const session = createCanonicalProtocolSession(canonicalSessionId);
    if (!session) throw new Error(`Canonical TBCT session is unavailable: ${canonicalSessionId}`);
    const [validationRun, releases] = await Promise.all([
      getValidationRun(CANONICAL_PROTOCOL_ID),
      getProtocolReleases(CANONICAL_PROTOCOL_ID),
    ]);
    return {
      definition: createCanonicalProtocolDefinition(),
      session,
      ...createCanonicalProtocolGraphSnapshot(canonicalSessionId),
      validationRun,
      releases,
    };
  }
  if (protocolId === "tbct-br-001" && sessionId === "tbct-br-001-session-03") {
    await importRealSession03();
  }
  const [definition, session, graph, validationRun, releases] = await Promise.all([
    getProtocolDefinition(protocolId),
    getOrCreateProtocolSession(protocolId, sessionId),
    getProtocolGraph(protocolId, sessionId),
    getValidationRun(protocolId),
    getProtocolReleases(protocolId),
  ]);
  return { definition, session, ...graph, validationRun, releases };
}

export async function updateProtocolNodeApi(nodeId: string, patch: Partial<ProtocolGraphNode>) {
  return updateProtocolNodeRepo(
    nodeId,
    patch,
    createAuditEntry({
      action: "Protocol node updated",
      resource: nodeId,
      version: "",
      newValue: JSON.stringify(patch),
      reason: "Node inspector edit",
    }),
  );
}

export async function updateProtocolEdgeApi(edgeId: string, patch: Partial<ProtocolGraphEdge>) {
  return updateProtocolEdgeRepo(
    edgeId,
    patch,
    createAuditEntry({
      action: "Protocol edge updated",
      resource: edgeId,
      version: "",
      newValue: JSON.stringify(patch),
      reason: "Edge edit",
    }),
  );
}

export async function runProtocolValidation(protocolId = "TBCT-BR-001", sessionId = "SESSION-03") {
  const canonicalProtocol = isCanonicalProtocolId(protocolId);
  const activeProtocolId = canonicalProtocol ? CANONICAL_PROTOCOL_ID : protocolId;
  const activeSessionId = canonicalProtocol ? resolveCanonicalSessionId(sessionId) ?? sessionId : sessionId;
  const { nodes, edges } = await getActiveProtocolGraph(protocolId, sessionId);
  const issues: ProtocolValidationIssue[] = [];
  const startNodes = nodes.filter((node) => node.type === "session_start");
  const endNodes = nodes.filter((node) => node.type === "session_complete");
  if (!startNodes.length) issues.push({ id: makeId("ISS"), protocolId: activeProtocolId, sessionId: activeSessionId, severity: "critical", category: "Graph Structure", message: "Session start node is missing." });
  if (!endNodes.length) issues.push({ id: makeId("ISS"), protocolId: activeProtocolId, sessionId: activeSessionId, severity: "critical", category: "Graph Structure", message: "Session complete node is missing." });
  for (const node of nodes) {
    if (node.data.required && !node.data.sourceEvidenceIds.length) {
      issues.push({ id: makeId("ISS"), protocolId: activeProtocolId, sessionId: activeSessionId, nodeId: node.id, severity: "critical", category: "Source Traceability", message: `${node.data.title} is missing source evidence.` });
    }
    if (!node.data.runtimeAction) {
      issues.push({ id: makeId("ISS"), protocolId: activeProtocolId, sessionId: activeSessionId, nodeId: node.id, severity: "warning", category: "Runtime Compatibility", message: `${node.data.title} is missing a runtime action.` });
    }
    if (node.type === "clinician_escalation" && !node.data.content?.toLowerCase().includes("escal")) {
      issues.push({ id: makeId("ISS"), protocolId: activeProtocolId, sessionId: activeSessionId, nodeId: node.id, severity: "warning", category: "Safety", message: `${node.data.title} does not describe escalation criteria.` });
    }
  }
  for (const edge of edges) {
    if (edge.edgeType === "conditional" && !edge.label) {
      issues.push({ id: makeId("ISS"), protocolId: activeProtocolId, sessionId: activeSessionId, edgeId: edge.id, severity: "information", category: "Branch Logic", message: "Conditional edge has no label." });
    }
  }
  if (canonicalProtocol) {
    for (const sourceIssue of getCanonicalSourceFidelityIssues()) {
      issues.push({ id: makeId("ISS"), protocolId: activeProtocolId, sessionId: activeSessionId, severity: "critical", category: "Source Fidelity", message: sourceIssue });
    }
    const runtimeCompilation = await compileRuntimeRelease({
      releaseId: "validation-preview",
      protocolId: activeProtocolId,
      version: "validation-preview",
      publishedAt: "1970-01-01T00:00:00.000Z",
      snapshot: getSessionBuilderDraftSnapshot(),
    });
    issues.push(...runtimeCompilation.issues.filter((issue) => !issue.sessionId || issue.sessionId === activeSessionId));
  }
  const run: ProtocolValidationRun = {
    id: makeId("VAL"),
    protocolId: activeProtocolId,
    executedAt: new Date().toISOString(),
    summary: {
      critical: issues.filter((issue) => issue.severity === "critical").length,
      warning: issues.filter((issue) => issue.severity === "warning").length,
      information: issues.filter((issue) => issue.severity === "information").length,
      passedChecks: Math.max(0, 6 - issues.length),
      sourceCoverage: nodes.length ? Math.round((nodes.filter((node) => node.data.sourceEvidenceIds.length > 0).length / nodes.length) * 100) : 0,
      runtimeCompatibility: issues.some((issue) => issue.category.startsWith("Runtime") && issue.severity === "critical") ? "blocked" : issues.some((issue) => issue.category.startsWith("Runtime")) ? "review" : "ready",
    },
    issues,
  };
  await saveValidationRun(
    run,
    createAuditEntry({
      action: "Validation run",
      resource: activeProtocolId,
      version: "",
      newValue: JSON.stringify(run.summary),
      reason: "Protocol graph validation",
    }),
  );
  return run;
}

export async function runRuntimeScenario(protocolId = "TBCT-BR-001", sessionId = "SESSION-03") {
  const canonicalProtocol = isCanonicalProtocolId(protocolId);
  const activeProtocolId = canonicalProtocol ? CANONICAL_PROTOCOL_ID : protocolId;
  const activeSessionId = canonicalProtocol ? resolveCanonicalSessionId(sessionId) ?? sessionId : sessionId;
  const { nodes, edges } = await getActiveProtocolGraph(protocolId, sessionId);
  const orderedNodes = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  let current: ProtocolGraphNode | null | undefined = orderedNodes.find((node) => node.type === "session_start") ?? orderedNodes[0];
  const steps: RuntimeExecutionLog["steps"] = [];
  const visited = new Set<string>();
  while (current && !visited.has(current.id) && steps.length < 20) {
    const activeNode: ProtocolGraphNode = current;
    visited.add(activeNode.id);
    const outgoing: ProtocolGraphEdge[] = edges.filter((edge: ProtocolGraphEdge) => edge.source === activeNode.id).sort((a, b) => a.priority - b.priority);
    const selectedEdge: ProtocolGraphEdge | undefined = outgoing[0];
    steps.push({
      nodeId: activeNode.id,
      actionType: activeNode.data.runtimeAction?.actionType,
      selectedEdgeId: selectedEdge?.id,
      nextNodeId: selectedEdge?.target,
      conditionSummary: outgoing.map((edge) => edge.label ?? edge.edgeType),
    });
    const nextNode: ProtocolGraphNode | undefined = selectedEdge ? nodes.find((node) => node.id === selectedEdge.target) : undefined;
    current = nextNode ?? null;
  }
  const log: RuntimeExecutionLog = {
    id: makeId("RUN"),
    protocolId: activeProtocolId,
    sessionId: activeSessionId,
    startedAt: new Date().toISOString(),
    steps,
  };
  await saveRuntimeExecutionLog(
    log,
    createAuditEntry({
      action: "Runtime preview run",
      resource: activeProtocolId,
      version: "",
      newValue: JSON.stringify({ steps: steps.length }),
      reason: "Deterministic runtime simulation",
    }),
  );
  return log;
}

export interface ReleasePackageRuntimeOptions {
  releaseId?: string;
  publishedAt?: string;
  sourceFidelitySnapshot?: SourceFidelityReleaseSnapshot;
  runtimeRelease?: RuntimeRelease;
  runtimeIssues?: ProtocolValidationIssue[];
}

function mergeRuntimeValidationIssues(validationRun: ProtocolValidationRun, runtimeIssues: ProtocolValidationIssue[]) {
  const issues = [...validationRun.issues, ...runtimeIssues];
  return {
    ...validationRun,
    issues,
    summary: {
      ...validationRun.summary,
      critical: issues.filter((issue) => issue.severity === "critical").length,
      warning: issues.filter((issue) => issue.severity === "warning").length,
      information: issues.filter((issue) => issue.severity === "information").length,
      passedChecks: Math.max(0, validationRun.summary.passedChecks - runtimeIssues.length),
      runtimeCompatibility: issues.some((issue) => issue.severity === "critical" && issue.category.startsWith("Runtime"))
        ? "blocked"
        : issues.some((issue) => issue.category.startsWith("Runtime"))
          ? "review"
          : validationRun.summary.runtimeCompatibility,
    },
  } satisfies ProtocolValidationRun;
}

export async function previewReleasePackage(protocolId = "TBCT-BR-001", targetEnvironment: "development" | "staging" | "pilot" = "pilot", version = "0.4.0", changeSummary = "Local release preview", options: ReleasePackageRuntimeOptions = {}) {
  const canonicalProtocol = isCanonicalProtocolId(protocolId);
  const activeProtocolId = canonicalProtocol ? CANONICAL_PROTOCOL_ID : protocolId;
  const canonicalReleaseSnapshot = canonicalProtocol ? createCanonicalProtocolReleaseSnapshot() : undefined;
  const canonicalSnapshot = canonicalReleaseSnapshot
    ? { ...canonicalReleaseSnapshot, sourceFidelity: options.sourceFidelitySnapshot ?? canonicalReleaseSnapshot.sourceFidelity }
    : undefined;
  const [definition, graph, validationRun] = canonicalProtocol
    ? [
        createCanonicalProtocolDefinition(version),
        { nodes: canonicalSnapshot!.nodes, edges: canonicalSnapshot!.edges },
        await getValidationRun(activeProtocolId),
      ]
    : await Promise.all([
        getOrCreateProtocolDefinition(activeProtocolId, version),
        getProtocolGraph(activeProtocolId, "SESSION-03"),
        getValidationRun(activeProtocolId),
      ]);
  if (!validationRun) throw new Error("Run validation before building a release package");
  const mergedValidationRun = mergeRuntimeValidationIssues(validationRun, options.runtimeIssues ?? []);
  if (mergedValidationRun.summary.critical > 0) throw new Error("Critical validation issues block release");

  const sessions = canonicalSnapshot
    ? canonicalSnapshot.sourceFidelity.sessionDefinitions.map((session) => ({
        sessionId: session.id,
        title: session.title,
        order: session.number,
        goals: [session.sessionObjective],
        entryNodeId: session.startNodeId,
        completionNodeIds: [session.completionNodeId],
        nodes: graph.nodes.filter((node) => node.sessionId === session.id).map((node) => ({
          nodeId: node.id,
          nodeType: node.type,
          required: node.data.required,
          clinicalIntent: node.data.clinicalIntent,
          runtimeAction: node.data.runtimeAction,
          safetyRuleIds: node.data.safetyRuleIds,
          sourceEvidenceIds: node.data.sourceEvidenceIds,
          promptItemIds: node.data.promptItemIds,
        })),
        edges: graph.edges.filter((edge) => edge.sessionId === session.id).map((edge) => ({
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
          edgeType: edge.edgeType,
          condition: edge.condition,
          priority: edge.priority,
          fallback: edge.isFallback,
        })),
      }))
    : [
        {
          sessionId: "SESSION-03",
          title: "Session 03",
          order: 3,
          goals: [],
          entryNodeId: graph.nodes.find((node) => node.type === "session_start")?.id,
          completionNodeIds: graph.nodes.filter((node) => node.type === "session_complete").map((node) => node.id),
          nodes: graph.nodes.map((node) => ({
            nodeId: node.id,
            nodeType: node.type,
            required: node.data.required,
            clinicalIntent: node.data.clinicalIntent,
            runtimeAction: node.data.runtimeAction,
            safetyRuleIds: node.data.safetyRuleIds,
            sourceEvidenceIds: node.data.sourceEvidenceIds,
          })),
          edges: graph.edges.map((edge) => ({
            edgeId: edge.id,
            source: edge.source,
            target: edge.target,
            edgeType: edge.edgeType,
            condition: edge.condition,
            priority: edge.priority,
            fallback: edge.isFallback,
          })),
        },
      ];

  const protocolJsonBase = {
    schemaVersion: "1.0",
    protocolId: activeProtocolId,
    protocolVersion: version,
    runtimeSchemaVersion: definition.runtimeSchemaVersion,
    locale: definition.locale,
    country: definition.country,
    status: "published",
    checksum: "",
    sessions,
    safetyRules: graph.nodes.filter((node) => node.type === "safety_check").map((node) => node.data.safetyRuleIds).flat(),
    ...(options.runtimeRelease ? {
      runtimeRelease: {
        id: options.runtimeRelease.id,
        schemaVersion: options.runtimeRelease.schemaVersion,
        contentHash: options.runtimeRelease.contentHash,
      },
    } : {}),
    sourceFidelity: canonicalSnapshot
      ? {
          sourceVersion: canonicalSnapshot.sourceFidelity.sourceVersion,
          sourceTextHash: canonicalSnapshot.sourceFidelity.sourceTextHash,
        }
      : undefined,
    metadata: {
      authoredBy: ["Demo User"],
      reviewedBy: ["Clinical Reviewer"],
      approvedBy: ["Clinical Reviewer"],
      compiledAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
    },
  };
  const protocolChecksum = await sha256(canonicalStringify(protocolJsonBase));
  const protocolJson = { ...protocolJsonBase, checksum: protocolChecksum };

  const sourceManifest = {
    protocolId: activeProtocolId,
    protocolVersion: version,
    sourceVersion: canonicalSnapshot?.sourceFidelity.sourceVersion,
    sourceTextHash: canonicalSnapshot?.sourceFidelity.sourceTextHash,
    evidence: graph.nodes.flatMap((node) =>
      node.data.sourceEvidenceIds.map((evidenceId) => ({
        sourceEvidenceId: evidenceId,
        nodeId: node.id,
        structuredItemIds: node.data.sourceStructuredItemIds,
      })),
    ),
  };
  const validationReport = mergedValidationRun;
  const changeLog = {
    addedNodes: graph.nodes.map((node) => node.id),
    modifiedNodes: [],
    removedNodes: [],
    addedEdges: graph.edges.map((edge) => edge.id),
    modifiedEdges: [],
    removedEdges: [],
    changeSummary,
  };
  const releaseManifest = {
    releaseId: options.releaseId ?? makeId("REL"),
    protocolId: activeProtocolId,
    protocolVersion: version,
    schemaVersion: "1.0",
    runtimeSchemaVersion: definition.runtimeSchemaVersion,
    targetEnvironment,
    compiledBy: "Demo User",
    createdAt: options.publishedAt ?? new Date().toISOString(),
  };

  const files = {
    "protocol.json": JSON.stringify(protocolJson, null, 2),
    "source-manifest.json": JSON.stringify(sourceManifest, null, 2),
    "validation-report.json": JSON.stringify(validationReport, null, 2),
    "change-log.json": JSON.stringify(changeLog, null, 2),
    "release-manifest.json": JSON.stringify(releaseManifest, null, 2),
    ...(canonicalSnapshot ? { "source-fidelity.json": JSON.stringify(canonicalSnapshot.sourceFidelity, null, 2) } : {}),
    ...(options.runtimeRelease ? { "runtime-release.json": JSON.stringify(options.runtimeRelease, null, 2) } : {}),
  };
  const fileChecksums: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) fileChecksums[name] = await sha256(content);
  const packageChecksum = await sha256(canonicalStringify(fileChecksums));
  return { files, packageChecksum, fileChecksums, validationRun: mergedValidationRun };
}

export async function publishProtocolRelease(protocolId = "TBCT-BR-001", input: { version: string; targetEnvironment: "development" | "staging" | "pilot"; changeSummary: string }) {
  const canonicalProtocol = isCanonicalProtocolId(protocolId);
  const activeProtocolId = canonicalProtocol ? CANONICAL_PROTOCOL_ID : protocolId;
  if (canonicalProtocol && getCanonicalSourceFidelityIssues().length) {
    throw new Error("Canonical source-fidelity validation issues block release");
  }
  const definition = canonicalProtocol
    ? createCanonicalProtocolDefinition(input.version)
    : (await getProtocolDefinition(activeProtocolId)) ?? createDefaultProtocolDefinition(activeProtocolId, input.version);
  if (canonicalProtocol) await getLocalDb().protocolDefinitions.put(definition);
  const existing = await getProtocolReleases(activeProtocolId);
  if (existing.some((release) => release.version === input.version)) throw new Error("Protocol version already exists");
  const releaseId = makeId("VER");
  const publishedAt = new Date().toISOString();
  const sourceFidelitySnapshot = canonicalProtocol ? getSessionBuilderDraftSnapshot() : undefined;
  const runtimeCompilation = sourceFidelitySnapshot
    ? await compileRuntimeRelease({
        releaseId,
        protocolId: activeProtocolId,
        version: input.version,
        publishedAt,
        snapshot: sourceFidelitySnapshot,
      })
    : undefined;
  const preview = await previewReleasePackage(activeProtocolId, input.targetEnvironment, input.version, input.changeSummary, {
    releaseId,
    publishedAt,
    sourceFidelitySnapshot,
    runtimeRelease: runtimeCompilation?.runtimeRelease,
    runtimeIssues: runtimeCompilation?.issues,
  });
  const pkg: ProtocolReleasePackage = {
    id: makeId("PKG"),
    protocolId: activeProtocolId,
    protocolVersion: input.version,
    targetEnvironment: input.targetEnvironment,
    packageChecksum: preview.packageChecksum,
    files: preview.fileChecksums,
    generatedAt: publishedAt,
    generatedBy: "Demo User",
  };
  const immutableSnapshot = canonicalProtocol
    ? {
        ...createCanonicalProtocolReleaseSnapshot(),
        sourceFidelity: sourceFidelitySnapshot!,
        runtimeRelease: runtimeCompilation!.runtimeRelease,
      }
    : await getProtocolGraph(activeProtocolId, "SESSION-03");
  const release: ProtocolReleaseVersion = {
    id: releaseId,
    protocolId: activeProtocolId,
    version: input.version,
    releasePackageId: pkg.id,
    publishedAt,
    publishedBy: "Demo User",
    changeSummary: input.changeSummary,
    immutableSnapshot: canonicalProtocol
      ? immutableSnapshot
      : {
          nodes: immutableSnapshot.nodes.map((node) => ({ ...node, data: { ...node.data, status: "published" } })),
          edges: immutableSnapshot.edges,
        },
  };
  await saveReleasePackage(
    pkg,
    release,
    createAuditEntry({
      action: "Protocol publish",
      resource: activeProtocolId,
      version: input.version,
      newValue: JSON.stringify({ packageChecksum: pkg.packageChecksum, targetEnvironment: input.targetEnvironment }),
      reason: input.changeSummary,
    }),
  );
  return { pkg, release, files: preview.files };
}

export async function downloadProtocolReleasePackage(releaseId: string) {
  const release = await getProtocolRelease(releaseId);
  if (!release) throw new Error("Release not found");
  const pkg = await getReleasePackage(release.releasePackageId);
  if (!pkg) throw new Error("Release package not found");
  const preview = await previewReleasePackage(release.protocolId, pkg.targetEnvironment, release.version, release.changeSummary, {
    releaseId: release.id,
    publishedAt: release.publishedAt,
    sourceFidelitySnapshot: release.immutableSnapshot.sourceFidelity,
    runtimeRelease: release.immutableSnapshot.runtimeRelease,
  });
  const zip = new JSZip();
  const folder = zip.folder(`${release.protocolId}-v${release.version}`);
  if (!folder) throw new Error("Failed to create zip folder");
  for (const [name, content] of Object.entries(preview.files)) folder.file(name, content);
  return zip.generateAsync({ type: "blob" });
}
