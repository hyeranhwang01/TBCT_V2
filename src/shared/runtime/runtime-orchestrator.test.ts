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

describe("resolveRepeatedFallbackOverride: S01-only phase-aware exception", () => {
  it("RF-1: Neutral Example Emotion prompt gets a phase-preserving rephrase, never a personal-experience question", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "I'm not sure.",
      locale: "en-US",
      activePromptItemId: "tbct-s01-n05-p01-candidate-two-emotion",
    });
    expect(result).toBeDefined();
    expect(result).not.toContain("specific moment");
    expect(result).not.toMatch(/where were you|who was|recent experience/i);
  });

  it("RF-2: Neutral Example Behavior prompt stays on behavior, not emotion or situation", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "hmm",
      locale: "en-US",
      activePromptItemId: "tbct-s01-n04-p02-candidate-one-behavior",
    });
    expect(result).toMatch(/behav/i);
    expect(result).not.toContain("specific moment");
  });

  it("RF-3: Insight prompt re-explains the same concept, does not ask for a new personal example", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "not sure",
      locale: "en-US",
      activePromptItemId: "tbct-s01-n07-p01-three-person-insight",
    });
    expect(result).toBeDefined();
    expect(result).not.toContain("specific moment");
    expect(result).not.toMatch(/where were you|who was/i);
  });

  it("RF-4: Initial Thought Probe fallback re-asks the thought, never a new situation", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "I don't know",
      locale: "en-US",
      activePromptItemId: "tbct-s01-n02-p02-initial-thought-probe",
    });
    expect(result).toMatch(/thought|mind/i);
    expect(result).not.toMatch(/where were you|who was there|tell me (?:more )?about (?:a|the) (?:new |recent )?situation/i);
  });

  it("RF-5: Personal Re-application fallback (emotion/behavior/body) never re-asks the situation", () => {
    const emotion = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "not sure",
      locale: "en-US",
      activePromptItemId: "tbct-s01-n08-p01-personal-emotion",
    });
    const behavior = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "not sure",
      locale: "en-US",
      activePromptItemId: "tbct-s01-n08-p02-personal-behavior",
    });
    for (const result of [emotion, behavior]) {
      expect(result).toBeDefined();
      expect(result).not.toMatch(/where were you|who was|new situation|recent moment/i);
      expect(result).not.toContain("specific moment");
    }
  });

  it("covers a prompt with no hand-tuned rephrase via the generic, still phase-neutral default", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "not sure",
      locale: "en-US",
      activePromptItemId: "tbct-s01-n09-p01-participant-summary",
    });
    expect(result).toContain(APPROVED);
    expect(result).not.toContain("specific moment");
  });

  it("Korean locale routes through the Korean rephrase, not the English one", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s01",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "잘 모르겠어요",
      locale: "ko-KR",
      activePromptItemId: "tbct-s01-n04-p01-candidate-one-emotion",
    });
    expect(result).toMatch(/[가-힣]/);
    expect(result).not.toContain("specific moment");
  });
});

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
describe("resolveRepeatedFallbackOverride: S02/S03 construct-preserving exception", () => {
  it("RF-6: S02's problem-framing prompt gets its hand-tuned, problem-preserving rephrase", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s02",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "I feel like nothing I do is good enough",
      locale: "en-US",
      activePromptItemId: "tbct-s02-n02-p01-problem-framing",
    });
    expect(result).not.toContain("specific moment");
    expect(result).toMatch(/problem/i);
  });

  it("RF-6: S02 falls back to the generic, still-construct-preserving default for a prompt with no hand-tuned rephrase", () => {
    const result = resolveRepeatedFallbackOverride({
      sessionDefinitionId: "tbct-s02",
      usedFallback: true,
      approvedPatientText: APPROVED,
      recentAssistantMessages: threeRepeats(APPROVED),
      lastPatientMessage: "힘들었어요",
      locale: "en-US",
      activePromptItemId: "tbct-s02-n02-p01-elicit-problems",
    });
    expect(result).toContain(APPROVED);
    expect(result).not.toContain("specific moment");
  });

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
      activePromptItemId: "tbct-s02-n02-p01-elicit-problems",
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
      activePromptItemId: "tbct-s01-n04-p01-candidate-one-emotion",
    });
    expect(result).toBeUndefined();
  });
});
