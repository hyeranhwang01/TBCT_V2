import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_SESSION_COMMON_RULES } from "@/lib/protocol/source-fidelity-catalog";

describe("S07 (Consensual Role-Play) catalog content", () => {
  it("keeps source corruption visible rather than repairing it", () => {
    const session07Rules = CANONICAL_SESSION_COMMON_RULES["tbct-s07"];
    expect(session07Rules.sourceFidelityStatus).toBe("review_required");
    expect(session07Rules.sourceTrace.rawSourceExcerpt?.trim()).not.toBe("");
    expect(session07Rules.sourceTrace.reviewWarnings?.length).toBeGreaterThan(0);
  });

  it("encodes the readiness-decision options as a control rather than leaving them as display text", () => {
    const session07Readiness = CANONICAL_PROMPT_ITEMS.find((item) => item.id.endsWith("readiness-decision"));
    expect(session07Readiness?.validation).toMatchObject({ values: ["ready", "not_ready"], notReadyIsValid: true });
  });
});
