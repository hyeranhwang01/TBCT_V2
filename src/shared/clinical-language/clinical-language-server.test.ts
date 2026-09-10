import { afterEach, describe, expect, it } from "vitest";
import { assessClinicalInput, respondClinicalLanguage } from "@/shared/clinical-language/clinical-language-server";

const originalProvider = process.env.AI_PROVIDER;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (originalProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalProvider;
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
});

describe("respondClinicalLanguage", () => {
  it("honors explicit mock selection even when an Anthropic key is configured", async () => {
    process.env.AI_PROVIDER = "mock";
    process.env.ANTHROPIC_API_KEY = "test-key-present";

    const result = await respondClinicalLanguage({
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      protocolId: "tbct-br-001",
      protocolVersion: "1.0.0",
      sessionPlanEntryId: "session-1-entry",
      sessionId: "runtime-session-1",
      sessionNumber: 1,
      nodeId: "node-1",
      nodeTitle: "Opening",
      clinicalPurpose: "Open the session.",
      promptItemId: "prompt-1",
      promptItemType: "question",
      editableText: "What feels most important right now?",
      aiInstruction: "This legacy field must not become patient fallback text.",
      activationCondition: null,
      outputFields: ["response"],
      validation: null,
      completionEffect: null,
      participantMessage: "I feel stuck.",
      relevantFields: {},
      recentMessages: [],
      safetyContext: { activeSafetyRuleIds: [], currentSafetyStatus: "active" },
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.providerMetadata.provider).toBe("mock");
    expect(result.actionType).toBe("ask");
    expect(result.proposedFields).toEqual(result.extractedFields);
    expect(result.recommendedTransition).toBe(result.nextActionRecommendation);
  });

  it("uses the active prompt to reject gibberish and accept a relevant response", async () => {
    process.env.AI_PROVIDER = "mock";
    const common = {
      idempotencyKey: "input-assessment-1",
      locale: "en-US",
      prompt: {
        type: "question",
        validationKind: "participant_articulated_distinction",
        guidance: "Ask for a simple, neutral description of what is happening rather than an interpretation.",
        requiredFields: ["situationThoughtDistinction"],
      },
    };

    const gibberish = await assessClinicalInput({ ...common, requestId: "assessment-gibberish", patientMessage: "fuiissiidojfosid" });
    const meaningful = await assessClinicalInput({ ...common, requestId: "assessment-meaningful", patientMessage: "I am talking with the therapist during my appointment." });

    expect("error" in gibberish).toBe(false);
    expect("error" in meaningful).toBe(false);
    if ("error" in gibberish || "error" in meaningful) return;
    expect(gibberish.accepted).toBe(false);
    expect(meaningful.accepted).toBe(true);
  });
});