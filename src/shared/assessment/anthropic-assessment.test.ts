import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAssessmentModel, resetAssessmentModelForTests } from "@/shared/assessment/assessment-providers";
import { getAssessmentConfig } from "@/shared/assessment/assessment-config";

// The semantic gate decides whether a patient's answer is a real answer before
// anything is stored. Everything downstream is written as "the model decides",
// but with no ASSESSMENT_PROVIDER set that fell to an eleven-word English stop
// list, and a Korean "네 있었어요" was filed as somebody's cognitive-distortion
// example (note2026_09_21_anthropic_assessment_provider). This provider runs the
// gate on the model the session is already talking to.

const ENV_KEYS = ["ASSESSMENT_PROVIDER", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ALLOW_CLOUD_PATIENT_ASSESSMENT"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  resetAssessmentModelForTests();
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetAssessmentModelForTests();
  vi.unstubAllGlobals();
});

function configure(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  process.env.ASSESSMENT_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_MODEL = "claude-test";
  process.env.ALLOW_CLOUD_PATIENT_ASSESSMENT = "true";
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  resetAssessmentModelForTests();
}

const REQUEST = {
  locale: "ko-KR",
  inputType: "question",
  patientInput: "네 있었어요",
  nodeGoal: "Ask for one moment from their week when this pattern came up.",
  allowedFields: ["distortionExamples"],
  allowedTransitions: [],
  safetyCategories: [],
};

function toolResponse(input: unknown) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: "tool_use", name: "submit_assessment", input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } }),
  };
}

describe("the Anthropic assessment provider", () => {
  it("is selected by ASSESSMENT_PROVIDER, and reuses the dialogue agent's own credentials", () => {
    configure();
    expect(getAssessmentConfig().provider).toBe("anthropic");
    const meta = getAssessmentModel().getProviderMetadata();
    expect(meta.provider).toBe("anthropic");
    expect(meta.model).toBe("claude-test");
    // Not a second recipient of patient text: the same vendor already phrases
    // every turn.
    expect(meta.privacyBoundary).toBe("cloud");
  });

  it("asks for the decision as a forced tool call rather than parsing prose", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(toolResponse({
      inputValid: false, relevance: "relevant", intent: "answer", extractedFields: {},
      completionStatus: "needs_clarification", safetyLevel: "none", safetySignals: [],
      recommendedTransition: null, internalSummary: null, turnAction: "clarification_request",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAssessmentModel().assessInput(REQUEST as never);
    expect(result.turnAction).toBe("clarification_request");
    expect(result.inputValid).toBe(false);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_assessment", disable_parallel_tool_use: true });
    expect(body.temperature).toBe(0);
    expect(body.model).toBe("claude-test");
  });

  it("redacts the patient's words before they leave, unless that is switched off", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(toolResponse({
      inputValid: true, relevance: "relevant", intent: "answer", extractedFields: {},
      completionStatus: "complete", safetyLevel: "none", safetySignals: [],
      recommendedTransition: null, internalSummary: null, turnAction: "accept_answer",
    }));
    vi.stubGlobal("fetch", fetchMock);
    await getAssessmentModel().assessInput({ ...REQUEST, patientInput: "제 이메일은 hong@example.com 이에요" } as never);
    const sent = JSON.parse(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).messages[0].content);
    expect(sent.patientInput).not.toContain("hong@example.com");
  });

  // The switch the other cloud providers respect. Not waived here just because
  // this vendor already sees the text through the dialogue agent.
  it("refuses to run when cloud patient assessment is switched off", async () => {
    configure({ ALLOW_CLOUD_PATIENT_ASSESSMENT: "false" });
    vi.stubGlobal("fetch", vi.fn());
    await expect(getAssessmentModel().assessInput(REQUEST as never)).rejects.toThrow(/Cloud patient assessment is disabled/);
  });

  it("says what is missing rather than calling out with half a configuration", async () => {
    configure({ ANTHROPIC_MODEL: "" });
    const health = await getAssessmentModel().healthCheck();
    expect(health.ok).toBe(false);
    expect(health.message).toMatch(/ANTHROPIC_API_KEY and ANTHROPIC_MODEL/);
  });

  it("treats a truncated or unstructured reply as a failure, never as an answer", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: "{\"inputValid\":true}" }], stop_reason: "end_turn" }) }));
    await expect(getAssessmentModel().assessInput(REQUEST as never)).rejects.toThrow(/no structured assessment/);

    resetAssessmentModelForTests();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [], stop_reason: "max_tokens" }) }));
    await expect(getAssessmentModel().assessInput(REQUEST as never)).rejects.toThrow(/truncated/);
  });

  it("leaves the default alone -- an unset provider is still deterministic", () => {
    delete process.env.ASSESSMENT_PROVIDER;
    resetAssessmentModelForTests();
    expect(getAssessmentConfig().provider).toBe("deterministic");
    expect(getAssessmentModel().getProviderMetadata().provider).toBe("deterministic");
  });
});
