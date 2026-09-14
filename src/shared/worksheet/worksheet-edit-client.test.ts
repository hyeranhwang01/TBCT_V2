import { describe, expect, it } from "vitest";
import { withOptimisticWorksheetEdit } from "@/shared/worksheet/worksheet-edit-client";
import { TBCT_S01_BINDINGS } from "@/patient/sessions/s01/worksheet-binding";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// The new words show before the save returns (.claude/TASK_SCOPE.json
// note2026_09_14_patient_worksheet_edit, followUp2026_09_14_speed).

function view(values: Record<string, unknown>): WorksheetView {
  const fields = Object.entries(values).map(([key, value]): WorksheetFieldView => {
    const binding = TBCT_S01_BINDINGS.find((item) => item.worksheetFieldKey === key)!;
    return {
      definition: { id: `def-${key}`, templateVersionId: "t", canonicalFieldKey: key, worksheetFieldKey: key, valueType: binding.valueType, participantOwned: binding.participantOwned, assistantMustNotSupply: binding.assistantMustNotSupply, confirmationRequired: binding.confirmationRequired, visualElementId: binding.visualElementId, displayOrder: binding.displayOrder },
      binding,
      value: { id: `v-${key}`, instanceId: "i", fieldDefinitionId: `def-${key}`, status: "draft_extracted", provenance: "participant_verbatim", value, displayValue: Array.isArray(value) ? value.join(", ") : String(value), updatedAt: "2026-09-14T00:00:00.000Z" },
    };
  });
  return {
    instance: { id: "i", runtimeSessionId: "r", templateVersionId: "t", status: "in_progress", createdAt: "", updatedAt: "" },
    templateVersion: { id: "t", templateId: "t", version: 1, sourceTextHash: "h", status: "published", createdAt: "" },
    fields,
  };
}

const valueOf = (worksheet: WorksheetView, key: string) => worksheet.fields.find((field) => field.definition.worksheetFieldKey === key)?.value;

describe("withOptimisticWorksheetEdit", () => {
  const before = view({ openingInitialThought: "나를 무시하는 거야", s01Problems: ["졸리다", "읎오"], personalEmotionIntensity: 50 });

  it("shows text, list and number edits as they will be stored", () => {
    expect(valueOf(withOptimisticWorksheetEdit(before, "openingInitialThought", " 나를 무시했어 "), "openingInitialThought")).toMatchObject({ value: "나를 무시했어", displayValue: "나를 무시했어", status: "participant_edited" });
    expect(valueOf(withOptimisticWorksheetEdit(before, "s01Problems", ["졸리다"]), "s01Problems")).toMatchObject({ value: ["졸리다"], displayValue: "졸리다" });
    expect(valueOf(withOptimisticWorksheetEdit(before, "personalEmotionIntensity", "80"), "personalEmotionIntensity")).toMatchObject({ value: 80, displayValue: "80" });
    expect(valueOf(withOptimisticWorksheetEdit(before, "openingInitialThought", ""), "openingInitialThought")).toMatchObject({ value: "", displayValue: "" });
  });

  it("leaves the worksheet as it is for an edit the server will refuse, and never touches other boxes", () => {
    expect(withOptimisticWorksheetEdit(before, "personalEmotionIntensity", "150")).toBe(before);
    expect(withOptimisticWorksheetEdit(before, "unknownField", "x")).toBe(before);
    const edited = withOptimisticWorksheetEdit(before, "openingInitialThought", "새 생각");
    expect(valueOf(edited, "s01Problems")).toBe(valueOf(before, "s01Problems"));
  });
});
