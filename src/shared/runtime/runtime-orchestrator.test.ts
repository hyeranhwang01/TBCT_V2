import { describe, expect, it } from "vitest";
import { resolveRepeatedFallbackOverride } from "@/shared/runtime/runtime-orchestrator";

// Simulates "the dialogue agent/provider failed 3 turns in a row on the
// same prompt" directly at the decision-logic level, rather than driving a
// full session through a mocked failing fetch layer -- this is the exact
// input shape a real repeated failure produces (usedFallback: true, the
// last 3 assistant messages all equal to the approved static text), so it
// is a faithful test of the branch, not a shortcut around it. See this
// task's redesign brief §9 (RF-1..RF-7) and .claude/TASK_SCOPE.json's
// note2026_08_17b entry.
function threeRepeats(text: string) {
  return [text, text, text];
}

const APPROVED = "This is the approved question text for the active prompt.";

// P1-3 (TBCT S01-S03 fidelity pass): S02 and S03 gained the same
// phase/construct-preserving exception S01 already had -- both now delegate
// to their own static-messages/s0N.ts resolveRepeatedFallbackText instead of
// this generic override, for the same reason: the generic override's fixed
// "share one specific moment when it felt strongest" text is a
// Personal-Example-shaped question that could silently replace an S02
// problem/goal/rating question or an S03 situation/thought/emotion/body
// question with an unrelated new-personal-situation prompt. S04-S08 are the
// true regression group now: still byte-identical to the original generic
// override.
// S01 and S02 had the same exception until they became prompt-driven
// (note2026_09_25_prompt_driven_s01_s02); their cases went with it.
describe("resolveRepeatedFallbackOverride: S03 construct-preserving exception", () => {
  it("RF-7: S03's automatic-thought prompt gets its hand-tuned, thought-preserving rephrase", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s03",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "I feel like nothing I do is good enough",
      locale: "en-US",
      activePromptItemId: "tbct-s03-n04-p01-automatic-thought",
    });
    expect(result).not.toContain("specific moment");
    expect(result).toMatch(/thought/i);
  });
});

describe("resolveRepeatedFallbackOverride: S04-S08 regression (unchanged generic behavior)", () => {
  const genericEnglish = 'It sounds like "I feel like nothing I do is good enough" is weighing on you. Could you share one specific moment when it felt strongest?';

  it.each(["tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"])(
    "RF-7: %s gets the exact original generic override, unaffected by the S01/S02/S03 exceptions",
    (sessionDefinitionId) => {
      const result = resolveRepeatedFallbackOverride({
        sessionDefinitionId,
        usedFallback: true,
        approvedPatientText: APPROVED,
        recentAssistantMessages: threeRepeats(APPROVED),
        lastPatientMessage: "I feel like nothing I do is good enough",
        locale: "en-US",
        activePromptItemId: `${sessionDefinitionId}-n01-p01-some-prompt`,
      });
      expect(result).toBe(genericEnglish);
    },
  );

  it("does not override at all when the approved text was not repeated in the last 3 assistant turns", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s02",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: ["something else entirely", "and another thing", "a third distinct message"],
      lastPatientMessage: "ok",
      locale: "en-US",
      activePromptItemId: "tbct-s02-n10-p04-next-preview",
    });
    expect(result).toBeUndefined();
  });

  it("does not override when usedFallback is false, even with 3 identical recent messages", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: false,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "ok",
      locale: "en-US",
      activePromptItemId: "tbct-s01-n11-p01-candidate-one-emotion",
    });
    expect(result).toBeUndefined();
  });
});
