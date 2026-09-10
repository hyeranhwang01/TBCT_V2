import type { ConditionExpression } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeNode, RuntimePromptItem, RuntimeRelease, RuntimeRoleDefinition } from "@/types/protocol-runtime";
import type { RuntimeSessionState } from "@/types/runtime-session";

export type RuntimeActiveStep = {
  node: RuntimeNode;
  promptItem: RuntimePromptItem;
  role: RuntimeRoleDefinition;
  promptIndex: number;
  skippedPromptItemIds: string[];
};

function fieldValue(field: string, state: RuntimeSessionState, flags: Record<string, unknown>) {
  if (field in flags) return flags[field];
  if (field in state.fields) return state.fields[field];
  if (field.startsWith("fields.")) return state.fields[field.slice("fields.".length)];
  if (field === "turnCount") return state.turnCount;
  if (field === "nodeIterationCount") return state.nodeIterationCount;
  return undefined;
}

export function evaluateRuntimeCondition(condition: ConditionExpression | undefined, state: RuntimeSessionState, flags: Record<string, unknown> = {}) {
  if (!condition || condition.kind === "always") return true;
  if (!condition.field || !condition.operator) return false;
  const actual = fieldValue(condition.field, state, flags);
  switch (condition.operator) {
    case "equals":
      return actual === condition.value;
    case "not_equals":
      return actual !== condition.value;
    case "contains":
      return typeof actual === "string" && typeof condition.value === "string"
        ? actual.includes(condition.value)
        : Array.isArray(actual) ? actual.includes(condition.value as never) : false;
    case "greater_than":
      return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "less_than":
      return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(actual as never);
    default:
      return false;
  }
}

export function getRuntimeNodePromptItems(release: RuntimeRelease, node: RuntimeNode) {
  const promptItemsById = new Map(release.promptItems.map((promptItem) => [promptItem.id, promptItem]));
  return node.promptSequence
    .map((promptItemId) => promptItemsById.get(promptItemId))
    .filter((promptItem): promptItem is RuntimePromptItem => Boolean(promptItem))
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex || left.id.localeCompare(right.id));
}

export function resolveNextRuntimePrompt(input: {
  release: RuntimeRelease;
  node: RuntimeNode;
  state: RuntimeSessionState;
  startIndex?: number;
}) {
  const completedPromptItemIds = new Set(input.state.completedPromptItemIds);
  const promptItems = getRuntimeNodePromptItems(input.release, input.node);
  const skippedPromptItemIds: string[] = [];
  for (let index = input.startIndex ?? 0; index < promptItems.length; index += 1) {
    const promptItem = promptItems[index];
    if (completedPromptItemIds.has(promptItem.id)) continue;
    if (!evaluateRuntimeCondition(promptItem.activationCondition, input.state)) {
      skippedPromptItemIds.push(promptItem.id);
      continue;
    }
    return { promptItem, promptIndex: index, skippedPromptItemIds };
  }
  return { promptItem: null, promptIndex: -1, skippedPromptItemIds };
}

export function resolveActiveRuntimeStep(release: RuntimeRelease, state: RuntimeSessionState): RuntimeActiveStep | null {
  const node = release.nodes.find((item) => item.id === state.activeNodeId);
  if (!node || !evaluateRuntimeCondition(node.entryCondition, state)) return null;
  const promptItems = getRuntimeNodePromptItems(release, node);
  const requestedIndex = state.activePromptItemId ? promptItems.findIndex((item) => item.id === state.activePromptItemId) : state.activePromptIndex;
  const next = resolveNextRuntimePrompt({ release, node, state, startIndex: Math.max(0, requestedIndex) });
  if (!next.promptItem) return null;
  const role = release.roles.find((item) => item.id === next.promptItem.roleId);
  if (!role || role.kind !== "speaker") throw new Error(`PromptItem ${next.promptItem.id} does not resolve to an active speaker role.`);
  return { node, promptItem: next.promptItem, role, promptIndex: next.promptIndex, skippedPromptItemIds: next.skippedPromptItemIds };
}
