import { describe, expect, it } from "vitest";
import { resolveStaticPatientMessage } from "@/shared/runtime/runtime-static-message";
import { promptRequiresPatientInput, resolveModelGroundingText } from "@/shared/runtime/runtime-release-normalizer";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import type { PromptItem } from "@/shared/protocol/source-fidelity-types";

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

describe("resolveStaticPatientMessage: S02's per-pattern walkthrough text stays inside the safety cap", () => {
  // The CCPH/CCGH six-anchor blocks this used to guard are gone with that
  // session (note2026_09_21_s02_cognitive_distortions). The same defect class
  // still applies to what replaced them: the walkthrough text is composed per
  // pattern from the registry, so if any one of the fifteen came out over
  // isPatientSafeFallbackText's 600-char cap -- or said "model" in English --
  // it would be silently swapped for the content-free generic locale line, and
  // only that one pattern would be affected.
  const GENERIC = "We can take this one step at a time. What feels most important to share right now?";
  for (const [index, distortion] of COGNITIVE_DISTORTIONS.entries()) {
    it.each([["ko-KR"], ["en-US"]])(`pattern ${index + 1} (${distortion.id}) delivers its own text in %s`, (locale) => {
      const prompt = makePromptWithFallback("tbct-s02-n05-p01-review-distortion", "");
      const fields = { distortionExamples: Array.from({ length: index }, (_, position) => `row ${position}`) };
      const result = resolveStaticPatientMessage(prompt, locale, { fields, riskSignals: [], iterationCounts: {}, riskLevel: "low" });
      expect(result).not.toBeNull();
      expect(result!.patientMessage).not.toBe(GENERIC);
      expect(result!.patientMessage).toContain(locale.startsWith("ko") ? distortion.nameKo : distortion.nameEn[0]);
      expect(result!.patientMessage.length).toBeLessThanOrEqual(600);
      if (!locale.startsWith("ko")) expect(result!.patientMessage).not.toMatch(/\bmodels?\b/i);
    });
  }
});

describe("S02 statements do not demand a meaningless patient reply", () => {
  // The CCPH/CCGH acknowledgements this guarded were carried by exact ids in
  // PASSIVE_ACKNOWLEDGMENT_PROMPT_IDS. The redesigned S02 needs no exact ids:
  // every statement that asks nothing is typed so the generic passive branch
  // already covers it. This pins that, because a type change on any of them
  // would start demanding an answer the participant has no way to give.
  for (const id of [
    "tbct-s02-n02-p02-normalize-overlap",
    "tbct-s02-n04-p01-distortion-concept",
    "tbct-s02-n04-p02-research-evidence",
    "tbct-s02-n04-p03-future-use",
    // Stage 2's statements: the grid explanation (which declares a field but
    // asks nothing), the total, and the inborn-vs-learned aside.
    "tbct-s02-n06-p01-cdquest-explain",
    "tbct-s02-n08-p01-total",
    "tbct-s02-n08-p03-innate-vs-learned",
    "tbct-s02-n10-p01-session-recap",
    "tbct-s02-n10-p04-next-preview",
  ]) {
    it(`${id} advances immediately after delivery`, () => {
      const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id === id);
      expect(promptItem, id).toBeDefined();
      expect(promptRequiresPatientInput(promptItem!), id).toBe(false);
    });
  }
});

describe("S01 three-person scene", () => {
  const promptItemId = "tbct-s01-n10-p02-scene";

  it("shows the scene generated for this session", () => {
    const scene = "동아리 첫 모임이 끝나고 선배가 세 사람에게 똑같이 말했어요. “오늘 와줘서 반가웠어요.”";
    const result = resolveStaticPatientMessage(makePromptWithFallback(promptItemId, ""), "ko-KR", { fields: { threePersonScene: scene }, riskSignals: [], iterationCounts: {}, riskLevel: "low" });
    expect(result?.patientMessage).toBe(scene);
  });

  it("falls back to the fixed real-session scene when none was generated", () => {
    const result = resolveStaticPatientMessage(makePromptWithFallback(promptItemId, ""), "ko-KR", { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" });
    expect(result?.patientMessage).toContain("만나서 반가웠어요");
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
