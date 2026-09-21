import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { StateExtractionResult } from "@/types/runtime-session";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";

// S02 turn rules (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions).
// submitPatientInput calls applyS02TurnRules once per S02 patient turn, right
// after extractRuntimeState and before the worksheet projection, so whatever is
// written here is seen by the same turn's activation conditions, the repeat
// loop's completion condition, the worksheet and the commit.
//
// Rules are keyed by prompt SLUG, never by the positional prompt id. Risk level
// and risk signals are never touched: a turn carrying any risk signal is
// returned unchanged, so the safety edge to safety-pause always wins.
//
// The fifteen-pattern walkthrough is driven from here rather than from
// runtime-context.ts: the generic `array` path already appends a real answer to
// distortionExamples, so all that is left is session-local -- record an empty
// row when nothing comes to mind, and raise allDistortionsReviewed once every
// pattern has a row. That keeps the loop out of shared code.

export type S02TurnRulesInput = {
  extracted: StateExtractionResult;
  promptItem: PromptItem;
  rawText: string;
  locale: string;
};
export type S02TurnRulesLog = { summary: string; output: Record<string, unknown> };
export type S02TurnRulesOutput = { extracted: StateExtractionResult; logs: S02TurnRulesLog[] };

export function s02PromptSlug(promptItemId: string): string | null {
  const match = /^tbct-s02-n\d+-p\d+-(.+)$/.exec(promptItemId);
  return match ? match[1] : null;
}

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/^[.,!?~…'"`]+|[.,!?~…'"`]+$/g, "").trim();
}

const YES = new Set([
  "네", "네네", "예", "응", "어", "그래", "그래요", "좋아요", "좋습니다", "괜찮아요", "괜찮습니다", "알겠어요", "알겠습니다",
  "그렇게 할게요", "그렇게 해요", "할 수 있어요", "할 수 있을 것 같아요", "가능해요",
  "yes", "yeah", "yep", "sure", "ok", "okay", "alright", "fine", "sounds good", "i can", "i think i can",
]);
const NO = new Set([
  "아니", "아니요", "아니오", "아뇨", "싫어요", "싫습니다", "별로요", "안 괜찮아요", "안괜찮아요", "잘 모르겠어요",
  "no", "nope", "not really", "i'd rather not", "i would rather not",
]);

/** A bare yes/no is a complete answer only where the step actually asks one --
 * elsewhere the engine is right to treat it as filler. */
export function isBareYesNo(text: string) {
  const value = normalize(text);
  return YES.has(value) || NO.has(value);
}
function isBareNo(text: string) {
  return NO.has(normalize(text));
}

const DECLINE_CONTAINS = ["그만", "안 할래", "안할래", "하기 싫", "하고 싶지 않", "다음에 할", "다음에 하", "오늘은 안", "멈추", "멈출", "stop", "not today", "another time", "don't want", "do not want"];
const GO_ON_CONTAINS = ["해볼게", "해 볼게", "진행할게", "계속할게", "계속 할게", "이어서 할게", "좋아요", "yes", "okay", "sure", "go on", "let's"];

/** "오늘은 그만할래요" vs "네, 해볼게요" -- a leading yes or any go-on phrase
 * wins over a decline phrase in the same answer. */
export function declinesToGoOn(text: string) {
  const value = normalize(text);
  if (YES.has(value)) return false;
  if (GO_ON_CONTAINS.some((phrase) => value.includes(phrase))) return false;
  return isBareNo(text) || DECLINE_CONTAINS.some((phrase) => value.includes(phrase));
}

// 01:30 of the recording: "15개의 카테고리가 있는데 그 카테고리에 어떤 게 어떻게
// 해당되는지 정확히 구분이 잘 안됐던 어려움이 있었던 것 같아요."
const TYPE_CONFUSION = [
  "구분이 안", "구분이 잘 안", "구분하기 어려", "구분하기 힘들", "구분이 어려", "헷갈", "혼란", "어느 유형", "어떤 유형",
  "어디에 해당", "어느 것에 해당", "비슷해서", "겹치는", "하나만 고르기",
  "hard to tell", "hard to distinguish", "couldn't tell", "could not tell", "confus", "overlap", "which category", "which one it is",
];
function looksLikeTypeConfusion(text: string) {
  const value = normalize(text);
  return TYPE_CONFUSION.some((phrase) => value.includes(phrase));
}

// "없어요" / "생각 안 나요" / "패스" -- a real answer for this pattern, not a
// refusal and not a non-answer. The row stays empty and the loop moves on.
const NO_EXAMPLE_EXACT = new Set([
  "없어요", "없습니다", "없음", "없는 것 같아요", "없는것같아요", "딱히 없어요", "딱히 없습니다", "잘 없어요",
  "모르겠어요", "잘 모르겠어요", "생각 안 나요", "생각이 안 나요", "생각나지 않아요", "떠오르지 않아요", "패스", "넘어가요", "넘어갈게요",
  "none", "nothing", "no example", "nothing comes to mind", "can't think of one", "cannot think of one", "skip", "pass",
]);
const NO_EXAMPLE_CONTAINS = ["딱히 없", "해당 없", "해당되는 게 없", "예시가 없", "예가 없", "생각 안 나", "생각이 안 나", "떠오르지 않", "넘어가", "nothing comes to mind", "can't think of", "cannot think of", "no example", "doesn't apply", "does not apply"];
export function hasNoExampleForPattern(text: string) {
  const value = normalize(text);
  return NO_EXAMPLE_EXACT.has(value) || NO_EXAMPLE_CONTAINS.some((phrase) => value.includes(phrase));
}

// 06:30: "그런데 이게 왜 왜곡인지 느껴지세요?" -- the counselor asks when the
// participant does not yet see it. Only an explicit why/understanding signal
// counts, so "생각 안 나요" stays a no-example answer.
const UNCLEAR_CONTAINS = ["왜 왜곡", "왜곡인지 모르", "왜곡인지 잘 모르", "이해가 안", "이해가 잘 안", "무슨 말인지", "무슨 뜻", "이게 왜", "왜 그런", "why is that", "why is this", "don't understand", "do not understand", "what do you mean"];
function looksLikeDistortionUnclear(text: string) {
  const value = normalize(text);
  return UNCLEAR_CONTAINS.some((phrase) => value.includes(phrase));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

/** Frequency and intensity can legitimately be null for an item whose score the
 * participant stated outright, so the list keeps the holes. */
function numberOrNullList(value: unknown): Array<number | null> {
  return Array.isArray(value) ? value.map((item) => (typeof item === "number" && Number.isFinite(item) ? item : null)) : [];
}

// ---------------------------------------------------------------- CD-Quest
//
// The grid from the book's appendix (Table A1): frequency across, intensity
// down, and the cell is the item's score.
//
//                      no    1-2 days  3-5 days  6-7 days
//   a little (<=30%)    0        1         2         3
//   quite (31-70%)      0        2         3         4
//   very much (>70%)    0        3         4         5
//
// which is frequency + intensity - 1, and 0 whenever it did not occur. Fifteen
// items x 5 = 0-75, matching the book's own stated range. The real second
// session's fifteen answers come to 34 under this formula, which is the total
// the recording states -- pinned by a test.
export type CdQuestGrade = 0 | 1 | 2 | 3;

export function cdQuestScore(frequency: CdQuestGrade, intensity: CdQuestGrade): number {
  if (frequency === 0 || intensity === 0) return 0;
  return frequency + intensity - 1;
}

// An English answer spells the day counts out at least as often as it writes
// them in digits ("three to five days"), so both forms are read.
const FREQUENCY_PATTERNS: Array<{ grade: CdQuestGrade; patterns: RegExp[] }> = [
  // "It did not come up at all this week" -- the negation and "at all" are not
  // adjacent, so the verb phrases are matched in their own right.
  { grade: 0, patterns: [/없었|없어|없음|안\s*나타|나타나지\s*않|해당\s*없/, /\b(none|never|not at all|not this week)\b|\b(?:did\s*n[o']t|does\s*n[o']t|didn.t|doesn.t)\s+(?:come up|happen|occur|show up|apply)/i] },
  { grade: 3, patterns: [/6\s*일?\s*[-~]?\s*(?:에서)?\s*7\s*일|거의\s*매일|매일|늘|항상|하루도\s*빠짐없/, /\b((?:6|six)\s*(?:-|to)\s*(?:7|seven)|almost every day|every day|daily|always|constantly)\b/i] },
  { grade: 2, patterns: [/3\s*일?\s*[-~]?\s*(?:에서)?\s*5\s*일|중간\s*정도|절반|꽤\s*자주/, /\b((?:3|three)\s*(?:-|to)\s*(?:5|five)|much of the time|about half|fairly often)\b/i] },
  { grade: 1, patterns: [/1\s*일?\s*[-~]?\s*(?:에서)?\s*2\s*일|하루\s*이틀|한\s*두\s*번|한두\s*번|가끔|드물|이따금/, /\b((?:1|one)\s*(?:-|to|or)\s*(?:2|two)|once or twice|occasionally|rarely|now and then)\b/i] },
];

const INTENSITY_PATTERNS: Array<{ grade: CdQuestGrade; patterns: RegExp[] }> = [
  { grade: 3, patterns: [/아주\s*강|매우\s*강|정말\s*강|심하게|아주\s*세게/, /\b(?:very\s+(?:much|strong)|extremely|intensely)/i] },
  // "강한 정도"/"강하게" without 아주 is the middle band, as the recording used it.
  { grade: 2, patterns: [/꽤|좀\s*강|강한\s*정도|강하게|보통\s*정도|중간\s*강도/, /\b(quite|fairly strong|moderate|somewhat strong)\b/i] },
  { grade: 1, patterns: [/약간|조금|살짝|약하게|크지\s*않/, /\b(a little|slight|mild|not much|weak)\b/i] },
];

function gradeFrom(text: string, table: Array<{ grade: CdQuestGrade; patterns: RegExp[] }>): CdQuestGrade | null {
  for (const row of table) if (row.patterns.some((pattern) => pattern.test(text))) return row.grade;
  return null;
}

/** A percentage maps straight onto the intensity bands the book gives. */
function intensityFromPercent(text: string): CdQuestGrade | null {
  const match = /(\d{1,3})\s*%/.exec(text);
  if (!match) return null;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  if (percent === 0) return 0;
  if (percent <= 30) return 1;
  if (percent <= 70) return 2;
  return 3;
}

/** "2점" -- the recording's participant answered this way repeatedly. A bare
 * number is deliberately NOT read as a score: "2" could as easily be the 3-5
 * day band, so the step asks again instead of guessing. */
function directScore(text: string): number | null {
  const match = /(?:^|[^0-9])([0-5])\s*점/.exec(text);
  return match ? Number(match[1]) : null;
}

export type CdQuestReading = { frequency: CdQuestGrade | null; intensity: CdQuestGrade | null; score: number | null };

export function readCdQuestAnswer(rawText: string): CdQuestReading {
  const text = normalize(rawText);
  const frequency = gradeFrom(text, FREQUENCY_PATTERNS);
  const intensity = intensityFromPercent(text) ?? gradeFrom(text, INTENSITY_PATTERNS);
  if (frequency === 0) return { frequency: 0, intensity: 0, score: 0 };
  if (frequency !== null && intensity !== null) return { frequency, intensity, score: cdQuestScore(frequency, intensity) };
  const stated = directScore(text);
  // A stated score stands on its own; the two halves stay unknown.
  if (stated !== null) return { frequency, intensity, score: stated };
  return { frequency, intensity, score: null };
}

// 50:10: "나는 그냥 원래 불안한 사람이야 라고 받아들이고 있었는데".
const INNATE_PATTERNS = [/선천적|타고|원래\s*(그런|불안|이런)|천성|체질/, /\b(born (?:this way|with it)|just how i am|innate)\b/i];
function looksLikeInnateAttribution(text: string) {
  const value = normalize(text);
  return INNATE_PATTERNS.some((pattern) => pattern.test(value));
}

// "네 알겠습니다" answers the explanation, not the question. Mirrors
// runtime-context.ts's own isListAcknowledgementOnly, which used to cover this
// step while distortionExamples was a validation.kind "array" output field; the
// two-turn rhythm took the field out of outputFields, so the guard has to live
// here now. Only the ASK turn needs it -- on the discussion turn an
// acknowledgement is a complete answer.
const ACKNOWLEDGEMENT_ONLY =
  /^(?:yes|yes i am|yes i'?m ready|ok|okay|got it|understood|i understand|ready|네|예|응|네 알겠습니다|알겠습니다|이해했습니다|이해했어요|준비됐어요|준비되었습니다|좋습니다|좋아요)$/;
export function isAcknowledgementOnly(text: string): boolean {
  return ACKNOWLEDGEMENT_ONLY.test(normalize(text).replace(/[.!?。！？，,]/g, "").trim());
}

// Swapping one's own example for a better one is something the participant does,
// not the guide. At lines 150-159 of the transcript she volunteers a different
// example than the one she had written down for this pattern: "숙제에 적어놓은
// 거랑 지금 다른 예시가 생각이 나는데, 제가 잘못 적은 것 같기도 했고 ... 근데
// 지금 생각이 드는 거는 [다른 예시]". There it happens inside her first answer,
// so the text simply IS the example; this path covers the same move arriving one
// turn later, after the guide has said something about the first one.
//
// To be accurate about the evidence: the transcript does NOT show a replacement
// on a discussion turn. The nearest moment, at 313-327, is the counselor naming
// a doubt ("다른 유형에 속하지 않을까 하는 생각이 듭니다") and then keeping her
// example anyway ("좋은 예예요, 그 예를 좀 써봅시다"). So this is an
// accommodation of a real participant behaviour rather than a transcribed
// exchange -- and either way the row is rewritten in place, never moved to
// another pattern.
//
// Only a reply long enough to BE an example counts; a bare agreement is not one.
const REPLACEMENT_HINTS = [
  "그것보다", "그거보다", "이것보다", "차라리", "오히려", "다른 예", "다시 생각해보니", "다시 생각하니", "이게 더", "이런 예",
  "instead", "rather than that", "a better example", "actually", "on second thought",
];
export function offersReplacementExample(text: string): boolean {
  const value = normalize(text);
  if (value.length < 12) return false;
  if (isBareYesNo(text)) return false;
  return REPLACEMENT_HINTS.some((hint) => value.includes(hint));
}

/**
 * What goes in the worksheet cell, as opposed to what they said.
 *
 * "저 사람이 나한테 인사를 안했으니까, 나를 싫어할꺼야 라고 생각했습니다" is a
 * sentence about a thought; the cell wants the thought. Only the reporting
 * frame around it comes off -- no summarising, no rewording, nothing shortened.
 * The row stays the participant's own words, which is what
 * assistantMustNotSupply means for this field, and the chat message keeps the
 * sentence exactly as they typed it.
 *
 * Deliberately deterministic. Handing this to the model would put it back
 * inside a participant-owned field, and the ask was explicitly to clean rather
 * than to summarise.
 *
 * Conservative by construction: anything it cannot confidently strip is left
 * alone, and a result that comes out empty or suspiciously short falls back to
 * the original, so a miss is never worse than today's behaviour.
 */
// A reporting frame in three shapes, because Korean attaches the quotative
// particle to the clause as often as it detaches it. Each branch has to leave
// grammatical Korean behind; the first build cut at the particle regardless and
// turned "...무너질 거라고 생각했어요" into "...무너질 거".
const REPORT_VERB = "(?:생각|느꼈|느껴|느낀|봤|여겼|믿었|받아들였|탓했)";
// "...싫어할꺼야 라고 생각했습니다" -- the thought is already a finished
// sentence, so the frame simply comes off.
const DETACHED_QUOTE = new RegExp(`\\s*(?:[,·]\\s*)?(?:라|이라)고\\s*${REPORT_VERB}\\S*$`);
// "...좋았던 거라고 생각했음" -- the particle is fused to the bound noun 거/것,
// which is left dangling by a plain cut. Unwinds to the plain form it quotes.
const FUSED_BOUND_NOUN = new RegExp(`(거|것)\\s*(?:라|이라)고\\s*${REPORT_VERB}\\S*$`);
// "...운이 좋았다고 느꼈어요" -- -다고 unwinds to -다, a complete sentence.
const FUSED_DECLARATIVE = new RegExp(`다고\\s*${REPORT_VERB}\\S*$`);
// "...어떡하지 하는 생각이 들어요".
const NOMINALISED_REPORT = /\s*(?:라고|하고)?\s*하?는?\s*(?:생각|느낌)(?:이|을)?\s*(?:들었|들어|했|해)\S*$/;
const TRAILING_HEDGE = /\s*(?:인\s*것\s*같아요|것\s*같아요|같았어요|같습니다)$/;
const LEADING_FILLERS = [/^(?:음+|어+|그+)[,.\s]+/, /^(?:제가\s*생각한\s*(?:건|것은)|예를\s*들(?:면|어서))[,\s]+/];
/**
 * Whether what is left reads as a finished sentence. The unwinding branches
 * above produce one by construction; this catches the cases they do not cover,
 * where leaving the text alone is the right answer.
 */
const SENTENCE_END = /(?:야|어|아|요|다|까|네|지|죠|군|구나|잖아|[.!?'"”’])$/;
const MIN_KEPT_LENGTH = 4;

export function normalizeExampleForWorksheet(raw: string): string {
  const original = raw.trim().replace(/\s+/g, " ");
  let value = original;
  for (const filler of LEADING_FILLERS) value = value.replace(filler, "").trim();

  // Most specific first: the fused forms have to be unwound before the generic
  // detached cut would reach them.
  let trimmed = value;
  if (FUSED_BOUND_NOUN.test(trimmed)) trimmed = trimmed.replace(FUSED_BOUND_NOUN, "$1야");
  else if (FUSED_DECLARATIVE.test(trimmed)) trimmed = trimmed.replace(FUSED_DECLARATIVE, "다");
  else trimmed = trimmed.replace(DETACHED_QUOTE, "").replace(NOMINALISED_REPORT, "");
  trimmed = trimmed.replace(TRAILING_HEDGE, "").replace(/[\s,·]+$/, "").trim();

  if (trimmed.length >= MIN_KEPT_LENGTH && SENTENCE_END.test(trimmed)) return trimmed;
  return value.length >= MIN_KEPT_LENGTH ? value : original;
}

/** The empty row: a pattern the participant had no example for. Stored rather
 * than skipped so the pointer stays aligned with the registry and the worksheet
 * shows the pattern as looked at. */
export const NO_EXAMPLE_MARKER = "—";

// Ending the discussion on a disagreement is as important as ending it on an
// agreement: "그건 아닌 것 같은데요" is not an acknowledgement, so without this
// the loop would hand the guide another turn on the same pattern and invite
// exactly the arguing the guidance forbids. An evaluation of an LLM cognitive-
// restructuring chatbot found insisting on a reading was what participants
// experienced as being brushed aside.
const DISAGREEMENT_CONTAINS = [
  "아닌 것 같", "아닌것 같", "그건 아니", "그렇지는 않", "잘 모르겠", "모르겠어", "글쎄", "동의가 안", "공감이 안", "다르게 느껴",
  "don't think so", "do not think so", "not really", "i disagree", "doesn't feel", "does not feel", "not sure",
];
function looksLikeDisagreement(text: string) {
  const value = normalize(text);
  return isBareNo(text) || DISAGREEMENT_CONTAINS.some((phrase) => value.includes(phrase));
}

/**
 * Whether the discussion reply carried something NEW, which is the only reason
 * to stay on a pattern for another turn.
 *
 * This is a heuristic and the weakest part of the two-turn design, so it is
 * written to fail towards the recording's dominant shape. In the transcript most
 * patterns got ONE short reaction -- pattern 7 got a single sentence ("네 ...
 * 이렇게 되겠죠, 그죠?" at 483-503) -- and only overgeneralization ran long
 * (578-596). There the counselor kept going because HE chose to probe, not
 * because her answers were long; they were short ("많지는 않은 것 같습니다").
 * Nothing in the turn's input can see that choice: turn-rules gets the
 * participant's text, not the guide's question. So the rule is "did they add
 * content", and when it is wrong it ends the discussion one turn early rather
 * than holding every pattern open for three.
 *
 * A leading agreement is stripped first, because "네, 그런 것 같아요" is agreement
 * with nothing added while "네, 근데 그때는 확인을 안 해봤어요" is not.
 */
const AGREEMENT_PREFIX = /^(?:네|예|응|어|맞아요|맞습니다|그렇죠|그러네요|그렇네요|아\s*네|음+|yes|yeah|right|true|ok|okay)[\s,.!~…]*/;
const VAGUE_AGREEMENT = /^(?:그런\s*것\s*같아요|그런것같아요|그런\s*듯해요|맞는\s*것\s*같아요|그렇네요|그러네요|이해했어요|알겠어요|그럴\s*수도\s*있겠네요|i\s*think\s*so|that\s*makes\s*sense|i\s*see)[\s,.!~…]*$/;
// The threshold is per SCRIPT, not per locale: Hangul syllable blocks carry the
// same content in far fewer characters than Latin words, so one number would
// either let "Yes, straight there." through as new content or throw away
// "많지는 않은 것 같습니다" -- which is a real added answer, and exactly what the
// participant said at 583 of the transcript before the counselor kept going.
const MIN_NEW_CONTENT_HANGUL = 12;
const MIN_NEW_CONTENT_LATIN = 30;
function addsSomethingNew(text: string): boolean {
  const remainder = normalize(text).replace(AGREEMENT_PREFIX, "").trim();
  if (!remainder || VAGUE_AGREEMENT.test(remainder)) return false;
  const threshold = /[\uac00-\ud7a3]/.test(remainder) ? MIN_NEW_CONTENT_HANGUL : MIN_NEW_CONTENT_LATIN;
  return remainder.length >= threshold;
}

/** The ceiling on one pattern's discussion. Three is what the recording's
 * longest exchange came to (578-596, overgeneralization); most patterns took a
 * single short reaction, and one was a sentence ("네 ... 이렇게 되겠죠, 그죠?"
 * at 483-503). */
const MAX_DISCUSS_TURNS = 3;

const BARE_YES_NO_SLUGS = new Set(["today-agenda", "agenda-continue", "understanding-check", "homework-commitment"]);

export async function applyS02TurnRules(input: S02TurnRulesInput): Promise<S02TurnRulesOutput> {
  const { promptItem, rawText, extracted } = input;
  const logs: S02TurnRulesLog[] = [];
  const slug = s02PromptSlug(promptItem.id);
  // A turn carrying any risk signal belongs to the safety path, untouched.
  if (promptItem.sessionId !== "tbct-s02" || !slug || extracted.riskSignals.length > 0) return { extracted, logs };

  const text = rawText ?? "";
  const fields: Record<string, unknown> = { ...extracted.fields };
  let missingFields = [...extracted.missingFields];
  const targetField = promptItem.outputFields[0];

  const accept = (value: unknown) => {
    if (!targetField) return;
    fields[targetField] = value;
    missingFields = missingFields.filter((field) => field !== targetField);
  };
  const log = (summary: string, output: Record<string, unknown>) => logs.push({ summary, output });

  // A bare "네"/"아니요" is the whole answer where the step asks a yes/no.
  if (BARE_YES_NO_SLUGS.has(slug) && isBareYesNo(text)) accept(text);

  if (slug === "homework-update" && looksLikeTypeConfusion(text)) {
    fields.s02TypeConfusion = true;
    log("homework review reported trouble telling the patterns apart", { s02TypeConfusion: true });
  }

  // A no to today's order is heard, and a second no pauses the session --
  // the same two-step S01 uses (note2026_09_19_s01_opening_intro).
  if (slug === "today-agenda" && isBareNo(text)) {
    fields.s02AgendaDeclined = true;
    log("today's order was declined", { s02AgendaDeclined: true });
  }
  if (slug === "agenda-continue" && declinesToGoOn(text)) {
    accept(text);
    fields.s02SessionDeclined = true;
    log("declined to go on; session pauses", { s02SessionDeclined: true });
  }

  if (slug === "review-distortion") {
    // Two turns per pattern, as the recording ran it (note2026_09_21_s02
    // _walkthrough_discussion): "ask" puts the pattern and collects their
    // example, "discuss" talks about what they said. Only the second advances
    // the pointer, so the discussion is a turn of its own.
    //
    // distortionExamples is reliable here because it is not this prompt's
    // output field any more -- the shared extraction never touches it.
    const rows = stringList(extracted.fields.distortionExamples);
    const discussing = extracted.fields.s02PatternPhase === "discuss";

    if (discussing) {
      // Whatever they say back -- agreement, a correction, a different example
      // -- is a whole answer here. Accepting unconditionally is what lets a bare
      // "네" count, which it must: the discussion turn asks them to look at their
      // own example, not to produce a new one.
      accept(text);

      // A replacement example offered in this turn belongs to the SAME pattern:
      // the counselor did exactly this at line 325 of the transcript ("그것보다는
      // ... 좋은 예예요, 그 예를 좀 써봅시다"). The row is rewritten, never moved.
      if (rows.length && !hasNoExampleForPattern(text) && offersReplacementExample(text)) {
        const replaced = [...rows];
        replaced[replaced.length - 1] = normalizeExampleForWorksheet(text);
        fields.distortionExamples = replaced;
        log("a better-fitting example for the same pattern replaced the row", { index: replaced.length });
      }

      // How long the discussion runs is decided here rather than by the guide,
      // because step order belongs to the program in this codebase. The rule
      // follows the recording: at 578-596 the counselor kept going while the
      // participant kept giving content ("많지는 않은 것 같습니다", "말투가
      // 친절하지 않았을 것 같습니다") and stopped when she simply agreed. So the
      // discussion ends on an acknowledgement, and otherwise follows them -- to
      // a hard ceiling, so no single pattern can hold the session open.
      const spent = (typeof extracted.fields.s02PatternDiscussTurns === "number" ? extracted.fields.s02PatternDiscussTurns : 0) + 1;
      const settled = isAcknowledgementOnly(text) || looksLikeDisagreement(text) || !addsSomethingNew(text);
      const keepTalking = spent < MAX_DISCUSS_TURNS && !settled;
      if (keepTalking) {
        fields.s02PatternDiscussTurns = spent;
        log("the participant is still giving content; staying on this pattern", { discussTurns: spent });
      } else {
        fields.s02PatternPhase = "ask";
        fields.s02PatternDiscussTurns = 0;
        log("pattern discussed; moving to the next one", { reviewed: rows.length, discussTurns: spent });
      }
    } else if (hasNoExampleForPattern(text)) {
      // "없어요" is a real answer. The row stays empty and there is nothing to
      // discuss, so this pattern takes one turn rather than two.
      const next = [...rows, NO_EXAMPLE_MARKER];
      accept(text);
      fields.distortionExamples = next;
      fields.s02PatternPhase = "ask";
      fields.s02PatternDiscussTurns = 0;
      log("no example for this pattern; empty row recorded", { distortionExamples: next });
    } else if (looksLikeDistortionUnclear(text) || isAcknowledgementOnly(text)) {
      // Not an example: either they do not see why this one is a distortion yet,
      // or they only acknowledged the explanation. Either way the field stays
      // missing, so the engine asks about this same pattern again -- where the
      // step's guidance tells Claude to ask what feels off. No flag is set: a
      // turn the engine does not accept never commits its fields.
      if (targetField && !missingFields.includes(targetField)) missingFields.push(targetField);
      log("not an example for this pattern; asking again", { reviewed: rows.length });
    } else {
      const next = [...rows, normalizeExampleForWorksheet(text)];
      accept(text);
      fields.distortionExamples = next;
      fields.s02PatternPhase = "discuss";
      fields.s02PatternDiscussTurns = 0;
      log("example recorded; next turn discusses it", { distortionExamples: next });
    }

    // Not complete until the fifteenth pattern has also been discussed --
    // otherwise the loop would exit before its own last discussion turn.
    const stored = stringList(fields.distortionExamples);
    const done = stored.length >= COGNITIVE_DISTORTIONS.length && fields.s02PatternPhase !== "discuss";
    fields.allDistortionsReviewed = done;
    if (done) log("every pattern has a row and has been talked about", { allDistortionsReviewed: true });
  }

  if (slug === "score-distortion") {
    // Reliable because cdQuestScores is not this prompt's output field: the
    // shared extraction never writes it, so what arrives here is the list as
    // the previous turn committed it. See the note in spec.ts.
    const scores = numberList(extracted.fields.cdQuestScores);
    const reading = readCdQuestAnswer(text);
    if (reading.score === null) {
      // Only half an answer (or neither half): the field stays missing so the
      // engine asks about this same pattern again, and the step's guidance tells
      // Claude to ask only for the half that is still missing. Nothing is
      // stored, and no flag is set -- a turn the engine does not accept never
      // commits its fields.
      if (targetField && !missingFields.includes(targetField)) missingFields.push(targetField);
      fields.cdQuestScores = scores;
      log("only part of the frequency/intensity pair arrived; asking again", { cdQuestFrequency: reading.frequency, cdQuestIntensity: reading.intensity });
    } else {
      const nextScores = [...scores, reading.score];
      accept(reading.score);
      fields.cdQuestScores = nextScores;
      // The two halves are the score's basis; they are kept for the worksheet
      // and can be null when the participant stated a score outright.
      fields.cdQuestFrequency = [...numberOrNullList(extracted.fields.cdQuestFrequency), reading.frequency];
      fields.cdQuestIntensity = [...numberOrNullList(extracted.fields.cdQuestIntensity), reading.intensity];
      const done = nextScores.length >= COGNITIVE_DISTORTIONS.length;
      fields.allDistortionsScored = done;
      if (done) {
        // The total is written here rather than by a shared completion effect:
        // it keeps CD-Quest out of applyPromptCompletionEffect entirely.
        fields.cdQuestTotal = nextScores.reduce((sum, value) => sum + value, 0);
        fields.cdQuestHighCount = nextScores.filter((value) => value >= 4).length;
      }
      log("pattern scored", { score: reading.score, frequency: reading.frequency, intensity: reading.intensity, scored: nextScores.length });
    }
  }

  if (slug === "how-do-you-feel" && looksLikeInnateAttribution(text)) {
    fields.s02InnateAttribution = true;
    log("participant read the pattern as something inborn", { s02InnateAttribution: true });
  }

  return { extracted: { ...extracted, fields, missingFields }, logs };
}
