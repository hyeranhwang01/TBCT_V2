import type { ConfirmedSummaryRecord } from "@/types/runtime-session";
import { getWorksheetBindings } from "@/shared/worksheet/worksheet-binding-registry";
import { S01_SUMMARY_WRITE_FIELDS } from "@/patient/sessions/s01/worksheet-binding";

/**
 * Open dialogue v1 (.claude/TASK_SCOPE.json note2026_09_14_open_dialogue_v1).
 *
 * When a participant's answer to a free-text worksheet field is long, the
 * dialogue agent summarizes it on the next turn and asks whether that is
 * right. Only after an explicit "yes" (runtime-execution-api.ts's
 * deliverReflectionCheckReplyTurn) does the confirmed summary replace the
 * stored value; the original answer is kept in
 * runtimeContext.confirmedSummaries and as the worksheet's
 * participantVerbatim.
 *
 * The answer itself is always stored first, exactly as given, by
 * extractRuntimeState -- this module only decides whether that stored value
 * is one a summary may later stand in for.
 */

/** Long enough to summarize: more than 40 characters (Korean) / 90 (other
 * locales), or two or more sentences. Introduced for S01's one-line boxes
 * (user decision 2026-09-12) and reused for every session. */
export function isLongAnswer(text: string, locale: string) {
  const trimmed = text.trim();
  const sentences = trimmed.split(/(?<=[.!?。])\s+|\n+/).filter((part) => part.trim().length > 1).length;
  return locale.toLowerCase().startsWith("ko") ? trimmed.length > 40 || sentences >= 2 : trimmed.length > 90 || sentences >= 2;
}

export type LongAnswerSummaryTarget = {
  /** Field the participant answered. */
  field: string;
  /** Field a confirmed summary is written to -- the same field, except where
   * a session keeps the original in its own field (S01's one-line boxes). */
  writeField: string;
  /** Set when `field` is a list and the answer was appended as this item. */
  listIndex?: number;
  originalValue: string;
  promptItemId: string;
};

const SUMMARIZABLE_VALUE_TYPES: ReadonlySet<string> = new Set(["text", "text_list"]);

function normalizeAnswer(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** The field a summary of this answer may stand in for, or undefined when the
 * answer is short, the field is not free text on the worksheet, or the answer
 * was not stored as given (a duplicate, an accepted hint, a stop word). */
export function resolveLongAnswerSummaryTarget(input: {
  sessionDefinitionId: string;
  locale: string;
  promptItem: { id: string; outputFields: string[] };
  answerText: string;
  fields: Record<string, unknown>;
}): LongAnswerSummaryTarget | undefined {
  const field = input.promptItem.outputFields[0];
  if (!field || !isLongAnswer(input.answerText, input.locale)) return undefined;
  const binding = getWorksheetBindings(input.sessionDefinitionId).find((item) => item.canonicalFieldKey === field);
  if (!binding || !SUMMARIZABLE_VALUE_TYPES.has(binding.valueType)) return undefined;
  if (input.fields[`${field}Duplicate`] === true || input.fields[`${field}Source`] === "accepted_hint") return undefined;
  const answer = normalizeAnswer(input.answerText);
  const value = input.fields[field];
  const writeField = input.sessionDefinitionId === "tbct-s01" ? S01_SUMMARY_WRITE_FIELDS[field] ?? field : field;
  if (typeof value === "string" && normalizeAnswer(value) === answer) {
    return { field, writeField, originalValue: value, promptItemId: input.promptItem.id };
  }
  if (Array.isArray(value) && value.length > 0 && writeField === field) {
    const listIndex = value.length - 1;
    const item = value[listIndex];
    if (typeof item === "string" && normalizeAnswer(item) === answer) {
      return { field, writeField, listIndex, originalValue: item, promptItemId: input.promptItem.id };
    }
  }
  return undefined;
}

/** Reads a target back from message metadata (it round-trips through the store). */
export function readLongAnswerSummaryTarget(value: unknown): LongAnswerSummaryTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const target = value as Partial<LongAnswerSummaryTarget>;
  if (typeof target.field !== "string" || typeof target.writeField !== "string" || typeof target.originalValue !== "string" || typeof target.promptItemId !== "string") return undefined;
  if (target.listIndex !== undefined && (typeof target.listIndex !== "number" || !Number.isInteger(target.listIndex) || target.listIndex < 0)) return undefined;
  return { field: target.field, writeField: target.writeField, listIndex: target.listIndex, originalValue: target.originalValue, promptItemId: target.promptItemId };
}

/** Key of a confirmed summary in runtimeContext.confirmedSummaries -- the
 * written field, plus `#index` for a list item. */
export function confirmedSummaryKey(target: Pick<LongAnswerSummaryTarget, "writeField" | "listIndex">) {
  return target.listIndex === undefined ? target.writeField : `${target.writeField}#${target.listIndex}`;
}

/** Fields with the confirmed summary written in, or undefined when the stored
 * value no longer matches the answer that was summarized (it changed in the
 * meantime), in which case nothing is written. List-derived values other than
 * the count are left to the caller (runtime-context.ts's
 * refreshListRatingPointers). */
export function applyConfirmedSummaryToFields(fields: Record<string, unknown>, target: LongAnswerSummaryTarget, summary: string): Record<string, unknown> | undefined {
  const trimmed = summary.trim();
  if (!trimmed) return undefined;
  const next = { ...fields };
  const current = next[target.field];
  if (target.listIndex !== undefined) {
    if (!Array.isArray(current)) return undefined;
    const item = current[target.listIndex];
    if (typeof item !== "string" || normalizeAnswer(item) !== normalizeAnswer(target.originalValue)) return undefined;
    const list = [...current];
    list[target.listIndex] = trimmed;
    next[target.field] = list;
    next[`${target.field}Count`] = list.length;
    return next;
  }
  if (typeof current !== "string" || normalizeAnswer(current) !== normalizeAnswer(target.originalValue)) return undefined;
  next[target.writeField] = trimmed;
  return next;
}

export function confirmedSummaryRecord(target: LongAnswerSummaryTarget, summary: string, patientMessageId: string, confirmedAt: string): ConfirmedSummaryRecord {
  return { sourceField: target.field, writeField: target.writeField, listIndex: target.listIndex, original: target.originalValue, summary: summary.trim(), confirmedAt, patientMessageId };
}
