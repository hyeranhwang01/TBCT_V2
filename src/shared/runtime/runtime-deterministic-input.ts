import type { PatientInput } from "@/types/runtime-session";

export function parseEmptyOrWhitespaceInput(input: PatientInput) { const text = Array.isArray(input.value) ? input.value.join("") : String(input.value); return text.trim() ? null : { valid: false as const, reason: "empty_input" }; }
export function parseNumericInput(input: PatientInput) { const match = String(input.value).trim().match(/^-?\d+(?:\.\d+)?%?$/); if (!match) return null; const value = Number(match[0].replace("%", "")); return Number.isFinite(value) ? value : null; }
export function parseRatingInput(input: PatientInput, min = 0, max = 100) { const value = parseNumericInput(input); return value !== null && value >= min && value <= max ? value : null; }
export function parseBooleanInput(input: PatientInput) { if (typeof input.value === "boolean") return input.value; const normalized = String(input.value).trim().toLowerCase(); if (["yes", "y", "true", "1", "네", "예", "응", "sim"].includes(normalized)) return true; if (["no", "n", "false", "0", "아니", "아니요", "não", "nao"].includes(normalized)) return false; return null; }
/**
 * Canonical enum values are snake_case (`not_ready`, `not_guilty`) but the
 * question is spoken as ordinary language ("ready, or not ready?"), so a
 * typed or transcribed answer arrives with a space where the value has an
 * underscore. Exact-matching those rejected every natural phrasing of the
 * single most important answer in S07 (readiness) and S08 (verdict), which
 * then burned all three clarification attempts and paused the session.
 * Collapsing whitespace/underscores/hyphens to one canonical separator makes
 * the comparison strictly more permissive without ever accepting a value the
 * catalog doesn't define.
 */
export function normalizeChoiceToken(value: unknown) { return String(value).trim().toLowerCase().replace(/[\s_\-]+/g, "_"); }

/** Resolves a raw answer to one of `choices`, accepting the catalog-authored
 * `aliases` (translations and natural phrasings) for that value. Always
 * returns the canonical choice, so stored fields and the branch conditions
 * reading them (`verdict equals "guilty"`) stay on canonical values. */
export function matchEnumChoice(rawValue: unknown, choices: unknown[], aliases?: Record<string, unknown> | null) {
  const normalized = normalizeChoiceToken(rawValue);
  if (!normalized) return null;
  const direct = choices.find((choice) => normalizeChoiceToken(choice) === normalized);
  if (direct !== undefined) return direct;
  for (const choice of choices) {
    const choiceAliases = aliases?.[String(choice)];
    if (Array.isArray(choiceAliases) && choiceAliases.some((alias) => normalizeChoiceToken(alias) === normalized)) return choice;
  }
  return null;
}

export function parseMultipleChoiceInput(input: PatientInput, choices: unknown[], aliases?: Record<string, unknown> | null) { return matchEnumChoice(input.value, choices, aliases); }

/**
 * S02's X/Y/Z private-placeholder offer ("would you like to add a private
 * problem?") is a closed-form answer, same family as boolean/enum: the
 * participant either declines, or names one or more of the allowed letters
 * -- they never describe the problem itself. Distinguishes "declined" from
 * "couldn't parse" so an answer that is neither an explicit decline nor a
 * nameable letter (e.g. random off-topic text, or "네" with no letter named)
 * surfaces as invalid/needs-clarification instead of being silently folded
 * into "declined". Returns null only for that genuine parse-failure case.
 */
export function parsePrivatePlaceholderLabelsInput(input: PatientInput, allowedLabels: string[] = ["X", "Y", "Z"]) {
  const text = Array.isArray(input.value) ? input.value.join(" ") : String(input.value);
  if (!text.trim()) return null;
  if (parseBooleanInput(input) === false) return { decline: true as const, labels: [] as string[] };
  const labels = [...new Set((text.match(/[A-Za-z]/g) ?? []).map((letter) => letter.toUpperCase()))].filter((letter) => allowedLabels.includes(letter));
  return labels.length > 0 ? { decline: false as const, labels } : null;
}

export function parseDeterministicPromptInput(input: PatientInput, validation: Record<string, unknown> | null | undefined) {
  const empty = parseEmptyOrWhitespaceInput(input); if (empty) return { handled: true as const, valid: false as const, reason: empty.reason };
  if (validation?.kind === "rating") { const value = parseRatingInput(input, Number(validation.min ?? 0), Number(validation.max ?? 100)); return { handled: true as const, valid: value !== null, value, reason: value === null ? "invalid_rating" : undefined }; }
  if (validation?.kind === "boolean") { const value = parseBooleanInput(input); return { handled: true as const, valid: value !== null, value, reason: value === null ? "invalid_boolean" : undefined }; }
  if (validation?.kind === "enum" && Array.isArray(validation.values)) { const value = parseMultipleChoiceInput(input, validation.values, validation.aliases as Record<string, unknown> | null | undefined); return { handled: true as const, valid: value !== null, value, reason: value === null ? "invalid_choice" : undefined }; }
  if (validation?.kind === "numeric") { const value = parseNumericInput(input); return { handled: true as const, valid: value !== null, value, reason: value === null ? "invalid_number" : undefined }; }
  if (validation?.kind === "private_placeholder_labels") {
    const allowedLabels = Array.isArray(validation.allowed) ? (validation.allowed as unknown[]).map((label) => String(label).toUpperCase()) : ["X", "Y", "Z"];
    const parsed = parsePrivatePlaceholderLabelsInput(input, allowedLabels);
    return { handled: true as const, valid: parsed !== null, value: parsed ? parsed.labels : undefined, reason: parsed === null ? "invalid_private_placeholder_label" : undefined };
  }
  return { handled: false as const };
}
