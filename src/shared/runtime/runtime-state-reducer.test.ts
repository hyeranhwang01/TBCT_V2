import { describe, expect, it } from "vitest";
import { reduceRuntimeState } from "@/shared/runtime/runtime-state-reducer";
import { resolveActiveRuntimeStep } from "@/shared/runtime/runtime-step-resolver";
import type { RuntimeRelease } from "@/types/protocol-runtime";
import type { RuntimeSessionState } from "@/types/runtime-session";

const release: RuntimeRelease = {
  id: "release-repeat",
  protocolId: "tbct-br-001",
  version: "1.0.0",
  schemaVersion: "runtime-release/v1",
  contentHash: "hash",
  publishedAt: "2025-01-01T00:00:00.000Z",
  roles: [{ id: "tbct_guide", name: "TBCT guide", kind: "speaker", systemGuidance: "Guide one step.", allowedActions: ["ask"], forbiddenActions: ["change_runtime_state"] }],
  policies: { globalSafetyRules: ["Keep the patient safe."], protocolRules: [], forbiddenPatientContent: [], maxPromptCharacters: 12000 },
  nodes: [{
    id: "node-repeat",
    sessionId: "session-1",
    title: "Repeat step",
    objective: "Collect a response.",
    speakerRoleId: "tbct_guide",
    promptSequence: ["prompt-repeat"],
    entryCondition: { kind: "always" },
    completionCondition: { kind: "field", field: "node.all_prompt_items_completed", operator: "equals", value: true },
    transitionRules: [],
    maxNodeIterations: 3,
    safetyRuleIds: [],
  }],
  promptItems: [{
    id: "prompt-repeat",
    nodeId: "node-repeat",
    roleId: "tbct_guide",
    scope: "step",
    sequenceIndex: 1,
    executionMode: "repeat_until",
    modelGuidance: "Ask for one response.",
    fallbackPatientText: "What would you like to share?",
    completionCondition: { kind: "field", field: "answer", operator: "exists" },
    allowedActions: ["ask"],
    forbiddenActions: ["change_runtime_state"],
    requiredFields: ["answer"],
    validationRules: [],
    maxAttempts: 1,
    maxIterations: 2,
    requiresPatientInput: true,
    outputSchemaVersion: "clinical-language/v2",
  }],
};

function createState(): RuntimeSessionState {
  return {
    releaseId: release.id,
    activeNodeId: "node-repeat",
    activePromptItemId: "prompt-repeat",
    activePromptIndex: 0,
    completedNodeIds: [],
    completedPromptItemIds: [],
    fields: {},
    turnCount: 0,
    nodeIterationCount: 0,
  };
}

describe("reduceRuntimeState", () => {
  it("bounds repeat_until progression when its completion condition remains unmet", () => {
    const firstStep = resolveActiveRuntimeStep(release, createState());
    expect(firstStep).not.toBeNull();
    const first = reduceRuntimeState({ release, currentState: createState(), activeStep: firstStep!, event: "patient_input_accepted" });
    expect(first.transitionDecision).toBe("waiting_for_input");
    expect(first.state.nodeIterationCount).toBe(1);

    const secondStep = resolveActiveRuntimeStep(release, first.state);
    expect(secondStep).not.toBeNull();
    const second = reduceRuntimeState({ release, currentState: first.state, activeStep: secondStep!, event: "patient_input_accepted" });
    expect(second.state.completedPromptItemIds).toContain("prompt-repeat");
    expect(second.transitionDecision).toBe("complete_session");
  });
});