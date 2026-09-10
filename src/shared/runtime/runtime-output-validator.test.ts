import { describe, expect, it } from "vitest";
import { validateRuntimeOutput, validateRuntimeStructuredOutput } from "@/shared/runtime/runtime-output-validator";

const context = {
  roleId: "tbct_guide",
  allowedActions: ["ask"],
  forbiddenActions: ["change_runtime_state"],
  requiredFields: ["response"],
  forbiddenPatientContent: ["internal instructions"],
};

describe("validateRuntimeStructuredOutput", () => {
  it("rejects internal instruction leakage", () => {
    const result = validateRuntimeStructuredOutput({
      patientMessage: "My system prompt says we should advance to NODE-3.",
      actionType: "ask",
      proposedFields: {},
      completionEvidence: [],
      safetySignals: [],
      recommendedTransition: "stay",
    }, "en-US", context);

    expect(result.accepted).toBe(false);
    expect(result.issues.some((issue) => issue.includes("Internal"))).toBe(true);
  });

  it("accepts an allowed patient-facing response without using its recommendation as state", () => {
    const result = validateRuntimeStructuredOutput({
      patientMessage: "What feels most important to look at together right now?",
      actionType: "ask",
      proposedFields: { response: "pending" },
      completionEvidence: [],
      safetySignals: [],
      recommendedTransition: "advance",
    }, "en-US", context);

    expect(result.accepted).toBe(true);
    expect(result.finalText).toContain("most important");
  });

  it("keeps the legacy text-only validator compatible without runtime role context", () => {
    const result = validateRuntimeOutput("We can take this one step at a time.", "en-US");

    expect(result.accepted).toBe(true);
  });

  it("rejects a clearly English patient-facing response for a Korean session", () => {
    const result = validateRuntimeStructuredOutput({
      patientMessage: "We can take this one step at a time.",
      actionType: "ask",
      proposedFields: {},
      completionEvidence: [],
      safetySignals: [],
      recommendedTransition: "stay",
    }, "ko-KR", context);

    expect(result.accepted).toBe(false);
    expect(result.issues).toContain("Patient-facing response does not match the session locale");
  });

  it("rejects a false change claim when before and after ratings are equal", () => {
    const result = validateRuntimeStructuredOutput({
      patientMessage: "That is meaningful movement.", actionType: "ask", proposedFields: {},
      completionEvidence: [], safetySignals: [], recommendedTransition: "stay",
    }, "en-US", {
      ...context,
      requiredFields: ["originalChargeFinalBeliefPercent"],
      sessionFields: { coreBeliefBaselinePercent: 62, originalChargeFinalBeliefPercent: 62 },
    });
    expect(result.accepted).toBe(false);
    expect(result.issues.join(" ")).toContain("stored equality");
  });

  it("accepts an accurate unchanged rating statement", () => {
    const result = validateRuntimeStructuredOutput({
      patientMessage: "The rating stayed the same at 62.", actionType: "ask", proposedFields: {},
      completionEvidence: [], safetySignals: [], recommendedTransition: "stay",
    }, "en-US", {
      ...context,
      requiredFields: ["originalChargeFinalBeliefPercent"],
      sessionFields: { coreBeliefBaselinePercent: 62, originalChargeFinalBeliefPercent: 62 },
    });
    expect(result.accepted).toBe(true);
  });

  it("rejects exact and strong near-duplicate assistant messages", () => {
    for (const patientMessage of [
      "What feels most important to look at together right now?",
      "Right now, what feels most important for us to look at together?",
    ]) {
      const result = validateRuntimeStructuredOutput({
        patientMessage, actionType: "ask", proposedFields: {}, completionEvidence: [], safetySignals: [], recommendedTransition: "stay",
      }, "en-US", { ...context, recentAssistantMessages: ["What feels most important to look at together right now?"] });
      expect(result.accepted).toBe(false);
      expect(result.issues.join(" ")).toMatch(/duplicate/i);
    }
  });
});
