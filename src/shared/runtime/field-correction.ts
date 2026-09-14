import { z } from "zod";
import type { ConfirmedSummaryRecord } from "@/types/runtime-session";

/**
 * Field corrections (.claude/TASK_SCOPE.json note2026_09_14_field_corrections).
 *
 * Once an answer is recorded, nothing in the conversation could take it back:
 * a live S01 test stored the typo "읎오" (meant as "없어요", nothing more) as a
 * second difficulty, and it stayed on the worksheet. Now the dialogue agent
 * can propose a correction -- remove a list item, or replace a value with the
 * participant's own words -- and the program applies it only after the
 * participant says yes (runtime-execution-api.ts's
 * deliverReflectionCheckReplyTurn). This module decides whether a proposed
 * correction can be applied to the recorded fields, and applies it.
 */

export const fieldCorrectionSchema = z.object({
  field: z.string(),
  action: z.enum(["remove_item", "replace_value"]),
  /** The value exactly as it is recorded now. */
  currentValue: z.string(),
  /** replace_value only: the participant's own words. */
  newValue: z.string().optional(),
  reason: z.string().optional(),
});
export type FieldCorrection = z.infer<typeof fieldCorrectionSchema>;

/** A value chosen FROM a list. Removing the chosen item would leave a later
 * step pointing at something that no longer exists, and the program cannot
 * re-ask a step that is already done, so that removal is refused; replacing
 * the item's wording carries the choice along. */
const LINKED_SELECTIONS: ReadonlyArray<{ listField: string; selectionField: string }> = [
  { listField: "s01Problems", selectionField: "s01RepresentativeProblem" },
];

function normalizeValue(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function indexOfValue(list: unknown[], value: string) {
  return list.findIndex((item) => typeof item === "string" && normalizeValue(item) === normalizeValue(value));
}

/** Why a correction cannot be applied to these fields, or undefined when it can. */
export function fieldCorrectionIssue(correction: FieldCorrection, fields: Record<string, unknown>): string | undefined {
  const value = fields[correction.field];
  if (value === undefined || value === null || value === "") return "correction_field_not_recorded";
  if (correction.action === "remove_item") {
    if (!Array.isArray(value)) return "correction_not_a_list";
    if (indexOfValue(value, correction.currentValue) < 0) return "correction_value_not_found";
    const linked = LINKED_SELECTIONS.find((item) => item.listField === correction.field);
    const selected = linked ? fields[linked.selectionField] : undefined;
    if (typeof selected === "string" && normalizeValue(selected) === normalizeValue(correction.currentValue)) return "correction_removes_selected_item";
    return undefined;
  }
  if (!correction.newValue?.trim()) return "correction_missing_new_value";
  if (typeof value === "string") return normalizeValue(value) === normalizeValue(correction.currentValue) ? undefined : "correction_value_not_found";
  if (Array.isArray(value)) return indexOfValue(value, correction.currentValue) >= 0 ? undefined : "correction_value_not_found";
  return "correction_unsupported_value";
}

/** The fields with the correction applied (list count included), or undefined
 * when it cannot be applied. Ratings paired with a list and pointers derived
 * from it are left to the caller (runtime-context.ts). */
export function applyFieldCorrection(fields: Record<string, unknown>, correction: FieldCorrection): { fields: Record<string, unknown>; before: unknown; after: unknown; removedIndex?: number } | undefined {
  if (fieldCorrectionIssue(correction, fields)) return undefined;
  const next = { ...fields };
  const before = fields[correction.field];
  if (correction.action === "remove_item") {
    const list = [...(before as unknown[])];
    const removedIndex = indexOfValue(list, correction.currentValue);
    list.splice(removedIndex, 1);
    next[correction.field] = list;
    next[`${correction.field}Count`] = list.length;
    return { fields: next, before, after: list, removedIndex };
  }
  const newValue = correction.newValue!.trim();
  if (typeof before === "string") {
    next[correction.field] = newValue;
    return { fields: next, before, after: newValue };
  }
  const list = [...(before as unknown[])];
  list[indexOfValue(list, correction.currentValue)] = newValue;
  next[correction.field] = list;
  const linked = LINKED_SELECTIONS.find((item) => item.listField === correction.field);
  const selected = linked ? fields[linked.selectionField] : undefined;
  if (linked && typeof selected === "string" && normalizeValue(selected) === normalizeValue(correction.currentValue)) next[linked.selectionField] = newValue;
  return { fields: next, before, after: list };
}

// Participant worksheet edits (.claude/TASK_SCOPE.json
// note2026_09_14_patient_worksheet_edit): the participant rewrites a box on
// their own worksheet instead of asking in the chat. Same rules as a
// correction -- the value is the participant's own, a choice made from a list
// cannot lose its item -- but no confirmation question, since they typed the
// new value themselves.

export type WorksheetEditIssue = "invalid_number" | "removes_selected_item";

export function normalizeWorksheetEditValue(valueType: string, raw: unknown): { value: unknown } | { issue: WorksheetEditIssue } {
  if (valueType === "text_list") {
    const items = Array.isArray(raw) ? raw : String(raw ?? "").split("\n");
    return { value: items.map((item) => String(item).trim()).filter(Boolean) };
  }
  if (valueType === "percentage" || valueType === "integer") {
    const text = String(raw ?? "").replace(/%/g, "").trim();
    if (!text) return { value: undefined };
    const number = Number(text);
    if (!Number.isFinite(number) || (valueType === "percentage" && (number < 0 || number > 100))) return { issue: "invalid_number" };
    return { value: Math.round(number) };
  }
  const text = String(raw ?? "").trim();
  return { value: text ? text : undefined };
}

/** The fields with one worksheet box rewritten (list count included; an
 * empty text or number box removes the field). Ratings paired with a list and
 * pointers derived from it are left to the caller (runtime-context.ts). */
export function applyWorksheetEdit(fields: Record<string, unknown>, field: string, valueType: string, raw: unknown): { ok: true; fields: Record<string, unknown>; before: unknown; after: unknown } | { ok: false; issue: WorksheetEditIssue } {
  const normalized = normalizeWorksheetEditValue(valueType, raw);
  if ("issue" in normalized) return { ok: false, issue: normalized.issue };
  const after = normalized.value;
  const before = fields[field];
  const next = { ...fields };
  if (after === undefined) delete next[field];
  else next[field] = after;
  if (Array.isArray(after)) next[`${field}Count`] = after.length;

  const linked = LINKED_SELECTIONS.find((item) => item.listField === field);
  const selected = linked ? fields[linked.selectionField] : undefined;
  if (linked && typeof selected === "string" && Array.isArray(after) && indexOfValue(after, selected) < 0) {
    // Reworded in place (same length): the choice follows its item.
    const selectedIndex = Array.isArray(before) && before.length === after.length ? indexOfValue(before, selected) : -1;
    if (selectedIndex < 0) return { ok: false, issue: "removes_selected_item" };
    next[linked.selectionField] = after[selectedIndex];
  }
  return { ok: true, fields: next, before, after };
}

/** Confirmed summaries after a worksheet edit: a summary stays confirmed only
 * where its exact text is still recorded (a list item may have moved). */
export function confirmedSummariesAfterWorksheetEdit(summaries: Record<string, ConfirmedSummaryRecord> | undefined, field: string, after: unknown): Record<string, ConfirmedSummaryRecord> | undefined {
  if (!summaries) return summaries;
  const next: Record<string, ConfirmedSummaryRecord> = {};
  for (const [key, record] of Object.entries(summaries)) {
    const match = /^(.*)#(\d+)$/.exec(key);
    if (!match) {
      if (key !== field || record.summary === after) next[key] = record;
      continue;
    }
    if (match[1] !== field) { next[key] = record; continue; }
    const index = Array.isArray(after) ? after.findIndex((item) => item === record.summary) : -1;
    if (index >= 0) next[`${field}#${index}`] = { ...record, listIndex: index };
  }
  return next;
}

/** Confirmed summaries (runtimeContext.confirmedSummaries) after a
 * correction: a replaced value is no longer the confirmed summary, and list
 * items after a removed one move up by one. */
export function confirmedSummariesAfterCorrection(summaries: Record<string, ConfirmedSummaryRecord> | undefined, correction: FieldCorrection, before: unknown, removedIndex?: number): Record<string, ConfirmedSummaryRecord> | undefined {
  if (!summaries) return summaries;
  const next: Record<string, ConfirmedSummaryRecord> = {};
  const replacedIndex = removedIndex === undefined && Array.isArray(before) ? indexOfValue(before, correction.currentValue) : -1;
  for (const [key, record] of Object.entries(summaries)) {
    const match = /^(.*)#(\d+)$/.exec(key);
    if (!match) {
      if (!(key === correction.field && removedIndex === undefined && !Array.isArray(before))) next[key] = record;
      continue;
    }
    const index = Number(match[2]);
    if (match[1] !== correction.field) { next[key] = record; continue; }
    if (index === removedIndex || index === replacedIndex) continue;
    const shifted = removedIndex !== undefined && index > removedIndex ? index - 1 : index;
    next[`${correction.field}#${shifted}`] = { ...record, listIndex: shifted };
  }
  return next;
}
