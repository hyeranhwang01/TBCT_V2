import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAssessmentModel, resetAssessmentModelForTests } from "@/lib/assessment/assessment-providers";
import type { AssessmentRequest } from "@/lib/assessment/assessment-contract";

// Exercises the real deterministic classifier (classifyOpenListTurn /
// classifyRatingCorrectionTurn) through its only public seam
// (getAssessmentModel().assessInput), rather than via a scripted/mocked
// AssessmentModel the way the higher-level S02 flow tests do -- those tests
// intentionally bypass this classifier, so it had no direct regression
// coverage before this file. ASSESSMENT_PROVIDER is forced to "deterministic"
// so this doesn't depend on ambient env state; this is also this repo's
// actual default (no cloud credentials configured in dev/test).
const originalProvider = process.env.ASSESSMENT_PROVIDER;

beforeEach(() => {
  process.env.ASSESSMENT_PROVIDER = "deterministic";
  resetAssessmentModelForTests();
});

afterEach(() => {
  if (originalProvider === undefined) delete process.env.ASSESSMENT_PROVIDER;
  else process.env.ASSESSMENT_PROVIDER = originalProvider;
  resetAssessmentModelForTests();
});

function openListRequest(patientInput: string, locale = "en-US"): AssessmentRequest {
  return { locale, inputType: "text", patientInput, nodeGoal: "collect one problem at a time", allowedFields: ["problems"], allowedTransitions: [], safetyCategories: [] };
}

function ratingCorrectionRequest(patientInput: string, locale = "en-US"): AssessmentRequest {
  return { locale, inputType: "text", patientInput, nodeGoal: "rate the current problem", allowedFields: ["problemRatings"], allowedTransitions: [], safetyCategories: [] };
}

function s01SituationRequest(patientInput: string, locale = "en-US"): AssessmentRequest {
  return { locale, inputType: "text", patientInput, nodeGoal: "describe a personally experienced situation", allowedFields: ["situationThoughtDistinction"], allowedTransitions: [], safetyCategories: [] };
}

describe("DeterministicAssessmentModel: open-list turn classification (Phase 2 gate)", () => {
  it.each([
    ["What question?", "clarification_request"],
    ["What does that mean?", "clarification_request"],
    ["What does this goal mean?", "clarification_request"],
    ["Why are you asking that again?", "clarification_request"],
    ["What should I say?", "clarification_request"],
    ["I already said that.", "clarification_request"],
    ["I already said that before.", "clarification_request"],
    ["I don't understand the question.", "clarification_request"],
  ])("%s -> turnAction=%s (English meta/clarification)", async (text, expected) => {
    const result = await getAssessmentModel().assessInput(openListRequest(text));
    expect(result.turnAction).toBe(expected);
  });

  it.each([
    ["That's a cute dog!", "unresolved"],
    ["Nice weather today", "unresolved"],
    ["I'm hungry", "unresolved"],
  ])("%s -> turnAction=%s (English unrelated content)", async (text, expected) => {
    const result = await getAssessmentModel().assessInput(openListRequest(text));
    expect(result.turnAction).toBe(expected);
  });

  it.each([
    "I'm struggling to concentrate at work",
    "I feel anxious most mornings",
    "I want to spend more time with my kids",
    "I can't sleep before big meetings",
  ])("%s -> turnAction=accept_answer (English candidate content)", async (text) => {
    const result = await getAssessmentModel().assessInput(openListRequest(text));
    expect(result.turnAction).toBe("accept_answer");
  });

  it("'Can I get treatment for OCD?' is a counselor question, not a problem to record", async () => {
    const result = await getAssessmentModel().assessInput(openListRequest("Can I get treatment for OCD?"));
    expect(result.turnAction).toBe("clarification_request");
  });

  it("Korean regression: meta/clarification patterns are unaffected by the English additions", async () => {
    const result = await getAssessmentModel().assessInput(openListRequest("무슨 질문이요?", "ko-KR"));
    expect(result.turnAction).toBe("clarification_request");
  });
});

describe("DeterministicAssessmentModel: S01 situation relevance", () => {
  it.each([
    ["오늘 날씨가 어때?", "ko-KR"],
    ["What's the weather today?", "en-US"],
  ])("%s is redirected instead of being stored as the participant's situation", async (text, locale) => {
    const result = await getAssessmentModel().assessInput(s01SituationRequest(text, locale));
    expect(result.inputValid).toBe(false);
    expect(result.relevance).toBe("irrelevant");
    expect(result.intent).toBe("topic_shift");
    expect(result.completionStatus).toBe("needs_clarification");
  });

  it("does not reject a genuine personal event merely because weather is involved", async () => {
    const result = await getAssessmentModel().assessInput(s01SituationRequest("비 때문에 약속이 취소돼서 속상했어요.", "ko-KR"));
    expect(result.inputValid).toBe(true);
    expect(result.relevance).toBe("relevant");
  });
});

describe("DeterministicAssessmentModel: rating-correction turn classification (Phase 3 gate)", () => {
  it.each([
    ["This isn't a goal.", "current_item_correction"],
    ["That's not a goal.", "current_item_correction"],
    ["I never said that was a goal.", "current_item_correction"],
    ["I didn't say that was a problem.", "current_item_correction"],
  ])("%s -> turnAction=%s (English reject)", async (text, expected) => {
    const result = await getAssessmentModel().assessInput(ratingCorrectionRequest(text));
    expect(result.turnAction).toBe(expected);
  });

  it.each([
    ["I already rated this.", "current_item_correction"],
    ["Same as the one before.", "current_item_correction"],
    ["Why do I have to rate this again?", "current_item_correction"],
    ["We already covered this.", "current_item_correction"],
  ])("%s -> turnAction=%s (English duplicate)", async (text, expected) => {
    const result = await getAssessmentModel().assessInput(ratingCorrectionRequest(text));
    expect(result.turnAction).toBe(expected);
  });

  it.each([
    ["This is also a question.", "current_item_correction"],
    ["That's also a question.", "current_item_correction"],
    ["This is actually a question.", "current_item_correction"],
  ])("%s -> turnAction=%s (English question contamination)", async (text, expected) => {
    const result = await getAssessmentModel().assessInput(ratingCorrectionRequest(text));
    expect(result.turnAction).toBe(expected);
  });

  it.each([
    ["I want to change my answer.", "unresolved"],
    ["Let me change that.", "unresolved"],
    ["Change my answer to 3.", "unresolved"],
    ["I said 5 before, change it to 4.", "unresolved"],
  ])("%s -> turnAction=%s (English revision, not implemented -- must not mutate the list)", async (text, expected) => {
    const result = await getAssessmentModel().assessInput(ratingCorrectionRequest(text));
    expect(result.turnAction).toBe(expected);
  });

  it.each([
    ["What does that mean?", "clarification_request"],
    ["I don't understand the question.", "clarification_request"],
  ])("%s -> turnAction=%s (English clarification)", async (text, expected) => {
    const result = await getAssessmentModel().assessInput(ratingCorrectionRequest(text));
    expect(result.turnAction).toBe(expected);
  });

  it("Korean regression: rating-correction patterns are unaffected by the English additions", async () => {
    const result = await getAssessmentModel().assessInput(ratingCorrectionRequest("이건 목표가 아니에요", "ko-KR"));
    expect(result.turnAction).toBe("current_item_correction");
  });
});
