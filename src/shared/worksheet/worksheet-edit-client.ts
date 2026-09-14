import { runtimeFetch } from "@/shared/runtime/resolve-store-url";
import { normalizeWorksheetEditValue } from "@/shared/runtime/field-correction";
import type { WorksheetFieldValueRecord, WorksheetView } from "@/types/worksheet";

// Saving a worksheet edit (.claude/TASK_SCOPE.json
// note2026_09_14_patient_worksheet_edit, followUp2026_09_14_speed). The
// browser sends one request to /api/worksheets/edit, which runs
// editWorksheetField next to the database; server-side callers run it
// directly. A refused edit throws with the `worksheet_edit:<code>` message.

export type WorksheetEditInput = { runtimeSessionId: string; sessionDefinitionId: string; worksheetFieldKey: string; value: unknown };

export async function saveWorksheetEdit(input: WorksheetEditInput): Promise<WorksheetFieldValueRecord> {
  if (typeof window === "undefined") {
    const { editWorksheetField } = await import("@/shared/worksheet/worksheet-projection");
    return editWorksheetField(input.runtimeSessionId, input.sessionDefinitionId, input.worksheetFieldKey, input.value);
  }
  const response = await runtimeFetch("/api/worksheets/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; result?: WorksheetFieldValueRecord; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.result) throw new Error(payload?.error ?? "Worksheet edit failed.");
  return payload.result;
}

/** The worksheet as it will read once the edit is saved, so the new words
 * show at once. An edit the server will refuse (a number out of range) is
 * left out -- the old words stay and the refusal explains why. */
export function withOptimisticWorksheetEdit(view: WorksheetView, worksheetFieldKey: string, raw: unknown): WorksheetView {
  const target = view.fields.find((field) => field.definition.worksheetFieldKey === worksheetFieldKey);
  if (!target?.value) return view;
  const normalized = normalizeWorksheetEditValue(target.binding.valueType, raw);
  if ("issue" in normalized) return view;
  // Same stored shape as editWorksheetField: an emptied box reads as "".
  const value = normalized.value ?? "";
  const displayValue = Array.isArray(value) ? value.join(", ") : String(value);
  const nextValue = { ...target.value, value, displayValue, status: "participant_edited" as const };
  return { ...view, fields: view.fields.map((field) => (field === target ? { ...field, value: nextValue } : field)) };
}
