// A patient occasionally asks, mid-session, to switch which language the
// assistant responds in ("한국어로 해주세요", "please respond in English")
// instead of answering whatever the currently active clinical question is.
// Before this existed, that request was graded like any other patient
// message -- an attempted answer to the active prompt -- which almost
// always failed relevance grading (a language request has "no plausible
// connection" to e.g. "what automatic thought went through your mind"),
// triggering the normal insufficient_input clarification loop up to
// MAX_CLARIFICATION_ATTEMPTS times while session.locale (and therefore the
// actual reply language) never moved at all. See submitPatientInput's
// languageSwitchLocale branch in runtime-execution-api.ts, which checks this
// BEFORE the normal extraction/clarification pipeline gets a chance to
// misjudge the message as a wrong answer.
//
// Deliberately deterministic (no LLM call -- also skips a wasted assessment
// round-trip on the hot path) and deliberately narrow: only fires when the
// entire message is essentially just the language request, so a longer
// message that happens to mention a language in passing (and might also
// carry something clinically important) is never silently short-circuited
// out of the normal pipeline.
const MAX_LENGTH = 40;
const KOREAN_SWITCH_KEYWORDS = /한국어|한글/;
const ENGLISH_SWITCH_KEYWORDS = /\benglish\b/i;

export type LanguageSwitchLocale = "ko-KR" | "en-US";

export function detectLanguageSwitchRequest(rawText: string): LanguageSwitchLocale | null {
  const text = rawText.trim();
  if (!text || text.length > MAX_LENGTH) return null;
  if (KOREAN_SWITCH_KEYWORDS.test(text)) return "ko-KR";
  if (ENGLISH_SWITCH_KEYWORDS.test(text)) return "en-US";
  return null;
}
