// What the worksheet SHOWS for a value, as opposed to what is recorded
// (.claude/TASK_SCOPE.json note2026_10_05_worksheet_display_version). The
// recorded value stays the participant's exact words; a prompt-driven session
// may also hold a tidied version for display (runtimeContext.fields
// .promptFieldDisplay, kept by prompt-session-api.ts). Pure and browser-safe: the worksheet UI and the
// optimistic edit (worksheet-edit-client.ts) use it too.

import type { WorksheetFieldValueRecord } from "@/types/worksheet";

/** The tidy list for `raw` when it is one: a string per raw item, same length. */
function asDisplayList(raw: readonly unknown[], display: unknown): string[] | undefined {
  if (!Array.isArray(display) || display.length !== raw.length || !display.every((item) => typeof item === "string")) return undefined;
  return display as string[];
}

/**
 * A list's items as the worksheet shows them: the tidy text where there is
 * one, the recorded words otherwise. A display list that does not match the
 * recorded list item for item (an older or partial one) is ignored as a whole
 * rather than shown against the wrong items.
 */
export function shownListItems(raw: readonly unknown[], display: unknown): string[] {
  const tidy = asDisplayList(raw, display);
  return raw.map((item, index) => {
    const text = tidy?.[index]?.trim();
    return text ? text : String(item ?? "");
  });
}

/** The shown items of a worksheet value whose recorded value is a list. */
export function shownItemsOf(value: Pick<WorksheetFieldValueRecord, "value" | "displayItems"> | null | undefined): string[] {
  const raw = value?.value;
  return Array.isArray(raw) ? shownListItems(raw, value?.displayItems) : [];
}

/**
 * After a list changed without a new tidy list (a participant edit, a turn
 * whose tidy call failed): the tidy text of every item whose recorded words
 * are still in the list carries over -- matched by the words, so a removed
 * item does not shift the others onto the wrong tidy text -- and a new or
 * edited item shows its recorded words. Undefined when nothing tidy is left.
 */
export function carryListDisplay(before: unknown, after: unknown, display: unknown): string[] | undefined {
  if (!Array.isArray(before) || !Array.isArray(after)) return undefined;
  const tidy = asDisplayList(before, display);
  if (!tidy) return undefined;
  const byWords = new Map<string, string>();
  before.forEach((item, index) => {
    const key = String(item ?? "");
    if (!byWords.has(key)) byWords.set(key, tidy[index]);
  });
  const next = after.map((item) => byWords.get(String(item ?? "")) ?? String(item ?? ""));
  return next.some((item, index) => item !== String(after[index] ?? "")) ? next : undefined;
}
