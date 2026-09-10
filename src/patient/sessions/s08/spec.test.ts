import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS } from "@/lib/protocol/source-fidelity-catalog";

describe("S08 (Trial One) catalog content", () => {
  it("encodes the verdict and positive-belief prompts as participant-generated controls rather than leaving them as display text", () => {
    const session08Verdict = CANONICAL_PROMPT_ITEMS.find((item) => item.id.endsWith("participant-verdict"));
    const session08PositiveBelief = CANONICAL_PROMPT_ITEMS.find((item) => item.id.endsWith("participant-positive-belief"));
    expect(session08Verdict?.validation).toMatchObject({ participantGenerated: true, assistantMustNotSupply: true });
    expect(session08PositiveBelief?.validation).toMatchObject({ participantGenerated: true, assistantMustNotSupply: true });
  });
});
