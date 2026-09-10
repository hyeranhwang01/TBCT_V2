import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_SESSION_COMMON_RULES, CANONICAL_SOURCE_EDGES } from "@/lib/protocol/source-fidelity-catalog";

describe("S06 (Color-Coded Symptoms Hierarchy) catalog content", () => {
  it("keeps source corruption visible rather than repairing it", () => {
    const session06Rules = CANONICAL_SESSION_COMMON_RULES["tbct-s06"];
    expect(session06Rules.sourceFidelityStatus).toBe("review_required");
    expect(session06Rules.sourceTrace.rawSourceExcerpt?.trim()).not.toBe("");
    expect(session06Rules.sourceTrace.reviewWarnings?.length).toBeGreaterThan(0);
  });

  it("encodes the green-homework selection limits as a control rather than leaving them as display text", () => {
    const session06Homework = CANONICAL_PROMPT_ITEMS.find((item) => item.id.endsWith("choose-green-items"));
    expect(session06Homework?.validation).toMatchObject({ allowedScores: [2, 3], minItems: 2, maxItems: 3 });
    expect(CANONICAL_SOURCE_EDGES.some((edge) => edge.label === "Yellow or red item proposed for independent homework")).toBe(true);
  });
});
