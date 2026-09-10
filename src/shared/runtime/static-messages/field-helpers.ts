/**
 * Pure field-reading helpers for the per-session static-message modules.
 *
 * These live in a leaf module on purpose. They used to be imported from
 * runtime-static-message.ts, which imports runtime-release-normalizer.ts,
 * which in turn imports every static-messages/s0N module to build
 * REVIEWED_KOREAN_PROMPT_TEXT -- a cycle. Under a module order that entered
 * it from the normalizer side, `s0N.koreanText` was still undefined when that
 * object literal was spread, so every reviewed Korean prompt text silently
 * vanished and Korean sessions fell back to the generic locale line. Keeping
 * these helpers dependency-free breaks the cycle at its only real edge.
 */

export function firstText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).find(Boolean);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function ratingNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(ratingNumbers);
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (typeof value === "string") return [...value.matchAll(/\b[0-5]\b/g)].map((match) => Number(match[0]));
  return [];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// The manual's 0-5 color scale (tbct-source-text.generated.ts:305-310,
// 359-364) -- fixed number-to-color mapping, not a per-item field, so it's
// computed here rather than invented as a new tracked field.
const SCALE_COLORS = ["light blue", "dark blue", "light green", "dark green", "yellow", "red"];
function colorForScore(score: number) {
  return SCALE_COLORS[score] ?? "";
}

/**
 * Builds the "reflect the just-rated item, then ask for the next one" text
 * for a rate-one-list-item-at-a-time prompt (CCPH problems, CCGH goals) --
 * see runtime-context.ts's LIST_RATING_PAIRS, which this mirrors using the
 * same two arrays (the list and its parallel ratings) rather than a separate
 * pointer, since the just-rated item's own name isn't kept anywhere once the
 * pointer field advances to the next item.
 */
export function reflectThenAskForNextRating(input: { listField: unknown; ratingsField: unknown; askVerb: string }) {
  const list = stringList(input.listField);
  const ratings = ratingNumbers(input.ratingsField);
  const parts: string[] = [];
  if (ratings.length > 0 && list[ratings.length - 1]) {
    const score = ratings[ratings.length - 1];
    parts.push(`Thank you. So ${list[ratings.length - 1]} is a ${score} — ${colorForScore(score)} — for you right now.`);
  }
  const next = list[ratings.length];
  if (next) parts.push(`${input.askVerb} ${next}?`);
  return parts.join(" ") || undefined;
}
