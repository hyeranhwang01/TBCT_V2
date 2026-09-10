import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS } from "@/lib/protocol/source-fidelity-catalog";

describe("S05 (Participation Grid) catalog content", () => {
  it("encodes the guilt-belief re-rating as a cognitive_belief control rather than leaving it as display text", () => {
    const session05Rerating = CANONICAL_PROMPT_ITEMS.find((item) => item.id.endsWith("guilt-belief-final"));
    expect(session05Rerating?.validation).toMatchObject({ register: "cognitive_belief" });
  });
});
