/** Rewrites a Program message into something a speech engine reads correctly.
 *
 * The session scripts are written to be *read on screen*: they use em dashes,
 * middle dots, tilde ranges and blank-line paragraph breaks. Handed straight
 * to a synthesizer those either get skipped (so two sentences run together
 * with no pause) or get spelled out ("가운뎃점"). The scripts themselves are
 * source-of-truth clinical copy and are never edited for this -- the rewrite
 * happens here, at the moment of speaking, so `message.content` stays exactly
 * what the manual says and what the on-screen bubble shows.
 */

/** Participates in the M2 audio cache key: bumping it invalidates every
 * previously synthesized clip, which is required whenever the rules below
 * change or the same text would keep resolving to stale audio. */
export const NORMALIZER_VERSION = 1;

// Longest-first: 개월 must win over 개, otherwise "3개월" normalizes as "3개" + "월".
const KOREAN_RANGE_UNIT = "개월|시간|가지|퍼센트|단계|문항|점|분|회|개|일|주|년|초|번|명|세|살|차|%";

const KOREAN_RANGE_WITH_UNIT = new RegExp(`(\\d+)\\s*[~～]\\s*(\\d+)\\s*(${KOREAN_RANGE_UNIT})`, "g");
const BARE_RANGE = /(\d+)\s*[~～]\s*(\d+)/g;
const DASH_RUN = /\s*(—|–|--+)\s*/g;
const MIDDLE_DOT = /\s*[·・]\s*/g;
const PARAGRAPH_BREAK = /[ \t]*\n{2,}[ \t]*/g;
const LINE_BREAK = /[ \t]*\n+[ \t]*/g;
const SENTENCE_END = /[.!?…。]$/;

/** A break after text that already ends in a full stop only needs the pause the
 * stop itself provides; adding another one produces a doubled "." in the audio.
 * A break with nothing before it has nothing to separate at all. */
function breakAfter(whole: string, offset: number, fallback: string) {
  const before = whole.slice(0, offset).trimEnd();
  if (!before) return "";
  return SENTENCE_END.test(before) ? " " : fallback;
}

/** Idempotent: `normalizeSpeechText(normalizeSpeechText(t, l), l) === normalizeSpeechText(t, l)`.
 * Every rule removes the character that triggers it, so a second pass is a no-op.
 * The M2 synthesis route re-applies this defensively before hashing for the
 * audio cache, and must not get a different string than the client did. */
export function normalizeSpeechText(text: string, locale: string): string {
  if (!text) return "";
  const korean = locale.toLowerCase().startsWith("ko");
  // CRLF/CR first, so the line-break rules below only ever face \n. A stray \r
  // would otherwise survive into the utterance and split the paragraph rule.
  let out = text.replace(/\r\n?/g, "\n");

  out = out.replace(/\*\*/g, "").replace(/__/g, "");
  out = out.replace(/^[ \t]*[-*•][ \t]+/gm, "");

  // The unit has to be repeated on both bounds: "0~3점" read as "0에서 3까지점"
  // is not Korean, "0점에서 3점까지" is.
  if (korean) {
    out = out.replace(KOREAN_RANGE_WITH_UNIT, "$1$3에서 $2$3까지");
    out = out.replace(BARE_RANGE, "$1에서 $2까지");
  } else {
    out = out.replace(BARE_RANGE, "$1 to $2");
  }

  out = out.replace(DASH_RUN, ", ");
  out = out.replace(MIDDLE_DOT, ", ");

  out = out.replace(PARAGRAPH_BREAK, (_match, offset: number, whole: string) => breakAfter(whole, offset, ". "));
  out = out.replace(LINE_BREAK, (_match, offset: number, whole: string) => breakAfter(whole, offset, ", "));

  out = out.replace(/\s+([,.])/g, "$1");
  out = out.replace(/,(\s*,)+/g, ",");
  out = out.replace(/,\s*([.!?])/g, "$1");
  out = out.replace(/[ \t]{2,}/g, " ");
  return out.trim();
}
