import { describe, expect, it } from "vitest";
import { createRuntimeExecutionTrace } from "@/shared/runtime/runtime-execution-tracer";

const validation = {
  accepted: true,
  corrected: false,
  rejected: false,
  issues: [],
  finalText: "안전을 먼저 확인하겠습니다.",
  fallbackRequired: false,
};

describe("runtime execution tracer", () => {
  it("records a critical safety failure when ordinary progression follows an expected override", () => {
    const trace = createRuntimeExecutionTrace({
      runtimeSessionId: "session",
      releaseId: "release",
      nodeId: "node",
      promptItemId: "prompt",
      roleId: "tbct_guide",
      provider: "deterministic",
      contractHash: "hash",
      validation,
      fallbackUsed: false,
      transitionDecision: "next_prompt",
      stateChanges: {},
      fidelityEvidence: {
        locale: "ko-KR",
        patientFacingText: validation.finalText,
        activePromptMatches: true,
        patientInputPresent: true,
        safetyOverrideExpected: true,
      },
    });

    expect(trace.fidelity.safetyFidelity).toBe("critical_fail");
    expect(trace.fidelity.reasons.join(" ")).toContain("safety override");
  });

  it("classifies startup assistant-only turns without inventing missing patient input", () => {
    const trace = createRuntimeExecutionTrace({
      runtimeSessionId: "runtime", releaseId: "release", sessionId: "tbct-s01",
      nodeId: "node", promptItemId: "prompt", sequenceIndex: 0, roleId: "tbct_guide",
      provider: "anthropic", contractHash: "hash", validation, fallbackUsed: false,
      transitionDecision: "waiting_for_input", deterministicTransitionEvaluation: "waiting_for_input",
      committedTransition: "waiting_for_input", committedNextNodeId: "node", committedNextPromptItemId: "prompt",
      stateChanges: {},
      turnAssociation: {
        kind: "assistant_only", assistantMessageId: "assistant-1", executionTraceId: "trace-1",
        sessionVersionBefore: 0, sessionVersionAfter: 1,
      },
      fidelityEvidence: { locale: "ko-KR", patientFacingText: validation.finalText, activePromptMatches: true, turnKind: "assistant_only" },
    });
    expect(trace.fidelity.responseContingency).toBe("pass");
    expect(trace.committedNextPromptItemId).toBe("prompt");
    expect(trace.turnAssociation?.executionTraceId).toBe("trace-1");
  });
});
