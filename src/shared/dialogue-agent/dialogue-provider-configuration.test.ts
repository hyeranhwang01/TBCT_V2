import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateDialogueDecision } from "@/shared/dialogue-agent/anthropic-dialogue-agent";
import type { DialogueContract } from "@/shared/dialogue-agent/dialogue-agent-contract";

/**
 * "No provider configured" and "the provider let us down" ship the same
 * deterministic text but mean opposite things. Conflating them made every
 * turn of a provider-free run look like a quality regression, which is what
 * hid the real fallbacks in the audit reports.
 */
const contract: DialogueContract = {
  sessionId: "test-session",
  nodeId: "tbct-s07-n04-decisional-balance",
  promptItemId: "tbct-s07-n04-p01-action-in-own-words",
  roleId: "tbct_guide",
  therapeuticObjective: "Name the desired or feared action.",
  currentTaskText: "지금 마음에 두고 계신 그 행동을, 본인의 말로 한 문장으로 표현해 주시겠어요?",
  expectedInputType: "free_text",
  isRepeatablePrompt: false,
  nodeRequiresProtectedField: false,
  participantOwned: true,
  assistantMustNotSupply: true,
  worksheetEditAvailable: false,
  confirmedState: {},
  allowedActions: ["ask"],
  forbiddenActions: ["diagnose"],
  recentContext: [],
  safetyStatus: "none",
  locale: "ko-KR",
  clarificationAttemptCount: 0,
  isFirstPromptOfSession: false,
  isFirstPromptOfNode: true,
  isRoleTransitionPrompt: false,
};

const context = { sessionId: "test-session", turnId: "turn-1" };

const originalKey = process.env.ANTHROPIC_API_KEY;
const originalProvider = process.env.AI_PROVIDER;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  if (originalProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalProvider;
});

describe("dialogue provider configuration", () => {
  it("reports a missing key as not-configured rather than a failure to fall back from", async () => {
    const result = await generateDialogueDecision(contract, context);
    expect(result.failed).toBe(true);
    expect(result).toMatchObject({ provider: "none", notConfigured: true });
    // The deterministic decision still carries the real task text, so the
    // participant is asked the actual question.
    expect(result.decision.patientFacingMessage).toBe(contract.currentTaskText);
  });

  it("honours AI_PROVIDER=mock even when a key is present, so a deterministic audit stays deterministic", async () => {
    // The simulated-patient audit sets AI_PROVIDER=mock precisely to mean "do
    // not call a live model in this process". This function used to key off
    // ANTHROPIC_API_KEY alone, so a developer with a key in their environment
    // silently turned that audit into a live, billed, non-reproducible run.
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-used-by-this-test";
    process.env.AI_PROVIDER = "mock";
    const result = await generateDialogueDecision(contract, context);
    expect(result).toMatchObject({ provider: "none", notConfigured: true });
    expect(result.failed && result.failureReason).toContain("AI_PROVIDER=mock");
  });
});
