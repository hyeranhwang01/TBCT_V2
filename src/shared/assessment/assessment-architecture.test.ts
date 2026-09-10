import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentResultSchema, sanitizeAssessmentResult } from "@/shared/assessment/assessment-contract";
import { redactDirectIdentifiers } from "@/shared/assessment/privacy-redaction";
import { clearModelUsage, listModelUsage, recordModelUsage } from "@/shared/assessment/model-observability";
import { parseBooleanInput, parseMultipleChoiceInput, parseRatingInput } from "@/shared/runtime/runtime-deterministic-input";
import { resolveStaticPatientMessage } from "@/shared/runtime/runtime-static-message";
import type { PromptItem } from "@/shared/protocol/source-fidelity-types";

const request = { locale: "en-US", inputType: "text", patientInput: "answer", nodeGoal: "answer active question", allowedFields: ["situation"], allowedTransitions: ["next_prompt"], safetyCategories: [] };
const result = { inputValid: true, relevance: "relevant", intent: "answer", extractedFields: { situation: "safe", diagnosis: "forbidden" }, completionStatus: "complete", safetyLevel: "none", safetySignals: [], recommendedTransition: "jump_anywhere", internalSummary: null };

describe("cost-aware assessment architecture", () => {
  beforeEach(() => { clearModelUsage(); vi.restoreAllMocks(); });
  it("rejects unknown schema values and removes unauthorized fields and transitions", () => {
    expect(() => assessmentResultSchema.parse({ ...result, intent: "diagnose" })).toThrow();
    const sanitized = sanitizeAssessmentResult(result, request);
    expect(sanitized.extractedFields).toEqual({ situation: "safe" });
    expect(sanitized.recommendedTransition).toBeNull();
  });
  it("parses rating, multiple choice, and yes/no without a model", () => {
    expect(parseRatingInput({ kind: "rating", value: "62%" })).toBe(62);
    expect(parseMultipleChoiceInput({ kind: "single_choice", value: "Better" }, ["same", "better"])).toBe("better");
    expect(parseBooleanInput({ kind: "text", value: "sim" })).toBe(true);
    expect(listModelUsage()).toHaveLength(0);
  });
  it("renders approved and assistant-only content verbatim with zero model cost", () => {
    const prompt = { id: "p", fallbackPatientText: "Approved wording.", editableText: "", verbatimText: "", executionMode: "assistant_only" } as unknown as PromptItem;
    expect(resolveStaticPatientMessage(prompt, "en-US")).toEqual({ patientMessage: "Approved wording.", source: "approved_static", llmCalled: false });
    recordModelUsage({ sessionId: "s", turnId: "t", provider: "none", purpose: "approved_static", llmCalled: false, inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0, retryCount: 0, cacheStatus: "hit", estimatedCost: 0, success: true });
    expect(listModelUsage()[0]).toMatchObject({ llmCalled: false, estimatedCost: 0 });
  });
  it("replaces an English-only approved opening with the safe generic Korean fallback for a Korean session", () => {
    // This used to assert the opposite (raw English shipped verbatim to a
    // ko-KR session) on the theory that a visible language mismatch was
    // safer than a silent generic substitute. In production that meant any
    // PromptItem outside REVIEWED_KOREAN_PROMPT_TEXT with no Hangul in its
    // own fallbackPatientText shipped straight to Korean patients in
    // English -- see runtime-static-message.ts's fix and
    // runtime-static-message.test.ts for the real session this broke.
    // isLocaleConsistentFallbackText's own generic-fallback default is the
    // actual safety net; this test now locks in using it, not bypassing it.
    const prompt = { id: "session-opening", fallbackPatientText: "Begin by checking how the patient is doing today." } as unknown as PromptItem;
    const message = resolveStaticPatientMessage(prompt, "ko-KR")?.patientMessage;
    expect(message).toMatch(/[가-힣]/);
    expect(message).not.toBe("Begin by checking how the patient is doing today.");
  });
  it("redacts direct identifiers before cloud use", () => {
    const redacted = redactDirectIdentifiers("Email me at a@b.com or call 010-1234-5678. account id AB-12345");
    expect(redacted).toContain("[EMAIL]"); expect(redacted).toContain("[PHONE]"); expect(redacted).toContain("[IDENTIFIER]");
    expect(redacted).not.toContain("a@b.com");
  });
});
