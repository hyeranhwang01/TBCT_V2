import { describe, expect, it } from "vitest";
import { applyConfirmedSummaryToFields, confirmedSummaryKey, confirmedSummaryRecord, isLongAnswer, readLongAnswerSummaryTarget, resolveLongAnswerSummaryTarget } from "@/shared/runtime/long-answer";

// Open dialogue v1 (.claude/TASK_SCOPE.json note2026_09_14): which answers a
// confirmed summary may stand in for, and how it is written.

const LONG_KO = "상사가 회의에서 제 보고서를 보고 한숨을 쉬었는데, 그때 저를 무능하다고 생각하는 것 같았어요.";

describe("isLongAnswer", () => {
  it("uses 40 characters for Korean, 90 otherwise, or two sentences", () => {
    expect(isLongAnswer("가".repeat(40), "ko-KR")).toBe(false);
    expect(isLongAnswer("가".repeat(41), "ko-KR")).toBe(true);
    expect(isLongAnswer("회의가 싫어요. 발표도 싫어요.", "ko-KR")).toBe(true);
    expect(isLongAnswer("a".repeat(90), "en-US")).toBe(false);
    expect(isLongAnswer("a".repeat(91), "en-US")).toBe(true);
  });
});

describe("resolveLongAnswerSummaryTarget", () => {
  it("targets a free-text field whose stored value is the long answer", () => {
    const target = resolveLongAnswerSummaryTarget({ sessionDefinitionId: "tbct-s03", locale: "ko-KR", promptItem: { id: "tbct-s03-n04-p01-automatic-thought", outputFields: ["automaticThought"] }, answerText: LONG_KO, fields: { automaticThought: LONG_KO } });
    expect(target).toEqual({ field: "automaticThought", writeField: "automaticThought", originalValue: LONG_KO, promptItemId: "tbct-s03-n04-p01-automatic-thought" });
  });

  it("targets the list item the answer was appended as", () => {
    const target = resolveLongAnswerSummaryTarget({ sessionDefinitionId: "tbct-s02", locale: "ko-KR", promptItem: { id: "tbct-s02-n05-p01-review-distortion", outputFields: ["distortionExamples"] }, answerText: LONG_KO, fields: { distortionExamples: ["잠을 잘 못 자요", LONG_KO] } });
    expect(target).toMatchObject({ field: "distortionExamples", writeField: "distortionExamples", listIndex: 1, originalValue: LONG_KO });
  });

  it("sends S01's situation and thought summaries to their one-line boxes", () => {
    const target = resolveLongAnswerSummaryTarget({ sessionDefinitionId: "tbct-s01", locale: "ko-KR", promptItem: { id: "tbct-s01-n05-p01-recent-moment", outputFields: ["situationThoughtDistinction"] }, answerText: LONG_KO, fields: { situationThoughtDistinction: LONG_KO } });
    expect(target).toMatchObject({ field: "situationThoughtDistinction", writeField: "situationLine" });
  });

  it("leaves short answers, non-text fields, duplicates, accepted hints and unstored answers alone", () => {
    const base = { sessionDefinitionId: "tbct-s03", locale: "ko-KR", promptItem: { id: "p", outputFields: ["automaticThought"] }, answerText: LONG_KO };
    expect(resolveLongAnswerSummaryTarget({ ...base, answerText: "무능하다고요", fields: { automaticThought: "무능하다고요" } })).toBeUndefined();
    expect(resolveLongAnswerSummaryTarget({ ...base, promptItem: { id: "p", outputFields: ["automaticThoughtBeliefPercent"] }, fields: { automaticThoughtBeliefPercent: LONG_KO } })).toBeUndefined();
    expect(resolveLongAnswerSummaryTarget({ ...base, fields: { automaticThought: LONG_KO, automaticThoughtDuplicate: true } })).toBeUndefined();
    expect(resolveLongAnswerSummaryTarget({ ...base, fields: { automaticThought: LONG_KO, automaticThoughtSource: "accepted_hint" } })).toBeUndefined();
    expect(resolveLongAnswerSummaryTarget({ ...base, fields: { automaticThought: "다른 값" } })).toBeUndefined();
    expect(resolveLongAnswerSummaryTarget({ ...base, fields: {} })).toBeUndefined();
  });
});

describe("applyConfirmedSummaryToFields", () => {
  it("replaces a scalar answer with the confirmed summary", () => {
    const target = { field: "automaticThought", writeField: "automaticThought", originalValue: LONG_KO, promptItemId: "p" };
    expect(applyConfirmedSummaryToFields({ automaticThought: LONG_KO, other: 1 }, target, " 상사가 저를 무능하다고 볼 것 같았다 ")).toEqual({ automaticThought: "상사가 저를 무능하다고 볼 것 같았다", other: 1 });
  });

  it("writes to a separate field and keeps the original where the session asks for it", () => {
    const target = { field: "situationThoughtDistinction", writeField: "situationLine", originalValue: LONG_KO, promptItemId: "p" };
    expect(applyConfirmedSummaryToFields({ situationThoughtDistinction: LONG_KO }, target, "회의에서 상사가 한숨을 쉼")).toEqual({ situationThoughtDistinction: LONG_KO, situationLine: "회의에서 상사가 한숨을 쉼" });
  });

  it("replaces one list item and keeps the count", () => {
    const target = { field: "problems", writeField: "problems", listIndex: 1, originalValue: LONG_KO, promptItemId: "p" };
    expect(applyConfirmedSummaryToFields({ problems: ["잠을 잘 못 자요", LONG_KO] }, target, "회의 때 무능해 보일까 걱정됨")).toEqual({ problems: ["잠을 잘 못 자요", "회의 때 무능해 보일까 걱정됨"], problemsCount: 2 });
  });

  it("writes nothing when the stored value changed or the summary is empty", () => {
    const target = { field: "automaticThought", writeField: "automaticThought", originalValue: LONG_KO, promptItemId: "p" };
    expect(applyConfirmedSummaryToFields({ automaticThought: "바뀐 답" }, target, "요약")).toBeUndefined();
    expect(applyConfirmedSummaryToFields({ automaticThought: LONG_KO }, target, "  ")).toBeUndefined();
    expect(applyConfirmedSummaryToFields({ problems: ["하나"] }, { ...target, field: "problems", writeField: "problems", listIndex: 1 }, "요약")).toBeUndefined();
  });
});

describe("summary target bookkeeping", () => {
  it("round-trips through message metadata and keys list items by index", () => {
    const target = { field: "problems", writeField: "problems", listIndex: 0, originalValue: LONG_KO, promptItemId: "p" };
    expect(readLongAnswerSummaryTarget(JSON.parse(JSON.stringify(target)))).toEqual(target);
    expect(readLongAnswerSummaryTarget({ field: "x" })).toBeUndefined();
    expect(readLongAnswerSummaryTarget({ ...target, listIndex: -1 })).toBeUndefined();
    expect(confirmedSummaryKey(target)).toBe("problems#0");
    expect(confirmedSummaryKey({ writeField: "situationLine" })).toBe("situationLine");
    expect(confirmedSummaryRecord(target, " 요약 ", "RMSG-1", "2026-09-14T00:00:00.000Z")).toEqual({ sourceField: "problems", writeField: "problems", listIndex: 0, original: LONG_KO, summary: "요약", confirmedAt: "2026-09-14T00:00:00.000Z", patientMessageId: "RMSG-1" });
  });
});
