import { describe, expect, it } from "vitest";
import { applyFieldCorrection, applyWorksheetEdit, confirmedSummariesAfterCorrection, confirmedSummariesAfterWorksheetEdit, fieldCorrectionIssue } from "@/shared/runtime/field-correction";
import { realignListRatingsAfterEdit, refreshListRatingPointers } from "@/shared/runtime/runtime-context";

// Field corrections (.claude/TASK_SCOPE.json note2026_09_14_field_corrections).

const summary = (writeField: string, listIndex?: number) => ({ sourceField: writeField, writeField, listIndex, original: "원래 답", summary: "요약", confirmedAt: "2026-09-14T00:00:00.000Z", patientMessageId: "RMSG-1" });

describe("fieldCorrectionIssue", () => {
  it("accepts a removal or replacement of a value that is really recorded", () => {
    const fields = { s01Problems: ["졸리다", "읎오"], situation: "회의에서 발표했다" };
    expect(fieldCorrectionIssue({ field: "s01Problems", action: "remove_item", currentValue: "읎오" }, fields)).toBeUndefined();
    expect(fieldCorrectionIssue({ field: "s01Problems", action: "replace_value", currentValue: " 읎오 ", newValue: "피곤하다" }, fields)).toBeUndefined();
    expect(fieldCorrectionIssue({ field: "situation", action: "replace_value", currentValue: "회의에서 발표했다", newValue: "회의에서 발표를 망쳤다" }, fields)).toBeUndefined();
  });

  it("refuses what the program cannot honor", () => {
    const fields = { s01Problems: ["졸리다", "읎오"], s01RepresentativeProblem: "졸리다", situation: "회의" };
    expect(fieldCorrectionIssue({ field: "goals", action: "remove_item", currentValue: "x" }, fields)).toBe("correction_field_not_recorded");
    expect(fieldCorrectionIssue({ field: "situation", action: "remove_item", currentValue: "회의" }, fields)).toBe("correction_not_a_list");
    expect(fieldCorrectionIssue({ field: "s01Problems", action: "remove_item", currentValue: "없는 값" }, fields)).toBe("correction_value_not_found");
    expect(fieldCorrectionIssue({ field: "s01Problems", action: "remove_item", currentValue: "졸리다" }, fields)).toBe("correction_removes_selected_item");
    expect(fieldCorrectionIssue({ field: "situation", action: "replace_value", currentValue: "회의", newValue: " " }, fields)).toBe("correction_missing_new_value");
  });
});

describe("applyFieldCorrection", () => {
  it("removes a list item and updates the count", () => {
    const result = applyFieldCorrection({ s01Problems: ["졸리다", "읎오", "피곤하다"], s01ProblemsCount: 3 }, { field: "s01Problems", action: "remove_item", currentValue: "읎오" });
    expect(result).toEqual({ fields: { s01Problems: ["졸리다", "피곤하다"], s01ProblemsCount: 2 }, before: ["졸리다", "읎오", "피곤하다"], after: ["졸리다", "피곤하다"], removedIndex: 1 });
  });

  it("replaces a scalar value, and a list item together with the choice made from it", () => {
    expect(applyFieldCorrection({ situation: "회의" }, { field: "situation", action: "replace_value", currentValue: "회의", newValue: "팀 회의에서 발표" })?.fields).toEqual({ situation: "팀 회의에서 발표" });
    const fields = { s01Problems: ["졸리다", "피곤해"], s01RepresentativeProblem: "피곤해" };
    expect(applyFieldCorrection(fields, { field: "s01Problems", action: "replace_value", currentValue: "피곤해", newValue: "늘 피곤하다" })?.fields).toEqual({ s01Problems: ["졸리다", "늘 피곤하다"], s01RepresentativeProblem: "늘 피곤하다" });
  });

  it("applies nothing when the correction is not valid", () => {
    expect(applyFieldCorrection({ s01Problems: ["졸리다"] }, { field: "s01Problems", action: "remove_item", currentValue: "읎오" })).toBeUndefined();
  });
});

describe("confirmedSummariesAfterCorrection", () => {
  it("drops a removed item's summary and moves later list items up", () => {
    const summaries = { "problems#0": summary("problems", 0), "problems#1": summary("problems", 1), "problems#2": summary("problems", 2), situation: summary("situation") };
    const result = confirmedSummariesAfterCorrection(summaries, { field: "problems", action: "remove_item", currentValue: "b" }, ["a", "b", "c"], 1);
    expect(Object.keys(result ?? {}).sort()).toEqual(["problems#0", "problems#1", "situation"]);
    expect(result?.["problems#1"]).toMatchObject({ listIndex: 1 });
  });

  it("drops the summary of a replaced value", () => {
    expect(confirmedSummariesAfterCorrection({ situation: summary("situation"), goal: summary("goal") }, { field: "situation", action: "replace_value", currentValue: "요약", newValue: "새 값" }, "요약")).toEqual({ goal: summary("goal") });
    expect(confirmedSummariesAfterCorrection({ "problems#1": summary("problems", 1), "problems#0": summary("problems", 0) }, { field: "problems", action: "replace_value", currentValue: "b", newValue: "B" }, ["a", "b"])).toEqual({ "problems#0": summary("problems", 0) });
  });
});

// Participant worksheet edits (.claude/TASK_SCOPE.json
// note2026_09_14_patient_worksheet_edit).
describe("applyWorksheetEdit", () => {
  it("stores a list one trimmed item per line, with its count", () => {
    const result = applyWorksheetEdit({ s01Problems: ["졸리다", "읎오"], s01ProblemsCount: 2 }, "s01Problems", "text_list", " 졸리다 \n\n피곤하다\n");
    expect(result).toEqual({ ok: true, fields: { s01Problems: ["졸리다", "피곤하다"], s01ProblemsCount: 2 }, before: ["졸리다", "읎오"], after: ["졸리다", "피곤하다"] });
  });

  it("reads numbers from a box, and refuses one out of range", () => {
    expect(applyWorksheetEdit({ personalEmotionIntensity: 50 }, "personalEmotionIntensity", "percentage", "70%")).toMatchObject({ ok: true, after: 70 });
    expect(applyWorksheetEdit({ personalEmotionIntensity: 50 }, "personalEmotionIntensity", "percentage", "150")).toEqual({ ok: false, issue: "invalid_number" });
    expect(applyWorksheetEdit({ personalEmotionIntensity: 50 }, "personalEmotionIntensity", "percentage", "많이")).toEqual({ ok: false, issue: "invalid_number" });
  });

  it("removes the field when a text or number box is emptied", () => {
    const result = applyWorksheetEdit({ personalSecondEmotion: "초밥", personalEmotion: "슬픔" }, "personalSecondEmotion", "text", "  ");
    expect(result).toEqual({ ok: true, fields: { personalEmotion: "슬픔" }, before: "초밥", after: undefined });
  });

  it("never drops the difficulty chosen as the one underneath, but carries a reworded one along", () => {
    const fields = { s01Problems: ["졸리다", "피곤해"], s01RepresentativeProblem: "피곤해" };
    expect(applyWorksheetEdit(fields, "s01Problems", "text_list", ["졸리다"])).toEqual({ ok: false, issue: "removes_selected_item" });
    expect(applyWorksheetEdit(fields, "s01Problems", "text_list", ["졸리다", "늘 피곤하다"])).toMatchObject({ ok: true, fields: { s01Problems: ["졸리다", "늘 피곤하다"], s01RepresentativeProblem: "늘 피곤하다" } });
    expect(applyWorksheetEdit(fields, "s01Problems", "text_list", ["피곤해"])).toMatchObject({ ok: true, fields: { s01RepresentativeProblem: "피곤해" } });
  });
});

describe("confirmedSummariesAfterWorksheetEdit", () => {
  it("keeps a summary only where its exact text is still recorded", () => {
    const summaries = { situationLine: { ...summary("situationLine"), summary: "회의에서" }, "problems#0": { ...summary("problems", 0), summary: "a" }, "problems#1": { ...summary("problems", 1), summary: "b" } };
    expect(confirmedSummariesAfterWorksheetEdit(summaries, "situationLine", "회의에서 발표를 망쳤다")).not.toHaveProperty("situationLine");
    expect(confirmedSummariesAfterWorksheetEdit(summaries, "situationLine", "회의에서")).toHaveProperty("situationLine");
    const lists = confirmedSummariesAfterWorksheetEdit(summaries, "problems", ["b", "c"]);
    expect(Object.keys(lists ?? {}).sort()).toEqual(["problems#0", "situationLine"]);
    expect(lists?.["problems#0"]).toMatchObject({ summary: "b", listIndex: 0 });
  });
});

describe("realignListRatingsAfterEdit", () => {
  it("keeps each surviving item's rating when items are only deleted", () => {
    const fields: Record<string, unknown> = { problems: ["a", "c"], problemRatings: [1, 2, 3] };
    realignListRatingsAfterEdit(fields, "problems", ["a", "b", "c"], ["a", "c"]);
    refreshListRatingPointers(fields);
    expect(fields).toMatchObject({ problemRatings: [1, 3], problemRatingsCount: 2, allProblemsRated: true });
  });

  it("leaves ratings in place for a reworded or longer list, and cuts them at the new length otherwise", () => {
    const reworded: Record<string, unknown> = { problems: ["A", "b"], problemRatings: [1, 2] };
    realignListRatingsAfterEdit(reworded, "problems", ["a", "b"], ["A", "b"]);
    expect(reworded.problemRatings).toEqual([1, 2]);
    const longer: Record<string, unknown> = { problems: ["a", "b", "new"], problemRatings: [1, 2] };
    realignListRatingsAfterEdit(longer, "problems", ["a", "b"], ["a", "b", "new"]);
    refreshListRatingPointers(longer);
    expect(longer).toMatchObject({ problemRatings: [1, 2], currentProblemText: "new", allProblemsRated: false });
    const mixed: Record<string, unknown> = { problems: ["x"], problemRatings: [1, 2] };
    realignListRatingsAfterEdit(mixed, "problems", ["a", "b"], ["x"]);
    expect(mixed.problemRatings).toEqual([1]);
  });
});
