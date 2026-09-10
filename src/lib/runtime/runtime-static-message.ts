import { resolvePromptLocaleText } from "@/lib/runtime/runtime-release-normalizer";
import * as s01 from "@/lib/runtime/static-messages/s01";
import * as s02 from "@/lib/runtime/static-messages/s02";
import * as s03 from "@/lib/runtime/static-messages/s03";
import * as s04 from "@/lib/runtime/static-messages/s04";
import * as s05 from "@/lib/runtime/static-messages/s05";
import * as s06 from "@/lib/runtime/static-messages/s06";
import * as s07 from "@/lib/runtime/static-messages/s07";
import * as s08 from "@/lib/runtime/static-messages/s08";
import type { PromptItem } from "@/lib/protocol/source-fidelity-types";
import type { RuntimeContext } from "@/types/runtime-session";

export type StaticMessageResult = { patientMessage: string; source: "approved_static"; llmCalled: false };

// Owned by static-messages/field-helpers.ts, a leaf module: the per-session
// static-message modules need these, and importing them from here created a
// cycle (normalizer -> static-messages/s0N -> here -> normalizer) that could
// leave REVIEWED_KOREAN_PROMPT_TEXT empty depending on module order.
// Re-exported so existing importers of this module keep working.
export { firstText, ratingNumbers, reflectThenAskForNextRating } from "@/lib/runtime/static-messages/field-helpers";

// Each session owns its own dynamic-text branches, its own safety-pause
// line (if it has one), and its own slice of the approved static-text map --
// see src/lib/runtime/static-messages/s0N.ts. Every one of those checks an
// exact-string PromptItem ID that already encodes its own session number
// and is globally unique, so there's no possible cross-session overlap --
// dispatching straight to the matching session's own handler by parsing the
// number out of the ID is exactly equivalent to (but far cheaper and far
// less entangled than) checking all 8 sessions' branches in one function.
const SESSION_HANDLERS: Record<number, (promptItem: PromptItem, fields: Record<string, unknown>, locale: string) => string | undefined> = {
  1: (promptItem, fields, locale) => s01.resolveStaticText(promptItem, fields, locale),
  2: (promptItem, fields, locale) => s02.resolveStaticText(promptItem, fields, locale),
  3: (promptItem, fields, locale) => s03.resolveStaticText(promptItem, fields, locale),
  4: (promptItem) => s04.resolveStaticText(promptItem),
  5: (promptItem, fields, locale) => s05.resolveStaticText(promptItem, fields, locale),
  6: (promptItem, fields, locale) => s06.resolveStaticText(promptItem, fields, locale),
  7: (promptItem, fields, locale) => s07.resolveStaticText(promptItem, fields, locale),
  8: (promptItem, fields, locale) => s08.resolveStaticText(promptItem, fields, locale),
};

function contextualPatientText(promptItem: PromptItem, context: RuntimeContext | undefined, locale: string) {
  const fields = context?.fields ?? {};
  const sessionNumber = Number(/^tbct-s(\d+)-/.exec(promptItem.id)?.[1]);
  return SESSION_HANDLERS[sessionNumber]?.(promptItem, fields, locale);
}

const BRACKET_PLACEHOLDER_SOURCES: Array<{ pattern: RegExp; fieldCandidates: string[]; naturalFallback: string }> = [
  { pattern: /\[event[^\]]*\]/gi, fieldCandidates: ["residualShameEvent", "precipitatingEvent", "situation", "interpersonalSituation", "distressingSituation"], naturalFallback: "that situation" },
  { pattern: /\[core situation[^\]]*\]/gi, fieldCandidates: ["symptomCoreSituation", "coreSituation"], naturalFallback: "that situation" },
  { pattern: /\[problem[^\]]*\]/gi, fieldCandidates: ["currentProblemText"], naturalFallback: "that problem" },
  { pattern: /\[goal[^\]]*\]/gi, fieldCandidates: ["currentGoalText"], naturalFallback: "that goal" },
  { pattern: /\[item[^\]]*\]/gi, fieldCandidates: ["currentSymptomItemText"], naturalFallback: "that item" },
  { pattern: /\[emotion named at q3a\]/gi, fieldCandidates: ["primaryEmotion"], naturalFallback: "the emotion you named earlier" },
  // The six below were found by exhaustively resolving every canonical
  // PromptItem's static text with empty runtime fields and checking for a
  // surviving "[...]" -- each is a genuine slot a human therapist fills
  // from session context (source-fidelity-catalog.ts's own S01/S02/S03
  // nodes name the field that holds it), not a decorative bracket.
  { pattern: /\[their situation[^\]]*\]/gi, fieldCandidates: ["situationThoughtDistinction"], naturalFallback: "that situation" },
  { pattern: /\[their initial thought[^\]]*\]/gi, fieldCandidates: ["openingInitialThought"], naturalFallback: "the thought you mentioned" },
  { pattern: /\[situation\]/gi, fieldCandidates: [], naturalFallback: "that situation" },
  { pattern: /\[description of lower score\]/gi, fieldCandidates: [], naturalFallback: "the lower rating" },
  { pattern: /\[description of higher score\]/gi, fieldCandidates: [], naturalFallback: "the higher rating" },
  { pattern: /\[factual event\]/gi, fieldCandidates: ["situation"], naturalFallback: "what actually happened" },
  { pattern: /\[underlying belief\]/gi, fieldCandidates: ["workingAutomaticThought"], naturalFallback: "what that means to you" },
  { pattern: /\[initial conclusion\]/gi, fieldCandidates: ["balancedConclusion"], naturalFallback: "the conclusion you reached" },
  { pattern: /\[extended conclusion\]/gi, fieldCandidates: ["conclusionTherefore"], naturalFallback: "what that leads you to" },
  { pattern: /\[repeat the patient'?s exact at\]/gi, fieldCandidates: ["automaticThought"], naturalFallback: "that original thought" },
];

/**
 * The pasted TBCT source text sometimes uses bracketed placeholders (e.g.
 * "[event]") that a human therapist fills in from session context before
 * speaking. Left unresolved these leak literally into the patient-facing
 * message. Substitute a captured field value when we have one, otherwise
 * fall back to natural unbracketed wording rather than reciting "[event]".
 */
export function resolveBracketPlaceholders(text: string, context?: { fields?: Record<string, unknown> }) {
  const fields = context?.fields ?? {};
  return BRACKET_PLACEHOLDER_SOURCES.reduce((acc, { pattern, fieldCandidates, naturalFallback }) => {
    const resolvedValue = fieldCandidates.map((field) => fields[field]).find((value) => typeof value === "string" && value.trim());
    return acc.replace(pattern, typeof resolvedValue === "string" ? resolvedValue.trim() : naturalFallback);
  }, text);
}

export function resolveStaticPatientMessage(promptItem: PromptItem, locale: string, context?: RuntimeContext): StaticMessageResult | null {
  const approved = contextualPatientText(promptItem, context, locale);
  if (approved) return { patientMessage: resolveBracketPlaceholders(resolvePromptLocaleText(promptItem.id, approved, locale), context), source: "approved_static", llmCalled: false };
  // fallbackPatientText on a canonical PromptItem is already reviewed patient
  // content by the time the release is built (see
  // runtime-release-normalizer.ts's sourceSpecificRuntimeFallback, which is
  // where instruction-shaped text gets caught and rewritten into a real
  // question). Re-running the full strict check here would also reject
  // already-approved wording that merely starts with an ordinary verb, so
  // this only blocks the narrow, unambiguous "this is a pasted internal
  // document" shapes -- headers, code fences, and instruction-style bullets.
  const fallback = promptItem.fallbackPatientText?.trim() ?? "";
  const obviousInternalDocument = /^(?:---\s*)?(?:#{1,6}\s*)?(?:interaction style|role and purpose|safety and clinical guardrails|important guidelines)\b/i.test(fallback)
    || /^(?:```|[-*]\s+(?:use|do not|never|always|close by)\b)/i.test(fallback);
  if (fallback && !obviousInternalDocument) {
    // NOT "prefer the raw English fallback whenever the locale-safe path
    // would land on the generic Korean line" -- that used to be exactly
    // what this did (recognizing the generic line by its own text and
    // reverting to `fallback` instead), which silently shipped raw English
    // to a Korean session on every PromptItem outside REVIEWED_KOREAN_PROMPT_TEXT
    // whose source text has no Hangul in it -- precisely the case
    // resolvePromptLocaleText's own generic-fallback behavior exists to
    // prevent (see isLocaleConsistentFallbackText's comment). Trust its
    // decision instead of second-guessing it back to English here.
    return { patientMessage: resolveBracketPlaceholders(resolvePromptLocaleText(promptItem.id, fallback, locale), context), source: "approved_static", llmCalled: false };
  }
  return null;
}
