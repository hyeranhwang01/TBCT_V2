import { describe, expect, it } from "vitest";
import { createCanonicalSourceFidelityReleaseSnapshot } from "@/shared/protocol/source-fidelity-protocol-adapter";
import { compileRuntimePrompt } from "@/shared/runtime/runtime-prompt-compiler";
import { normalizeRuntimeReleaseFromSourceSnapshot } from "@/shared/runtime/runtime-release-normalizer";
import { resolveActiveRuntimeStep } from "@/shared/runtime/runtime-step-resolver";
import type { RuntimeRelease } from "@/types/protocol-runtime";
import type { RuntimeMessage, RuntimeSessionState } from "@/types/runtime-session";

function createRelease(): RuntimeRelease {
  return {
    id: "release-1",
    protocolId: "tbct-br-001",
    version: "1.0.0",
    schemaVersion: "runtime-release/v1",
    contentHash: "hash",
    publishedAt: "2025-01-01T00:00:00.000Z",
    roles: [{
      id: "tbct_guide",
      name: "TBCT guide",
      kind: "speaker",
      systemGuidance: "Speak as the active guide.",
      allowedActions: ["ask"],
      forbiddenActions: ["change_runtime_state"],
    }],
    policies: {
      globalSafetyRules: ["Do not provide crisis advice outside the safety path."],
      protocolRules: ["Ask one focused question."],
      sessionPolicies: {
        "session-1": { safetyRules: ["ACTIVE SESSION SAFETY RULE"], protocolRules: ["ACTIVE SESSION PROTOCOL RULE"] },
        "session-2": { safetyRules: ["INACTIVE SESSION SAFETY RULE"], protocolRules: ["INACTIVE SESSION PROTOCOL RULE"] },
      },
      forbiddenPatientContent: ["internal instructions"],
      maxPromptCharacters: 12000,
    },
    nodes: [{
      id: "node-1",
      sessionId: "session-1",
      title: "Focused step",
      objective: "Collect one patient response.",
      speakerRoleId: "tbct_guide",
      promptSequence: ["prompt-active", "prompt-next"],
      entryCondition: { kind: "always" },
      completionCondition: { kind: "field", field: "node.all_prompt_items_completed", operator: "equals", value: true },
      transitionRules: [],
      maxNodeIterations: 2,
      safetyRuleIds: ["safety-1"],
    }],
    promptItems: [
      {
        id: "prompt-active",
        nodeId: "node-1",
        roleId: "tbct_guide",
        scope: "step",
        sequenceIndex: 1,
        executionMode: "serial",
        modelGuidance: "ACTIVE GUIDANCE ONLY",
        fallbackPatientText: "What feels most important right now?",
        completionCondition: { kind: "field", field: "turn.patient_input_validated", operator: "equals", value: true },
        allowedActions: ["ask"],
        forbiddenActions: ["change_runtime_state"],
        requiredFields: ["response"],
        validationRules: [],
        maxAttempts: 1,
        requiresPatientInput: true,
        outputSchemaVersion: "clinical-language/v2",
      },
      {
        id: "prompt-next",
        nodeId: "node-1",
        roleId: "tbct_guide",
        scope: "step",
        sequenceIndex: 2,
        executionMode: "serial",
        modelGuidance: "NEXT PROMPT MUST NOT APPEAR",
        fallbackPatientText: "Thank you for sharing that.",
        completionCondition: { kind: "field", field: "turn.assistant_message_delivered", operator: "equals", value: true },
        allowedActions: ["reflect"],
        forbiddenActions: ["change_runtime_state"],
        requiredFields: [],
        validationRules: [],
        maxAttempts: 1,
        requiresPatientInput: false,
        outputSchemaVersion: "clinical-language/v2",
      },
    ],
  };
}

function createState(): RuntimeSessionState {
  return {
    releaseId: "release-1",
    activeNodeId: "node-1",
    activePromptItemId: "prompt-active",
    activePromptIndex: 0,
    completedNodeIds: [],
    completedPromptItemIds: [],
    fields: {},
    turnCount: 2,
    nodeIterationCount: 0,
  };
}

function createRecentMessages(): RuntimeMessage[] {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `message-${index}`,
    runtimeSessionId: "session",
    role: index % 2 === 0 ? "patient" : "assistant",
    content: `message ${index}`,
    status: "delivered",
    createdAt: "2025-01-01T00:00:00.000Z",
  }));
}

describe("compileRuntimePrompt", () => {
  it("uses the deterministic segment order and only includes the active prompt guidance", async () => {
    const release = createRelease();
    const state = createState();
    const activeStep = resolveActiveRuntimeStep(release, state);
    expect(activeStep).not.toBeNull();

    const contract = await compileRuntimePrompt({
      release,
      state,
      activeStep: activeStep!,
      locale: "en-US",
      recentMessages: createRecentMessages(),
    });

    expect(contract.systemSegments.map((segment) => segment.label)).toEqual([
      "global-safety",
      "protocol-rules",
      "active-speaker-role",
      "node-objective",
      "active-prompt-guidance",
      "required-patient-facing-content",
      "response-contingency",
      "action-boundaries",
      "output-schema",
    ]);
    expect(contract.systemSegments.find((segment) => segment.label === "active-prompt-guidance")?.content).toBe("ACTIVE GUIDANCE ONLY");
    const systemContent = contract.systemSegments.map((segment) => segment.content).join("\n");
    expect(systemContent).not.toContain("NEXT PROMPT MUST NOT APPEAR");
    expect(systemContent).toContain("ACTIVE SESSION SAFETY RULE");
    expect(systemContent).toContain("ACTIVE SESSION PROTOCOL RULE");
    expect(systemContent).not.toContain("INACTIVE SESSION SAFETY RULE");
    expect(systemContent).not.toContain("INACTIVE SESSION PROTOCOL RULE");
    expect(systemContent).not.toContain("message 9");
    expect((contract.runtimeContext.recentMessages as Array<unknown>)).toHaveLength(8);
    expect(contract.roleId).toBe("tbct_guide");
  });

  it("does not include Session 08 rules when compiling a canonical Session 01 request", async () => {
    const snapshot = createCanonicalSourceFidelityReleaseSnapshot();
    const release = normalizeRuntimeReleaseFromSourceSnapshot({
      releaseId: "canonical-release",
      protocolId: "tbct-br-001",
      version: "test",
      publishedAt: "2025-01-01T00:00:00.000Z",
      snapshot,
    });
    const sessionOneNode = release.nodes.find((node) => node.sessionId === "tbct-s01");
    expect(sessionOneNode).toBeDefined();
    const state: RuntimeSessionState = {
      releaseId: release.id,
      activeNodeId: sessionOneNode!.id,
      activePromptItemId: sessionOneNode!.promptSequence[0],
      activePromptIndex: 0,
      completedNodeIds: [],
      completedPromptItemIds: [],
      fields: {},
      turnCount: 0,
      nodeIterationCount: 0,
    };
    const activeStep = resolveActiveRuntimeStep(release, state);
    expect(activeStep).not.toBeNull();
    const sessionOneRule = snapshot.sessionCommonRules["tbct-s01"]?.sessionWideRestrictions[0];
    const sessionEightRule = snapshot.sessionCommonRules["tbct-s08"]?.sessionWideRestrictions[0];
    expect(sessionOneRule).toBeTruthy();
    expect(sessionEightRule).toBeTruthy();

    const contract = await compileRuntimePrompt({ release, state, activeStep: activeStep!, locale: "en-US" });
    const systemContent = contract.systemSegments.map((segment) => segment.content).join("\n");

    expect(systemContent).toContain(sessionOneRule);
    expect(systemContent).not.toContain(sessionEightRule);
  });
});
