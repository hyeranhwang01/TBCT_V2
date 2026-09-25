import { describe, expect, it } from "vitest";
import { resolveStaticPatientMessage } from "@/shared/runtime/runtime-static-message";
import { resolveModelGroundingText } from "@/shared/runtime/runtime-release-normalizer";
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

// The S01 scene and S02 walkthrough/statement cases that stood here went with
// those sessions' static messages: both are prompt-driven now
// (.claude/TASK_SCOPE.json note2026_09_25_prompt_driven_s01_s02).

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
