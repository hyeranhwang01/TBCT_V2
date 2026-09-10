import type { ConditionExpression } from "@/shared/protocol/source-fidelity-types";
import { isPatientSafeFallbackText, normalizeRuntimeReleaseFromSourceSnapshot } from "@/shared/runtime/runtime-release-normalizer";
import type { ProtocolValidationIssue, RuntimeRelease, RuntimeTransitionRule, SourceFidelityReleaseSnapshot } from "@/types/protocol-runtime";

export type RuntimeReleaseCompileInput = {
  releaseId: string;
  protocolId: string;
  version: string;
  publishedAt: string;
  snapshot: SourceFidelityReleaseSnapshot;
};

export type RuntimeReleaseCompileResult = {
  runtimeRelease: RuntimeRelease;
  issues: ProtocolValidationIssue[];
};

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(text: string) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33) ^ text.charCodeAt(index);
  return `fallback-${(hash >>> 0).toString(16)}`;
}

function issue(input: Omit<ProtocolValidationIssue, "id">): ProtocolValidationIssue {
  return {
    ...input,
    id: `runtime-${input.category.toLowerCase().replace(/\W+/g, "-")}-${input.nodeId ?? input.edgeId ?? input.message.toLowerCase().replace(/\W+/g, "-").slice(0, 32)}`,
  };
}

function conditionHasLimit(condition: ConditionExpression | undefined) {
  return Boolean(condition && condition.kind !== "always" && condition.field);
}

function findReachableNodeIds(release: RuntimeRelease, initialNodeIds: string[]) {
  const reachable = new Set<string>();
  const pending = [...initialNodeIds];
  while (pending.length) {
    const nodeId = pending.shift();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = release.nodes.find((item) => item.id === nodeId);
    for (const transition of node?.transitionRules ?? []) pending.push(transition.targetNodeId);
  }
  return reachable;
}

function transitionHasLoop(transitions: RuntimeTransitionRule[], nodeId: string) {
  return transitions.some((transition) => transition.targetNodeId === nodeId);
}

export function validateRuntimeRelease(release: RuntimeRelease, snapshot: SourceFidelityReleaseSnapshot): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];
  const nodesById = new Map(release.nodes.map((node) => [node.id, node]));
  const promptsById = new Map(release.promptItems.map((promptItem) => [promptItem.id, promptItem]));
  const rolesById = new Map(release.roles.map((role) => [role.id, role]));
  const sessionIds = new Set(snapshot.sessionDefinitions.map((session) => session.id));

  if (!release.policies.globalSafetyRules.length) {
    issues.push(issue({ protocolId: release.protocolId, severity: "critical", category: "Runtime Safety", message: "Runtime release is missing a global safety policy." }));
  }

  for (const sessionId of sessionIds) {
    const sessionNodes = release.nodes.filter((node) => node.sessionId === sessionId);
    const sourceNodes = snapshot.clinicalStageNodes.filter((node) => node.sessionId === sessionId);
    const startNodeIds = sourceNodes.filter((node) => node.type === "session_start").map((node) => node.id);
    const terminalNodeIds = sourceNodes.filter((node) => node.type === "session_complete").map((node) => node.id);
    if (!startNodeIds.length) {
      issues.push(issue({ protocolId: release.protocolId, sessionId, severity: "critical", category: "Runtime Graph", message: "Session is missing a start node." }));
    }
    if (!terminalNodeIds.length) {
      issues.push(issue({ protocolId: release.protocolId, sessionId, severity: "critical", category: "Runtime Graph", message: "Session is missing a terminal node." }));
    }
    const reachable = findReachableNodeIds(release, startNodeIds);
    for (const node of sessionNodes) {
      if (!reachable.has(node.id)) {
        issues.push(issue({ protocolId: release.protocolId, sessionId, nodeId: node.id, severity: "critical", category: "Runtime Graph", message: `${node.title} is unreachable from the session start node.` }));
      }
    }
  }

  for (const node of release.nodes) {
    const nodeRole = rolesById.get(node.speakerRoleId);
    if (!nodeRole || nodeRole.kind !== "speaker") {
      issues.push(issue({ protocolId: release.protocolId, sessionId: node.sessionId, nodeId: node.id, severity: "critical", category: "Runtime Role", message: `${node.title} is missing a valid speaker role.` }));
    }
    if (!node.objective.trim()) {
      issues.push(issue({ protocolId: release.protocolId, sessionId: node.sessionId, nodeId: node.id, severity: "critical", category: "Runtime Node", message: `${node.title} is missing an objective.` }));
    }
    if (!conditionHasLimit(node.completionCondition)) {
      issues.push(issue({ protocolId: release.protocolId, sessionId: node.sessionId, nodeId: node.id, severity: "critical", category: "Runtime Node", message: `${node.title} is missing a deterministic completion condition.` }));
    }
    if (transitionHasLoop(node.transitionRules, node.id) && node.maxNodeIterations < 1) {
      issues.push(issue({ protocolId: release.protocolId, sessionId: node.sessionId, nodeId: node.id, severity: "critical", category: "Runtime Graph", message: `${node.title} contains an unbounded loop.` }));
    }
    for (const transition of node.transitionRules) {
      if (!nodesById.has(transition.targetNodeId)) {
        issues.push(issue({ protocolId: release.protocolId, sessionId: node.sessionId, nodeId: node.id, edgeId: transition.id, severity: "critical", category: "Runtime Graph", message: `${node.title} has a transition to a missing node.` }));
      }
    }
    const sequenceIndexes = new Set<number>();
    for (const promptItemId of node.promptSequence) {
      const promptItem = promptsById.get(promptItemId);
      if (!promptItem) {
        issues.push(issue({ protocolId: release.protocolId, sessionId: node.sessionId, nodeId: node.id, severity: "critical", category: "Runtime Prompt", message: `${node.title} references a missing PromptItem.` }));
        continue;
      }
      if (sequenceIndexes.has(promptItem.sequenceIndex)) {
        issues.push(issue({ protocolId: release.protocolId, sessionId: node.sessionId, nodeId: node.id, severity: "critical", category: "Runtime Prompt", message: `${node.title} has duplicate PromptItem sequence indexes.` }));
      }
      sequenceIndexes.add(promptItem.sequenceIndex);
    }
  }

  for (const promptItem of release.promptItems) {
    const node = nodesById.get(promptItem.nodeId);
    const role = rolesById.get(promptItem.roleId);
    if (!node) {
      issues.push(issue({ protocolId: release.protocolId, nodeId: promptItem.nodeId, severity: "critical", category: "Runtime Prompt", message: `PromptItem ${promptItem.id} is not assigned to a node.` }));
    }
    if (!role || role.kind !== "speaker") {
      issues.push(issue({ protocolId: release.protocolId, nodeId: promptItem.nodeId, severity: "critical", category: "Runtime Role", message: `PromptItem ${promptItem.id} is missing a valid speaker role.` }));
    }
    if (!promptItem.modelGuidance.trim()) {
      issues.push(issue({ protocolId: release.protocolId, nodeId: promptItem.nodeId, severity: "critical", category: "Runtime Prompt", message: `PromptItem ${promptItem.id} is missing model guidance.` }));
    }
    if (!isPatientSafeFallbackText(promptItem.fallbackPatientText)) {
      issues.push(issue({ protocolId: release.protocolId, nodeId: promptItem.nodeId, severity: "critical", category: "Runtime Prompt", message: `PromptItem ${promptItem.id} is missing a patient-safe fallback.` }));
    }
    if (!conditionHasLimit(promptItem.completionCondition)) {
      issues.push(issue({ protocolId: release.protocolId, nodeId: promptItem.nodeId, severity: "critical", category: "Runtime Prompt", message: `PromptItem ${promptItem.id} is missing a completion condition.` }));
    }
    if (!promptItem.outputSchemaVersion.trim()) {
      issues.push(issue({ protocolId: release.protocolId, nodeId: promptItem.nodeId, severity: "critical", category: "Runtime Prompt", message: `PromptItem ${promptItem.id} is missing an output schema.` }));
    }
    if (promptItem.executionMode === "repeat_until" && !promptItem.maxIterations) {
      issues.push(issue({ protocolId: release.protocolId, nodeId: promptItem.nodeId, severity: "critical", category: "Runtime Prompt", message: `PromptItem ${promptItem.id} repeats without a maximum iteration limit.` }));
    }
    const promptSize = promptItem.modelGuidance.length + promptItem.fallbackPatientText.length + promptItem.allowedActions.join(" ").length + promptItem.forbiddenActions.join(" ").length;
    if (promptSize > release.policies.maxPromptCharacters) {
      issues.push(issue({ protocolId: release.protocolId, nodeId: promptItem.nodeId, severity: "critical", category: "Runtime Token Budget", message: `PromptItem ${promptItem.id} exceeds the runtime prompt budget.` }));
    }
  }

  return issues;
}

export async function compileRuntimeRelease(input: RuntimeReleaseCompileInput): Promise<RuntimeReleaseCompileResult> {
  const provisional = normalizeRuntimeReleaseFromSourceSnapshot({
    releaseId: input.releaseId,
    protocolId: input.protocolId,
    version: input.version,
    publishedAt: input.publishedAt,
    snapshot: input.snapshot,
    contentHash: "",
  });
  const contentHash = await sha256(canonicalStringify({ ...provisional, contentHash: "" }));
  const runtimeRelease = { ...provisional, contentHash };
  return { runtimeRelease, issues: validateRuntimeRelease(runtimeRelease, input.snapshot) };
}
