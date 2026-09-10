import type { RuntimeRelease, RuntimeTransitionRule } from "@/types/protocol-runtime";
import type { RuntimeSessionState } from "@/types/runtime-session";
import { evaluateRuntimeCondition, resolveNextRuntimePrompt, type RuntimeActiveStep } from "@/shared/runtime/runtime-step-resolver";

export type RuntimeStateReduction = {
  state: RuntimeSessionState;
  transitionDecision: "waiting_for_input" | "next_prompt" | "next_node" | "complete_session";
  nextNodeId?: string;
  nextPromptItemId?: string;
  skippedPromptItemIds: string[];
};

function unique(values: string[]) {
  return [...new Set(values)];
}

function cloneState(state: RuntimeSessionState): RuntimeSessionState {
  return {
    ...state,
    completedNodeIds: [...state.completedNodeIds],
    completedPromptItemIds: [...state.completedPromptItemIds],
    fields: { ...state.fields },
    promptIterationCounts: { ...(state.promptIterationCounts ?? {}) },
  };
}

export function reduceRuntimeState(input: {
  release: RuntimeRelease;
  currentState: RuntimeSessionState;
  activeStep: RuntimeActiveStep;
  // Phase 3 (runtime orchestration simplification): "patient_state_corrected"
  // is a distinct patient turn from "patient_input_accepted" -- the
  // participant corrected the runtime's state (e.g. "this isn't a goal,
  // remove it"), not answered the active question. It persists
  // confirmedFields and evaluates completion exactly like an accepted
  // answer (a correction can legitimately finish a repeat_until rating loop
  // when the corrected list has no unrated items left -- see
  // runtime-context.ts's applyCurrentRatingItemCorrection), but it must
  // NEVER consume the repeat_until iteration budget or be counted as "one
  // more rating given": the iteration-increment block below deliberately
  // still checks `=== "patient_input_accepted"` only.
  event: "assistant_delivered" | "patient_input_accepted" | "patient_state_corrected";
  confirmedFields?: Record<string, unknown>;
}): RuntimeStateReduction {
  const state = cloneState(input.currentState);
  if (input.confirmedFields) state.fields = { ...state.fields, ...input.confirmedFields };
  state.turnCount += 1;
  state.activeNodeId = input.activeStep.node.id;
  state.activePromptItemId = input.activeStep.promptItem.id;
  state.activePromptIndex = input.activeStep.promptIndex;

  const isPatientTurn = input.event === "patient_input_accepted" || input.event === "patient_state_corrected";
  const completionFlags = isPatientTurn
    ? { "turn.patient_input_validated": true }
    : { "turn.assistant_message_delivered": true };
  if (input.event === "patient_input_accepted" && input.activeStep.promptItem.executionMode === "repeat_until") {
    state.nodeIterationCount += 1;
    // The repeat budget must be per-prompt: nodeIterationCount is shared by
    // every prompt in the node, so a second repeat_until prompt in the same
    // node would inherit the first loop's spent iterations and force-complete
    // almost immediately (S07 Step 1's two lists, S08 Step 12's surrebuttal +
    // "Therefore" loops).
    const counts = state.promptIterationCounts ?? {};
    counts[input.activeStep.promptItem.id] = (counts[input.activeStep.promptItem.id] ?? 0) + 1;
    state.promptIterationCounts = counts;
  }
  const completionConditionMet = evaluateRuntimeCondition(input.activeStep.promptItem.completionCondition, state, completionFlags);
  const repeatIterations = state.promptIterationCounts
    ? state.promptIterationCounts[input.activeStep.promptItem.id] ?? 0
    : state.nodeIterationCount;
  const repeatLimitReached = input.activeStep.promptItem.executionMode === "repeat_until"
    && repeatIterations >= (input.activeStep.promptItem.maxIterations ?? 1);
  const promptComplete = completionConditionMet && (isPatientTurn || !input.activeStep.promptItem.requiresPatientInput)
    || repeatLimitReached;
  if (!promptComplete) {
    return {
      state,
      transitionDecision: "waiting_for_input",
      nextPromptItemId: input.activeStep.promptItem.id,
      skippedPromptItemIds: input.activeStep.skippedPromptItemIds,
    };
  }

  state.completedPromptItemIds = unique([...state.completedPromptItemIds, input.activeStep.promptItem.id, ...input.activeStep.skippedPromptItemIds]);
  const nextPrompt = resolveNextRuntimePrompt({
    release: input.release,
    node: input.activeStep.node,
    state,
    startIndex: input.activeStep.promptIndex + 1,
  });
  state.completedPromptItemIds = unique([...state.completedPromptItemIds, ...nextPrompt.skippedPromptItemIds]);
  if (nextPrompt.promptItem) {
    state.activePromptItemId = nextPrompt.promptItem.id;
    state.activePromptIndex = nextPrompt.promptIndex;
    return {
      state,
      transitionDecision: "next_prompt",
      nextPromptItemId: nextPrompt.promptItem.id,
      skippedPromptItemIds: unique([...input.activeStep.skippedPromptItemIds, ...nextPrompt.skippedPromptItemIds]),
    };
  }

  state.completedNodeIds = unique([...state.completedNodeIds, input.activeStep.node.id]);
  if (!evaluateRuntimeCondition(input.activeStep.node.completionCondition, state, { "node.all_prompt_items_completed": true })) {
    state.activePromptItemId = undefined;
    return { state, transitionDecision: "complete_session", skippedPromptItemIds: input.activeStep.skippedPromptItemIds };
  }
  const transitions = [...input.activeStep.node.transitionRules].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  const matchingTransitions = transitions.filter((transition) => evaluateRuntimeCondition(transition.condition, state));
  let selectedTransition: RuntimeTransitionRule | undefined = matchingTransitions[0] ?? transitions.find((transition) => transition.isFallback);
  if (selectedTransition?.targetNodeId === input.activeStep.node.id && state.nodeIterationCount + 1 > input.activeStep.node.maxNodeIterations) {
    selectedTransition = matchingTransitions.find((transition) => transition.targetNodeId !== input.activeStep.node.id)
      ?? transitions.find((transition) => transition.isFallback && transition.targetNodeId !== input.activeStep.node.id);
  }
  if (!selectedTransition) {
    state.activePromptItemId = undefined;
    return { state, transitionDecision: "complete_session", skippedPromptItemIds: input.activeStep.skippedPromptItemIds };
  }

  const nextNode = input.release.nodes.find((node) => node.id === selectedTransition.targetNodeId);
  if (!nextNode) {
    state.activePromptItemId = undefined;
    return { state, transitionDecision: "complete_session", skippedPromptItemIds: input.activeStep.skippedPromptItemIds };
  }
  state.activeNodeId = nextNode.id;
  state.activePromptItemId = nextNode.promptSequence[0];
  state.activePromptIndex = 0;
  state.nodeIterationCount = nextNode.id === input.activeStep.node.id ? state.nodeIterationCount + 1 : 0;
  return {
    state,
    transitionDecision: "next_node",
    nextNodeId: nextNode.id,
    nextPromptItemId: state.activePromptItemId,
    skippedPromptItemIds: input.activeStep.skippedPromptItemIds,
  };
}
