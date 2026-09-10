import { describe, expect, it } from "vitest";
import { resolveStaticPatientMessage } from "@/lib/runtime/runtime-static-message";
import { promptRequiresPatientInput, resolveModelGroundingText } from "@/lib/runtime/runtime-release-normalizer";
import { CANONICAL_PROMPT_ITEMS } from "@/lib/protocol/source-fidelity-catalog";
import type { PromptItem } from "@/lib/protocol/source-fidelity-types";

// Regression test for a real leak a Korean patient hit in production: a
// PromptItem whose fallbackPatientText is English-only source text, with no
// curated Korean translation (REVIEWED_KOREAN_PROMPT_TEXT in
// runtime-release-normalizer.ts), used to ship that raw English straight to
// a ko-KR session. resolveStaticPatientMessage's second branch had its own
// copy of the "is this locale-safe" decision that specifically reverted to
// the raw English fallback whenever the correct, already-localized generic
// line would have been used instead -- see the fix in
// runtime-static-message.ts for the full story.
function makePromptWithFallback(id: string, fallbackPatientText: string): PromptItem {
  return {
    id,
    protocolId: "tbct-br-001",
    sessionId: "tbct-s01",
    nodeId: "node-x",
    order: 1,
    type: "instruction",
    verbatimText: fallbackPatientText,
    editableText: fallbackPatientText,
    aiInstruction: "Present this teaching example.",
    fallbackPatientText,
    activationCondition: null,
    outputFields: [],
    validation: null,
    completionEffect: null,
    restrictions: [],
    safetyRuleIds: [],
    sourceTrace: { sourceDocument: "TBCT pasted source text", sourceSession: "Session 01", sourceSection: "test", sourceLineStart: 1, sourceLineEnd: 1, sourceTextHash: "test", importedVersion: "test" },
    sourceFidelityStatus: "structured_from_source",
    origin: "source_imported",
    sourceHash: "test",
    status: "active",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    updatedBy: "test",
  };
}

describe("resolveStaticPatientMessage: S02 CCPH/CCGH six-anchor scale text stays under the 600-char safety cap", () => {
  // Regression test for a real bug: static-messages/s02.ts's computed
  // six-anchor-problem-scale/six-anchor-goal-scale branches were verbose
  // enough in English (~660-800 chars) to fail isPatientSafeFallbackText's
  // 600-char cap in runtime-release-normalizer.ts, silently substituting the
  // content-free generic locale line (defaultFallbackPatientText) on every
  // English CCPH/CCGH turn -- so an English-speaking participant never saw
  // the six colored rating anchors at all, while Korean's denser phrasing
  // (~446-485 chars) always passed. Found via a real deterministic-fallback
  // session run (no ANTHROPIC_API_KEY), this repo's actual default.
  for (const [promptItemId, mustContain] of [
    ["tbct-s02-n04-p02-six-anchor-problem-scale", ["light blue", "dark blue", "light green", "dark green", "yellow", "red"]],
    ["tbct-s02-n08-p02-six-anchor-goal-scale", ["light blue", "dark blue", "light green", "dark green", "yellow", "red"]],
  ] as const) {
    it.each([
      [{ problemScaleCardAvailable: true, goalScaleCardAvailable: true }, "card available"],
      [{ problemScaleCardAvailable: false, goalScaleCardAvailable: false }, "no card"],
    ])(`${promptItemId} (%s) delivers the real six-anchor scale text in English, not the generic fallback`, (fields) => {
      const prompt = makePromptWithFallback(promptItemId, "");
      const result = resolveStaticPatientMessage(prompt, "en-US", { fields, riskSignals: [], iterationCounts: {}, riskLevel: "low" });
      expect(result).not.toBeNull();
      expect(result!.patientMessage).not.toBe("We can take this one step at a time. What feels most important to share right now?");
      for (const anchor of mustContain) expect(result!.patientMessage).toContain(anchor);
      expect(result!.patientMessage.length).toBeLessThanOrEqual(600);
    });
  }
});

describe("resolveStaticPatientMessage: S02 rating corrections are acknowledged without replaying a stale score", () => {
  it.each([
    ["tbct-s02-n05-p01-reflect-problem-score", "ko-KR", { problems: ["문제A", "문제C"], problemRatings: [5], problemRatingCorrectionApplied: true }, ["제외", "문제C"]],
    ["tbct-s02-n05-p01-reflect-problem-score", "en-US", { problems: ["Problem A", "Problem C"], problemRatings: [5], problemRatingCorrectionApplied: true }, ["removed", "Problem C"]],
    ["tbct-s02-n09-p01-reflect-goal-score", "ko-KR", { goals: ["목표A", "목표C"], goalRatings: [5], goalRatingCorrectionApplied: true }, ["제외", "목표C"]],
    ["tbct-s02-n09-p01-reflect-goal-score", "en-US", { goals: ["Goal A", "Goal C"], goalRatings: [5], goalRatingCorrectionApplied: true }, ["removed", "Goal C"]],
  ] as const)("%s in %s", (promptItemId, locale, fields, mustContain) => {
    const result = resolveStaticPatientMessage(makePromptWithFallback(promptItemId, ""), locale, { fields, riskSignals: [], iterationCounts: {}, riskLevel: "low" });
    expect(result).not.toBeNull();
    for (const phrase of mustContain) expect(result!.patientMessage).toContain(phrase);
    expect(result!.patientMessage).not.toContain(locale === "ko-KR" ? "5점" : "is a 5");
  });
});

describe("S02 passive reflections do not demand a meaningless patient reply", () => {
  it.each([
    "tbct-s02-n05-p02-acknowledge-distress",
    "tbct-s02-n05-p03-acknowledge-manageable",
    "tbct-s02-n06-p02-problem-total-personal",
    "tbct-s02-n09-p02-acknowledge-difficult-goal",
    "tbct-s02-n09-p03-acknowledge-achieved-goal",
    "tbct-s02-n10-p02-goal-total-personal",
  ])("%s advances immediately after delivery", (promptItemId) => {
    const promptItem = CANONICAL_PROMPT_ITEMS.find((candidate) => candidate.id === promptItemId);
    expect(promptItem).toBeDefined();
    expect(promptRequiresPatientInput(promptItem!)).toBe(false);
  });
});

describe("S01 three-person insight reflects the participant's actual answers", () => {
  const promptItemId = "tbct-s01-n07-p01-three-person-insight";

  it("does not claim that feelings and actions differed when the participant gave the same answers", () => {
    const fields = {
      candidateOneEmotion: "불안해요",
      candidateTwoEmotion: "불안해요",
      candidateThreeEmotion: "불안해요",
      candidateOneBehavior: "피할 것 같아요",
      candidateTwoBehavior: "피할 것 같아요",
      candidateThreeBehavior: "피할 것 같아요",
    };
    const result = resolveStaticPatientMessage(makePromptWithFallback(promptItemId, ""), "ko-KR", { fields, riskSignals: [], iterationCounts: {}, riskLevel: "low" });
    expect(result?.patientMessage).toContain("비슷하게 느껴진 부분");
    expect(result?.patientMessage).not.toContain("기분과 행동도 달라졌");
  });

  it("uses the direct contrast when both the feelings and actions actually differed", () => {
    const fields = {
      candidateOneEmotion: "기뻐요",
      candidateTwoEmotion: "슬퍼요",
      candidateThreeEmotion: "화가 나요",
      candidateOneBehavior: "웃어요",
      candidateTwoBehavior: "자리를 피해요",
      candidateThreeBehavior: "따져 물어요",
    };
    const result = resolveStaticPatientMessage(makePromptWithFallback(promptItemId, ""), "ko-KR", { fields, riskSignals: [], iterationCounts: {}, riskLevel: "low" });
    expect(result?.patientMessage).toContain("기분과 행동도 달라졌");
  });
});

describe("S02 list confirmations match the duplicate state", () => {
  it.each([
    ["tbct-s02-n02-p06-problem-confirmation", "ko-KR", { problemsDuplicate: true }, "중복으로 추가하지는 않았어요"],
    ["tbct-s02-n02-p06-problem-confirmation", "en-US", { problemsDuplicate: true }, "did not add it twice"],
    ["tbct-s02-n07-p07-goal-confirmation", "ko-KR", { goalsDuplicate: true }, "중복으로 추가하지는 않았어요"],
    ["tbct-s02-n07-p07-goal-confirmation", "en-US", { goalsDuplicate: true }, "did not add it twice"],
  ] as const)("%s in %s does not falsely claim a duplicate was added", (promptItemId, locale, fields, expected) => {
    const result = resolveStaticPatientMessage(makePromptWithFallback(promptItemId, ""), locale, { fields, riskSignals: [], iterationCounts: {}, riskLevel: "low" });
    expect(result?.patientMessage).toContain(expected);
    expect(result?.patientMessage).not.toContain(locale === "ko-KR" ? "목록에 추가할게요" : "I'll add that");
  });
});

describe("resolveStaticPatientMessage", () => {
  it("never ships raw English fallbackPatientText to a Korean session, even for a PromptItem with no curated translation", () => {
    const englishOnlyPrompt = makePromptWithFallback(
      "tbct-s01-not-in-reviewed-korean-map",
      "Let's pretend that I am not a therapist but a businessperson. I have a job opening, and I will give the same compliment to three candidates.",
    );

    const result = resolveStaticPatientMessage(englishOnlyPrompt, "ko-KR");

    expect(result).not.toBeNull();
    // Must contain Hangul -- either the curated translation (none exists
    // here) or the safe generic Korean line, but never the untranslated
    // English source text verbatim.
    expect(result!.patientMessage).toMatch(/[가-힣]/);
    expect(result!.patientMessage).not.toContain("businessperson");
  });

  it("still returns the English text as-is for an English-locale session", () => {
    const englishOnlyPrompt = makePromptWithFallback(
      "tbct-s01-not-in-reviewed-korean-map-2",
      "Let's pretend that I am not a therapist but a businessperson.",
    );

    const result = resolveStaticPatientMessage(englishOnlyPrompt, "en-US");

    expect(result?.patientMessage).toBe("Let's pretend that I am not a therapist but a businessperson.");
  });
});

describe("resolveModelGroundingText", () => {
  it("preserves a safe source-specific task for Claude while the Korean display fallback stays localized", () => {
    const promptId = "tbct-s01-not-in-reviewed-korean-map-3";
    const sourceTask = "What behavior would Candidate 1 show after feeling proud?";

    expect(resolveModelGroundingText(promptId, sourceTask, "ko-KR")).toBe(sourceTask);
    expect(resolveStaticPatientMessage(makePromptWithFallback(promptId, sourceTask), "ko-KR")?.patientMessage).not.toBe(sourceTask);
  });
});
