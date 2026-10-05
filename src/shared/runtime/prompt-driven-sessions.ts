// Prompt-driven sessions (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02): sessions run end to end by one
// system prompt (src/shared/protocol/session-prompts.generated.ts) through
// src/shared/api/prompt-session-api.ts, instead of the node/prompt engine the
// other sessions use. The model returns the values each turn established; this
// file says which values a session may hold, checks their shape, and runs the
// session's own arithmetic. Nothing here decides what the participant hears.

import { S01_PROMPT_FIELDS } from "@/patient/sessions/s01/prompt-fields";
import { S02_PROMPT_FIELDS } from "@/patient/sessions/s02/prompt-fields";
import { containment, normalizeForMatch } from "@/shared/memory/chunk-scorer";
import { carryListDisplay } from "@/shared/worksheet/field-display";

export type PromptFieldSpec =
  | { name: string; label: string; kind: "text" }
  | { name: string; label: string; kind: "number"; min: number; max: number }
  | { name: string; label: string; kind: "text_list"; length?: number }
  | { name: string; label: string; kind: "number_list"; min: number; max: number; length: number };

export type PromptSessionFieldSet = {
  sessionDefinitionId: string;
  fields: PromptFieldSpec[];
  /** Values the program works out from what was recorded, plus the facts the
   * model is told about them on the next turn. */
  derive?: (fields: Record<string, unknown>, locale?: string) => { fields: Record<string, unknown>; facts: string[] };
};

const FIELD_SETS: Record<string, PromptSessionFieldSet> = {
  "tbct-s01": S01_PROMPT_FIELDS,
  "tbct-s02": S02_PROMPT_FIELDS,
};

export const PROMPT_DRIVEN_SESSIONS: ReadonlySet<string> = new Set(Object.keys(FIELD_SETS));

export function isPromptDrivenSession(sessionDefinitionId: string | undefined): boolean {
  return Boolean(sessionDefinitionId && PROMPT_DRIVEN_SESSIONS.has(sessionDefinitionId));
}

export function promptSessionFieldSet(sessionDefinitionId: string): PromptSessionFieldSet {
  const set = FIELD_SETS[sessionDefinitionId];
  if (!set) throw new Error(`${sessionDefinitionId} is not a prompt-driven session`);
  return set;
}

/** Runtime fields the program writes for the patient view (never the model). */
export const PROMPT_FOCUS_FIELD = "promptFocusField";
export const PROMPT_INPUT_HINT = "promptInputHint";
/** The model's currentThemes from its last turn, for the next retrieval. */
export const PROMPT_THEMES_FIELD = "promptCurrentThemes";
/** What the worksheet shows for a value, by field name: the tidied text (a
 * string, or a string per item for a list), never the recorded value
 * (note2026_10_05_worksheet_display_version). "prompt*" keeps it out of the
 * default memory chunker (chunk-builder.ts PROGRAM_OWNED_FIELD), and the
 * S01/S02 chunkers read named fields only. */
export const PROMPT_DISPLAY_FIELD = "promptFieldDisplay";
export type PromptFieldDisplay = Record<string, string | string[]>;

export const PROMPT_INPUT_HINTS = ["text", "yes_no", "rating_0_100", "score_0_5", "none"] as const;
export type PromptInputHint = (typeof PROMPT_INPUT_HINTS)[number];

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function inRange(value: number, min: number, max: number) {
  return value >= min && value <= max;
}

export type FieldUpdateResult = { accepted: Record<string, unknown>; rejected: Array<{ name: string; reason: string }> };

/**
 * Checks the model's fieldUpdates against the session's field list. A name the
 * session does not list, or a value of the wrong shape, is rejected and
 * reported, never stored. Lists are replaced whole: the model is given the
 * current values every turn and sends the full list back.
 */
export function checkFieldUpdates(sessionDefinitionId: string, updates: Record<string, unknown> | undefined): FieldUpdateResult {
  const specs = new Map(promptSessionFieldSet(sessionDefinitionId).fields.map((spec) => [spec.name, spec]));
  const accepted: Record<string, unknown> = {};
  const rejected: FieldUpdateResult["rejected"] = [];
  for (const [name, value] of Object.entries(updates ?? {})) {
    const spec = specs.get(name);
    if (!spec) {
      rejected.push({ name, reason: "not a field of this session" });
      continue;
    }
    if (value === null || value === undefined) continue;
    if (spec.kind === "text") {
      if (typeof value === "string" && value.trim()) accepted[name] = value.trim();
      else rejected.push({ name, reason: "expected text" });
    } else if (spec.kind === "number") {
      const number = asNumber(value);
      if (number !== null && inRange(number, spec.min, spec.max)) accepted[name] = number;
      else rejected.push({ name, reason: `expected a number from ${spec.min} to ${spec.max}` });
    } else if (spec.kind === "text_list") {
      const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : null;
      if (!list || !list.every((item) => typeof item === "string")) {
        rejected.push({ name, reason: "expected a list of text" });
      } else if (spec.length !== undefined && list.length > spec.length) {
        rejected.push({ name, reason: `expected at most ${spec.length} items` });
      } else {
        accepted[name] = (list as string[]).map((item) => item.trim());
      }
    } else {
      const list = Array.isArray(value) ? value : null;
      const numbers = list?.map((item) => (item === null || item === "" ? null : asNumber(item)));
      const valid = list && numbers && list.length <= spec.length && numbers.every((item, index) => (item === null ? list[index] === null || list[index] === "" : inRange(item, spec.min, spec.max)));
      if (valid) accepted[name] = numbers;
      else rejected.push({ name, reason: `expected a list of at most ${spec.length} numbers from ${spec.min} to ${spec.max} (null for none)` });
    }
  }
  return { accepted, rejected };
}

/** The field list as the model reads it, one line per field. */
export function describePromptFields(sessionDefinitionId: string): string {
  return promptSessionFieldSet(sessionDefinitionId)
    .fields.map((spec) => {
      const shape =
        spec.kind === "text"
          ? "text"
          : spec.kind === "number"
            ? `number ${spec.min}-${spec.max}`
            : spec.kind === "text_list"
              ? `list of text${spec.length ? `, up to ${spec.length} items` : ""}; send the whole list`
              : `list of ${spec.length} numbers ${spec.min}-${spec.max}, null where not given; send the whole list`;
      return `- ${spec.name} (${shape}): ${spec.label}`;
    })
    .join("\n");
}

/** Just the session's fields, for the model's view of the worksheet. */
export function promptSessionFieldValues(sessionDefinitionId: string, fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(promptSessionFieldSet(sessionDefinitionId).fields.filter((spec) => fields[spec.name] !== undefined).map((spec) => [spec.name, fields[spec.name]]));
}

export function derivePromptSessionFields(sessionDefinitionId: string, fields: Record<string, unknown>, locale?: string) {
  const derive = promptSessionFieldSet(sessionDefinitionId).derive;
  return derive ? derive(fields, locale) : { fields, facts: [] };
}

// ---------------------------------------------------------------------------
// Worksheet display text (.claude/TASK_SCOPE.json
// note2026_10_05_worksheet_display_version). The recorded value is the
// participant's exact words and stays so; the worksheet may show a tidied
// version. These checks decide which tidy text is kept:
// only text that is plausibly cut down from the recorded words of that very
// field -- never a number, never longer, never words that were not there.

/** Share of the tidy text's character bigrams that must occur in the
 * recorded words. Fillers and tails go; a rewrite or a relabel ("기쁨" for
 * "기분이 좋았을 것 같아요") does not pass. */
export const DISPLAY_MIN_CONTAINMENT = 0.6;

/** The display map stored in fields, or {} for anything else. */
export function promptFieldDisplay(fields: Record<string, unknown>): PromptFieldDisplay {
  const stored = fields[PROMPT_DISPLAY_FIELD];
  return stored && typeof stored === "object" && !Array.isArray(stored) ? { ...(stored as PromptFieldDisplay) } : {};
}

/** Why `display` is not a tidy version of `raw`, or null when it is. */
export function displayIssue(display: unknown, raw: unknown): string | null {
  if (typeof display !== "string" || typeof raw !== "string") return "expected text";
  const tidy = display.trim();
  const words = raw.trim();
  if (!tidy) return "empty";
  if (tidy.length > words.length) return "longer than the recorded words";
  const normalized = normalizeForMatch(tidy);
  if (!normalized) return "no words";
  // A text of one letter has no bigram to compare; it has to be in the words.
  if (normalized.length < 2) return normalizeForMatch(words).includes(normalized) ? null : "not from the recorded words";
  return containment(tidy, words) >= DISPLAY_MIN_CONTAINMENT ? null : "not from the recorded words";
}

export type FieldDisplayResult = { accepted: PromptFieldDisplay; rejected: Array<{ name: string; reason: string }> };

/**
 * Checks tidy text against the session's field list and the recorded value of
 * each field (`fields`, after this turn's updates). Text and text-list fields
 * only. A list item that fails falls back to its recorded words; a list that
 * does not match the recorded one item for item is rejected whole. Tidy text
 * identical to the recorded words is not stored -- there is nothing to show
 * instead.
 */
export function checkFieldDisplay(sessionDefinitionId: string, display: Record<string, unknown> | undefined, fields: Record<string, unknown>): FieldDisplayResult {
  const specs = new Map(promptSessionFieldSet(sessionDefinitionId).fields.map((spec) => [spec.name, spec]));
  const accepted: PromptFieldDisplay = {};
  const rejected: FieldDisplayResult["rejected"] = [];
  for (const [name, value] of Object.entries(display ?? {})) {
    const spec = specs.get(name);
    const raw = fields[name];
    if (!spec) {
      rejected.push({ name, reason: "not a field of this session" });
    } else if (spec.kind !== "text" && spec.kind !== "text_list") {
      rejected.push({ name, reason: "numbers are never tidied" });
    } else if (raw === undefined) {
      rejected.push({ name, reason: "nothing recorded" });
    } else if (spec.kind === "text") {
      const issue = displayIssue(value, raw);
      if (issue) rejected.push({ name, reason: issue });
      else if ((value as string).trim() !== (raw as string).trim()) accepted[name] = (value as string).trim();
    } else if (!Array.isArray(raw) || !Array.isArray(value) || value.length !== raw.length) {
      rejected.push({ name, reason: "expected one text per recorded item" });
    } else {
      const items = raw.map((item, index) => {
        const words = String(item ?? "");
        const issue = displayIssue(value[index], words);
        if (issue) {
          rejected.push({ name: `${name}#${index}`, reason: issue });
          return words;
        }
        return (value[index] as string).trim();
      });
      if (items.some((item, index) => item !== String(raw[index] ?? "").trim())) accepted[name] = items;
    }
  }
  return { accepted, rejected };
}

/**
 * The display map after a turn. A field whose recorded value changed keeps
 * display text only if this turn brought new, accepted text for it -- for a
 * list, items whose recorded words did not change keep theirs
 * (carryListDisplay) -- so the worksheet never shows the tidy version of
 * words that are no longer recorded. Every other field keeps what it had.
 */
export function nextFieldDisplay(previousDisplay: PromptFieldDisplay, previousFields: Record<string, unknown>, nextFields: Record<string, unknown>, changedNames: Iterable<string>, accepted: PromptFieldDisplay): PromptFieldDisplay {
  const next: PromptFieldDisplay = { ...previousDisplay };
  for (const name of changedNames) {
    if (accepted[name] !== undefined) continue;
    const carried = carryListDisplay(previousFields[name], nextFields[name], previousDisplay[name]);
    if (carried) next[name] = carried;
    else delete next[name];
  }
  return { ...next, ...accepted };
}
