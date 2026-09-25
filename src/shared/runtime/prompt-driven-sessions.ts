// Prompt-driven sessions (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02): sessions run end to end by one
// system prompt (src/shared/protocol/session-prompts.generated.ts) through
// src/shared/api/prompt-session-api.ts, instead of the node/prompt engine the
// other sessions use. The model returns the values each turn established; this
// file says which values a session may hold, checks their shape, and runs the
// session's own arithmetic. Nothing here decides what the participant hears.

import { S01_PROMPT_FIELDS } from "@/patient/sessions/s01/prompt-fields";
import { S02_PROMPT_FIELDS } from "@/patient/sessions/s02/prompt-fields";

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
