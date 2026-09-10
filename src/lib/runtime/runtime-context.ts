import type { PatientInput, RuntimeContext, StateExtractionResult } from "@/types/runtime-session";
import type { ClinicalStageNode, PromptItem } from "@/lib/protocol/source-fidelity-types";
import { assessRuntimePatientInput, deriveS02CollectionTurnAction, deriveS02RatingTurnAction, isS02CollectionField, isS02RatingCorrectionField, requiresSemanticInputAssessment } from "@/lib/runtime/runtime-input-assessment";
import { matchEnumChoice, parseDeterministicPromptInput, parsePrivatePlaceholderLabelsInput } from "@/lib/runtime/runtime-deterministic-input";

export function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// P0-2: bare "없어요"/"없습니다" used to be matched with .includes(), so ANY
// sentence containing that ending -- "의욕이 없어요", "친구가 없어요", "돈이
// 없어요", "자신감이 없어요", "에너지가 없어요" -- was wrongly read as "no more
// items to list" and silently ended the collection loop instead of being
// recorded as the actual clinical content the participant just gave. These
// short/ambiguous termination phrases are only a genuine "no more" answer
// when they are the WHOLE answer (exact match, edge punctuation aside); the
// longer, unambiguous phrases below (a full sentence in each language) are
// safe to keep matching anywhere in the message.
const NO_MORE_EXACT_PHRASES = new Set([
  "없어요",
  "없습니다",
  "더 없어요",
  "더는 없어요",
  "추가로는 없어요",
  "더 생각나는 건 없어요",
  "더 생각나는 건 없습니다",
  // Confirmed live (S07's advantages/disadvantages collection): the informal
  // register of the exact same "no more" answer -- "없어요" without the
  // polite 요, or restating/hedging it -- was accepted as a genuine new list
  // item instead of ending the loop, so the participant repeated themselves
  // four times ("없는듯", "없다고", "장점이 더이상 없어", "장점이 없어")
  // before the collection finally stopped on an unrelated max-items message.
  // Still exact-match only, per this set's own rule above -- "없어"/"없다"
  // bare are common enough as genuine content (see the P0-2 comment) that
  // only the standalone form is safe to add here.
  "없어",
  "없음",
  "없다",
  "없대",
  "없는듯",
  "없는 듯",
  "없다고",
  // Global dialogue rules, explicit stop-signal list (2026-08-18): a bare
  // "I don't know"/"can't think of any"/"that's fine"/"let's move on" reply
  // to a list-collection prompt is a deliberate stop, not a request for more
  // time -- same exact-match-only scoping as the rest of this set, since
  // e.g. "모르겠어요" alone is never coherent as an actual disadvantage/
  // advantage/evidence item, but longer sentences using these words to
  // describe real content must still fall through untouched.
  "모르겠다",
  "모르겠어요",
  "생각나지 않아요",
  "생각나지 않는다",
  "괜찮습니다",
  "괜찮아요",
  "됐습니다",
  "됐어요",
  "넘어가겠습니다",
  "넘어갈게요",
  "none",
  "no more",
  "more none",
  "nothing else",
]);
const NO_MORE_CONTAINS_PHRASES = [
  "i cannot think of another one",
  "nao consigo pensar em mais nenhum",
  "não consigo pensar em mais nenhum",
  // A prosecutor/defense who cannot answer a specific point is ending that
  // loop the same way "no more evidence" ends collection -- the unanswered
  // item is then captured by S08's unrebutted-defense-note reflection.
  "cannot rebut",
  "can't rebut",
  "반박할 수 없어요",
  "반박 못 하겠어요",
  "반박 못하겠어요",
  // "더 이상"/"더이상" ("any more/further") makes a trailing 없다-family verb
  // an unambiguous "no more items" signal regardless of what topic noun
  // precedes it ("장점이 더이상 없어", "생각나는 게 더 이상 없어") -- unlike bare
  // "없다"/"없어" (see NO_MORE_EXACT_PHRASES' comment), nobody uses "더 이상"
  // to describe new content, only to say a list is exhausted, so this is
  // safe to match anywhere in the message rather than requiring an exact
  // whole-message match.
  "더 이상 없",
  "더이상 없",
];

function isNoMoreEvidence(text: string) {
  const normalized = normalizeText(text).replace(/^[.,!?~…'"`]+|[.,!?~…'"`]+$/g, "").trim();
  if (NO_MORE_EXACT_PHRASES.has(normalized)) return true;
  return NO_MORE_CONTAINS_PHRASES.some((phrase) => normalized.includes(phrase));
}

/**
 * Fields whose prompt is reused turn after turn to rate one list item at a
 * time (one problem, one goal, ...). The catalog's `validation.kind` for
 * these is "rating", which by default overwrites the field on every turn;
 * without this list they would silently discard every rating but the last,
 * so totals such as `problemRatings` summed later are wrong.
 */
const CUMULATIVE_RATING_FIELDS: Record<string, string> = {
  problemRatings: "currentProblemScore",
  goalRatings: "currentGoalScore",
  symptomItemScores: "currentSymptomScore",
};

// P1-1: S02's CCPH/CCGH 0-5 scale is 1:1 color-coded (validation.includeColor,
// currently S02-only -- see the includeColor gate in extractRuntimeState).
// Same color vocabulary as static-messages/s02.ts's SCALE_COLORS_KO.
const COLOR_RATING_PATTERNS: Array<{ pattern: RegExp; value: number }> = [
  { pattern: /연한\s*파란색|하늘색/, value: 0 },
  { pattern: /진한\s*파란색|남색/, value: 1 },
  { pattern: /연한\s*초록색/, value: 2 },
  { pattern: /진한\s*초록색/, value: 3 },
  { pattern: /노란색/, value: 4 },
  { pattern: /빨간색/, value: 5 },
];

/** Resolves a color word ("노란색", "빨간색 같아요", "진한 초록색 정도요") to its
 * 0-5 score. Bare "파란색"/"초록색" with no 연한/진한 modifier is deliberately
 * left unresolved (returns null) -- it's genuinely ambiguous between the two
 * scores that share that base color. */
function matchColorRatingWord(text: string): number | null {
  const match = COLOR_RATING_PATTERNS.find(({ pattern }) => pattern.test(text));
  return match?.value ?? null;
}

/** "2랑 3 사이 같아요", "2인지 3인지 모르겠어요" -- the participant is between two
 * adjacent scores, not confidently answering with the first number that
 * happens to appear. Must not be silently recorded as the first number. */
function isUncertainBetweenTwoRatings(text: string): boolean {
  const normalized = normalizeText(text);
  return /\d\s*(?:랑|와|과)?\s*\d?\s*사이/.test(normalized) || /\d\s*인지\s*\d\s*인지\s*모르겠/.test(normalized);
}

/** The two candidate scores named in an uncertain-between-two-ratings answer
 * ("2랑 3 사이 같아요" -> [2, 3]), so the clarification prompt can name them
 * back to the participant instead of asking a content-free "which one?".
 * Returns null when fewer than two numbers are present. */
function extractUncertainRatingCandidates(text: string): [number, number] | null {
  const numbers = [...text.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((value) => Number.isFinite(value));
  return numbers.length >= 2 ? [numbers[0], numbers[1]] : null;
}

// Real-runtime reproduction: "지금 평가 척도 카드를 가지고 계신가요?" is a real
// yes/no question, validation.kind: "boolean" already correctly makes it
// wait for an answer -- but the shared BOOLEAN_ANSWER_TEXT/parseBooleanInput
// (runtime-deterministic-input.ts) only accept an EXACT match against the
// whole message ("네", "아니요", ...), and don't recognize the "have/don't
// have" phrasing this specific question naturally draws ("있어요"/"없어요"),
// so a real answer like "아니요 설명해주세요" or "없는데 설명해주세요" fails the
// exact-match check and falls through to the generic "give a short concrete
// example" clarification -- eventually pausing the session. Per the task
// brief, the shared boolean parser must not be loosened globally (that would
// affect every other boolean-kind prompt in every session); scoped instead
// to exactly these two fields, both card-availability yes/no questions.
const CARD_AVAILABILITY_FIELDS = new Set(["problemScaleCardAvailable", "goalScaleCardAvailable"]);

/** "네"/"예"/"응", or a "have it" phrasing ("있어요", "가지고 있어요") -> true.
 * "아니(요)" (as a prefix) or any "don't have it" phrasing containing "없"
 * ("없어요", "카드 없어요", "없는데 설명해주세요") -> false, even with trailing
 * content like "설명해주세요" that a plain exact-match boolean parser can't
 * see past. Negation is checked first so "없" always wins over an unrelated
 * "있" elsewhere in the same sentence. */
function parseCardAvailabilityAnswer(rawText: string): boolean | null {
  const normalized = normalizeText(rawText);
  if (/^아니|없/.test(normalized)) return false;
  if (/^네|^예|^응|있/.test(normalized)) return true;
  return null;
}

// Session 2 manual-control recovery: a small, SESSION-SCOPED classifier for
// exactly S02's problems/goals list-building fields -- not a global
// NON_ANSWER_TEXT expansion, and not reused by any other session's list
// fields. Several elicit-problems/elicit-goals follow-up prompts share the
// same "problems"/"goals" array with no validation.kind of their own, so
// ANY non-filler text was appended verbatim as a new list entry -- including
// a meta remark about the question itself ("앞에서 말했잖아요", "무슨질문이요?")
// or a "nothing more" closer phrased in a way isNoMoreEvidence's exact-match
// set doesn't cover ("이미 이루어서 없어요", "딱히 없어요").
const S02_LIST_FIELDS = new Set(["problems", "goals"]);

const S02_META_OR_CLARIFICATION_PATTERNS: RegExp[] = [
  /(?:앞에서|아까|전에)\s*(?:말했|얘기했|이야기했)/, // "앞에서 말했잖아요" / "아까 말했어요"
  /무슨\s*질문/, // "무슨질문이요?" / "무슨 질문이요?"
  /무슨\s*(?:말|뜻|의미)/, // "무슨 말이에요?"
  /왜\s*(?:또\s*)?물어/, // "왜 또 물어봐요?" / "왜 물어봐요?"
  /질문(?:을|이)\s*이해(?:하지\s*못했|가\s*안\s*(?:돼요|됩니다|가요))/, // "질문을 이해하지 못했어요" / "질문이 이해가 안 돼요"
  // English quality parity: mirrors the five Korean patterns above
  // one-for-one -- this was 100% Korean-only before, so an English-speaking
  // participant saying any of these had it stored as a literal
  // problem/goal/answer instead of triggering a clarification.
  /\bi\s+(?:already\s+)?(?:said|mentioned|told\s+you)\s+(?:that|this)\s+(?:already|before)\b/i, // "I already said that" / "I told you that before"
  /\bwhat\s+question\b/i, // "what question?"
  /\bwhat\s+do\s+you\s+mean\b/i, // "what do you mean?"
  /\bwhy\s+(?:are\s+you\s+)?ask(?:ing)?\s+(?:that\s+)?again\b/i, // "why are you asking that again?"
  /\bi\s+don'?t\s+understand\s+the\s+question\b/i, // "I don't understand the question"
];

function looksLikeS02MetaOrClarification(text: string): boolean {
  const normalized = normalizeText(text);
  return S02_META_OR_CLARIFICATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

// P1: exported so runtime-execution-api.ts's deliverClarificationTurn can
// recognize when the participant is asking for the CURRENT question to be
// explained (rating-card-check/goal-rating-card-check, S02 problem/goal
// collection), instead of falling through to the generic "give a short
// concrete example" clarification. Broader than
// looksLikeS02MetaOrClarification (adds "설명해주세요"/"잘 모르겠는데", relevant
// to a boolean question like "do you have the card?" where those phrasings
// alone -- with no list-append risk -- weren't previously covered).
export function looksLikeS02ExplanationRequest(text: string): boolean {
  if (looksLikeS02MetaOrClarification(text)) return true;
  const normalized = normalizeText(text);
  return /설명해\s*주(?:세요|시겠어요|실래요)/.test(normalized) // "설명해주세요" / "설명해 주시겠어요"
    || /잘\s*모르겠는데/.test(normalized) // "잘 모르겠는데"
    || /이해가\s*안/.test(normalized) // "이해가 안 돼요/가요" (standalone, without a "질문이" prefix)
    // English quality parity: mirrors the three Korean patterns above.
    || /\bplease\s+explain\b/i.test(normalized) // "please explain"
    || /\bcan\s+you\s+explain\b/i.test(normalized) // "can you explain?"
    || /^(?:i'?m\s+)?not\s+sure\b/i.test(normalized) // "not sure" / "I'm not sure" (leading the message)
    || /\bi\s+don'?t\s+(?:get|understand)\s+it\b/i.test(normalized); // "I don't get it" / "I don't understand it"
}

// Idiom-based "nothing more" phrasing beyond isNoMoreEvidence's exact-match
// set. Deliberately narrow (not "anything ending in 없어요") -- "돈이
// 없어요"/"친구가 없어요" are real clinical content (P0-2, earlier pass), not
// list closers, and must keep being stored as items.
const S02_NO_MORE_IDIOM_PATTERNS: RegExp[] = [
  /이미\s*이루(?:어서|웠어서|웠기\s*때문에)\s*없/, // "이미 이루어서 없어요"
  /딱히\s*없/, // "딱히 없어요"
];

function looksLikeS02NoMoreIdiom(text: string): boolean {
  const normalized = normalizeText(text);
  return S02_NO_MORE_IDIOM_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Classifies a free-text answer to an S02 problems/goals elicitation prompt
 * into: a real candidate item, a meta remark about the question itself
 * (never stored, keeps the clarification path open), or an explicit
 * "nothing more" closer (never stored, sets the NoMore flag instead).
 * Session-2-scoped only. */
function classifyS02ListResponse(rawText: string): "item" | "meta_or_clarification" | "no_more" {
  if (looksLikeS02MetaOrClarification(rawText)) return "meta_or_clarification";
  if (isNoMoreEvidence(rawText) || looksLikeS02NoMoreIdiom(rawText)) return "no_more";
  return "item";
}

// P0-3's classifyS02RatingCorrection (session-scoped reject/duplicate regex)
// lived here. Phase 3 (runtime orchestration simplification) replaced it
// with assessRuntimePatientInput's turnAction==="current_item_correction" --
// see the semantic gate below. Deleted only after confirming (grep, full
// E2E suite including the exact literal phrases this classifier used to
// match) that it had zero remaining callers.

/** Validation kinds whose two output fields must sum to (approximately) 100. */
const SUM_TO_100_PAIR_KINDS = new Set(["consensus_weights"]);

/** validation.kind values that represent a growing, deduplicated list the
 * patient builds one entry at a time (problems, goals, contributors,
 * symptom items, evidence, disadvantages/advantages, appeal evidence, ...). */
const LIST_BUILDING_VALIDATION_KINDS = new Set(["array", "min_items"]);

/** A readiness/acknowledgement reply is not a clinical list item. This is
 * especially important when generated wording accidentally adds "ready?"
 * after an otherwise valid problems/goals prompt: accepting "yes" here
 * shifts the whole list and makes later replies appear misunderstood. */
function isListAcknowledgementOnly(text: string) {
  const normalized = normalizeText(text).replace(/[.!?。！？，,]/g, "").trim();
  return /^(?:yes|yes i am|yes i'm ready|ok|okay|got it|understood|i understand|ready|네|예|응|네 알겠습니다|알겠습니다|이해했습니다|준비됐어요|준비되었습니다)$/.test(normalized);
}

// Scoped narrowly to participant_summary_required (S06's "explain the
// difference back in your own words" capsule-summary steps): unlike a
// generic question, this validation kind stores WHATEVER text the
// participant sends as the clinical record of their understanding, so a
// literal "what do you mean by that?" would otherwise ship as if it were
// their explanation. Deliberately not applied to any other validation kind
// -- S01's meta-question handling for openingInitialThought / S02's boolean
// rating-card confirmations are already covered by their own scoped
// mechanisms (META_QUESTION_AWARE_FIELDS below) and must keep their
// existing, separately-tested behavior for a phrase like "설명해주세요".
function isExplanationRequest(text: string) {
  const normalized = normalizeText(text);
  return /(?:무슨\s*말|무슨\s*뜻|설명해|설명\s*해|이해가?\s*안|잘\s*모르겠|어떻게\s*하라는|what do you mean|what does (?:that|this) mean|can you explain|please explain|i don'?t understand)/i.test(normalized);
}

function isDuplicateListEntry(existing: unknown, candidate: string) {
  if (!Array.isArray(existing)) return false;
  const normalizedCandidate = normalizeText(candidate);
  return existing.some((item) => typeof item === "string" && normalizeText(item) === normalizedCandidate);
}

/**
 * Pairs a growing list (problems, goals, symptom items) with the rating
 * field that scores it one item at a time. The catalog only declares a
 * single generic rating prompt per list — nothing else tracks which item is
 * "next" or whether every item has been rated — so this table drives three
 * derived fields: `<pointerField>` (the current item's own text, for
 * substituting into the "[problem]"-style bracket in the source script) and
 * `all<X>Rated` (a completion-gate flag a repeat_until prompt can check).
 */
const LIST_RATING_PAIRS: Array<{ listField: string; ratingsField: string; pointerField: string; sufficiencyField: string }> = [
  { listField: "problems", ratingsField: "problemRatings", pointerField: "currentProblemText", sufficiencyField: "allProblemsRated" },
  { listField: "goals", ratingsField: "goalRatings", pointerField: "currentGoalText", sufficiencyField: "allGoalsRated" },
  { listField: "symptomItems", ratingsField: "symptomItemScores", pointerField: "currentSymptomItemText", sufficiencyField: "allSymptomItemsRated" },
];

/** After either the source list or the ratings array changes, point
 * `pointerField` at the next unrated item and flag whether every item in
 * the list now has a rating. */
function refreshListRatingPointers(nextFields: Record<string, unknown>) {
  for (const pair of LIST_RATING_PAIRS) {
    const list = Array.isArray(nextFields[pair.listField]) ? (nextFields[pair.listField] as string[]) : undefined;
    if (!list) continue;
    const ratings = Array.isArray(nextFields[pair.ratingsField]) ? (nextFields[pair.ratingsField] as unknown[]) : [];
    nextFields[pair.pointerField] = list[ratings.length];
    nextFields[pair.sufficiencyField] = list.length > 0 && ratings.length >= list.length;
  }
}

/**
 * Phase 3 (runtime orchestration simplification): a text answer to a
 * problem/goal rating prompt is a "pure" closed-form rating only when it is
 * JUST the number/color and nothing else -- "5", "5.", "5점", "노란색", "진한
 * 초록색". Anything else ("3이요", "4점 정도인 것 같아요", "5. 근데 이건...") must go
 * through semantic interpretation first, because a stray leading digit next
 * to a correction ("5. 근데 이건 앞에 있던 거랑 같은 항목이에요") must never be
 * captured as that digit's rating. Deliberately strict/narrow: any input
 * this rejects safely falls through to the semantic gate below rather than
 * being silently mis-scored, so under-matching here is the safe direction.
 */
function isPureClosedFormRatingAnswer(rawText: string, isColorCodedRating: boolean): boolean {
  const trimmed = rawText.trim();
  if (/^-?\d+(?:\.\d+)?점?\.?$/.test(trimmed)) return true;
  if (isColorCodedRating && /^(?:연한|진한)?\s*(?:파란|초록|노란|빨간)색\.?$/.test(trimmed)) return true;
  return false;
}

/**
 * Single owner for "the participant says the item currently being rated
 * isn't valid" (Phase 3). Reuses LIST_RATING_PAIRS/refreshListRatingPointers
 * exactly as the collection-side accept_answer path above does -- removes
 * the one item at the current rating pointer, leaves the ratings array
 * completely untouched (no rating recorded for the removed item, and
 * nothing already recorded is disturbed), and recomputes every derived
 * field (pointer, allRated, and -- new this phase -- the Count fields the
 * shared extraction tail would otherwise be the only place computing).
 * Returns null (never guesses) if the current list/ratings state doesn't
 * satisfy the invariant a correction depends on (ratings.length <=
 * list.length, i.e. there IS an unrated current item to remove) -- the
 * caller treats null as "fail closed", not "remove something anyway".
 */
function applyCurrentRatingItemCorrection(input: {
  listField: string;
  ratingsField: string;
  fields: Record<string, unknown>;
}): Record<string, unknown> | null {
  const list = Array.isArray(input.fields[input.listField]) ? (input.fields[input.listField] as string[]) : [];
  const ratings = Array.isArray(input.fields[input.ratingsField]) ? (input.fields[input.ratingsField] as number[]) : [];
  const removeIndex = ratings.length;
  if (removeIndex >= list.length) return null;
  const correctionPrefix = input.ratingsField === "problemRatings" ? "problem" : "goal";
  const correctedFields: Record<string, unknown> = {
    ...input.fields,
    [input.listField]: list.filter((_, index) => index !== removeIndex),
    [`${correctionPrefix}RatingCorrectionApplied`]: true,
  };
  refreshListRatingPointers(correctedFields);
  for (const [key, value] of Object.entries(correctedFields)) {
    if (Array.isArray(value)) correctedFields[`${key}Count`] = value.length;
  }
  return correctedFields;
}

/** Per-field completion rule for a growing list a repeat_until prompt keeps
 * collecting. The list is "sufficient" (its `<field>Sufficient` flag goes
 * true, releasing the loop's completionCondition) when it reaches `target`
 * entries, or when the patient says there is nothing more AND at least
 * `minBeforeNoMore` entries exist.
 *
 * The old rule was a flat "count >= 2 || noMore", which ended every
 * collection the instant the 2nd item landed -- the source explicitly allows
 * 3 (exceptionally 4) pieces of trial evidence and treats S07 Step 3's
 * "several exchanges" as a floor, so stopping at 2 cut both short. `target`
 * is the source's own upper bound (the loop stops INVITING there; it never
 * demands that many), and `minBeforeNoMore` is the floor below which a
 * premature "nothing more" earns one more gentle invitation instead of
 * closing the step. */
const LIST_SUFFICIENCY_RULES: Record<string, { sufficiencyField: string; target: number; minBeforeNoMore: number }> = {
  prosecutionEvidence: { sufficiencyField: "prosecutionEvidenceSufficient", target: 4, minBeforeNoMore: 2 },
  defenseEvidence: { sufficiencyField: "defenseEvidenceSufficient", target: 4, minBeforeNoMore: 2 },
  appealEvidence: { sufficiencyField: "appealEvidenceSufficient", target: 3, minBeforeNoMore: 2 },
  emotionReasonDialogue: { sufficiencyField: "emotionReasonDialogueSufficient", target: 6, minBeforeNoMore: 3 },
  disadvantages: { sufficiencyField: "disadvantagesSufficient", target: 7, minBeforeNoMore: 1 },
  advantages: { sufficiencyField: "advantagesSufficient", target: 7, minBeforeNoMore: 1 },
  consensusLearning: { sufficiencyField: "consensusLearningSufficient", target: 2, minBeforeNoMore: 1 },
};

/** Detects a language from the patient's own first substantive message
 * instead of asking a meta-question ("Which language would you like?"),
 * per the source protocol's "language lock from first substantive message"
 * instruction. This is a script/character-set detection, not an inference
 * about the patient's meaning, so it is safe to compute deterministically. */
function detectScriptLocale(text: string) {
  if (/[가-힣]/.test(text)) return "ko-KR";
  if (/[぀-ヿ一-鿿]/.test(text)) return "ja-JP";
  if (/[àâçéèêëîïôûùüÿñæœ]/i.test(text)) return "fr-FR";
  if (/[ãáàâêéíóôõúüç]/i.test(text)) return "pt-BR";
  return "en-US";
}

// Legacy, session-agnostic blacklist -- unchanged from before the 2026-08-17
// S01 Opening work. "I don't know" / "\uC798 \uBAA8\uB974\uACA0\uC5B4\uC694" stay
// here deliberately: session-fidelity-fixtures.ts's insufficientPatientInputs
// fixture already documents these as the codebase's intended "insufficient
// answer" examples, and every session except S01's new openingInitialThought
// field (see FIELDS_ACCEPTING_UNCERTAINTY below) still relies on that.
const NON_ANSWER_TEXT = new Set([
  "hi", "hello", "hey", "yo", "test", "testing", "ok", "okay", "sure", "yes", "no", "true", "false", "idk", "i don't know", "i dont know", "i do not know",
  "\uC548\uB155", "\uC548\uB155\uD558\uC138\uC694", "\uD558\uC774", "\uD14C\uC2A4\uD2B8", "\uD14C\uC2A4\uD2B8\uC785\uB2C8\uB2E4", "\uB124", "\uC608", "\uC751", "\uADF8\uB798", "\uC88B\uC544\uC694", "\uBAB0\uB77C", "\uBAA8\uB974\uACA0\uC5B4\uC694", "\uC798 \uBAA8\uB974\uACA0\uC5B4\uC694", "\uC74C",
  "oi", "ol\u00E1", "ola", "teste", "sim", "n\u00E3o", "nao", "n\u00E3o sei", "nao sei",
]);

// Session/field-scoped exception, NOT a global constant change: S01's
// Opening redesign (Initial Thought Probe, tbct-s01-n02-p02-initial-thought-probe)
// and its Cognitive Distortions redesign (identify-distortion,
// tbct-s01-n10-p02-identify-distortion -- "is any of these similar?" is
// genuinely, often correctly answered with uncertainty or "none of these")
// deliberately have no validation.kind, so a literal "I don't know" must be
// stored as a genuine, expected answer instead of looping toward
// MAX_CLARIFICATION_ATTEMPTS -- but every other prompt in every session
// (S02-S08 included) keeps the exact legacy behavior above. See
// .claude/TASK_SCOPE.json's note2026_08_17c/d entries for the audit that
// scoped this down from an earlier, unscoped NON_ANSWER_TEXT edit.
const FIELDS_ACCEPTING_UNCERTAINTY = new Set(["openingInitialThought", "participantSelectedDistortions"]);
const UNCERTAINTY_TEXT = new Set([
  "idk", "i don't know", "i dont know", "i do not know",
  "\uBAB0\uB77C", "\uBAA8\uB974\uACA0\uC5B4\uC694", "\uC798 \uBAA8\uB974\uACA0\uC5B4\uC694", "\uC5C6\uB294 \uAC83 \uAC19\uC544\uC694", "\uD574\uB2F9 \uC5C6\uC74C", "\uC5C6\uC5B4\uC694",
  "n\u00E3o sei", "nao sei",
]);

// Same scoping rationale as FIELDS_ACCEPTING_UNCERTAINTY above: without a
// validation.kind, these fields never reach the semantic-assessment path, so
// a literal meta-question ("why are you asking this?", "what does that
// mean?") would otherwise be stored verbatim as if it were the participant's
// actual answer, instead of triggering the dialogue agent's own
// explain_rationale/explain_term handling (already generic, see
// anthropic-dialogue-agent.ts's systemPrompt). Every other prompt in every
// session keeps its exact legacy behavior (unconditional acceptance of any
// non-filler text).
const META_QUESTION_AWARE_FIELDS = new Set(["openingInitialThought", "participantSelectedDistortions"]);
// Exported (P0-5) so runtime-execution-api.ts can reuse the exact same
// "why are you asking this?" / "what does that mean?" detection for a
// session-scoped (S01-S03) interception point that runs BEFORE clinical-field
// storage, instead of only the two S01 fields this module's own
// META_QUESTION_AWARE_FIELDS gate covers. See deliverProcessClarificationTurn.
export function looksLikeMetaQuestionAboutTheProcess(normalized: string) {
  return /^why (?:are you|do you|does it) ask(?:ing)?\b.*\??$/i.test(normalized)
    || /^why does (?:this|that|it) matter\??$/i.test(normalized)
    || /^what (?:does (?:that|this) mean|am i supposed to (?:answer|say)|should i (?:answer|say))\??$/i.test(normalized)
    || /^(?:can|could) you give (?:me )?an example\??$/i.test(normalized)
    || /^\uC65C\s*(?:\uC774\uAC78|\uADF8\uAC78|\uADF8\uB7F0\s*\uAC78|\uADF8\uAC83\uC744|\uC774\uAC83\uC744)?\s*\uBB3C\uC5B4(?:\uBCF4|\uBD10)/.test(normalized)
    || /^(?:\uADF8\uAC8C\s*)?\uBB34\uC2A8\s*(?:\uB9D0|\uB73B|\uC758\uBBF8)(?:\uC774\uC5D0\uC694|\uC608\uC694|\uC778\uAC00\uC694|\uC774\uC57C)?\??$/.test(normalized)
    || /^\uC65C\s*\uADF8\uB7F0\s*(?:\uAC74\uAC00\uC694|\uAC70\uC608\uC694|\uAC70\uC57C)\??$/.test(normalized)
    || /^\uC608(?:\uB97C|\uC2DC)?\s*\uB4E4\uC5B4\s*(?:\uC8FC\uC138\uC694|\uC918\uC694|\uC904\uB798\uC694)/.test(normalized)
    || /(?:\uBB34\uC2A8\s*\uB2F5\uC744\s*\uD574\uC57C|\uC5B4\uB5BB\uAC8C\s*\uB2F5\uD574\uC57C|\uBB50\uB77C\uACE0\s*\uB2F5\uD574\uC57C)/.test(normalized);
}

// P0-5: the participant asking what the CURRENT question means/is asking for
// -- distinct from looksLikeMetaQuestionAboutTheProcess above (which covers
// "why are you asking this at all"). Both are process-clarification
// requests, never the participant's actual clinical answer; see
// deliverProcessClarificationTurn in runtime-execution-api.ts, which routes
// these away from clinical-field storage entirely instead of letting a
// literal "\uBB58\uC694?" get saved as if it were e.g. the participant's problem/
// situation/thought.
export function looksLikeMeaningClarificationRequest(normalized: string) {
  return /^\uB124\?+$/.test(normalized) // "\uB124?" -- the "?" is mandatory: bare "\uB124" is an ordinary affirmative/filler, not a confusion signal
    || /^\uBB58\uC694\??$/.test(normalized) // "\uBB58\uC694?"
    || /^(?:\uBB50\uB97C?|\uBB58)\s*\uB9D0\uD558\uBA74\s*\uB418\uB098\uC694\??$/.test(normalized) // "\uBB50(\uB97C)/\uBB58 \uB9D0\uD558\uBA74 \uB418\uB098\uC694?"
    || /^\uC9C8\uBB38\uC774\s*\uC774\uD574\uAC00\s*\uC548\s*(?:\uB3FC\uC694|\uB429\uB2C8\uB2E4|\uAC00\uC694)\??$/.test(normalized) // "\uC9C8\uBB38\uC774 \uC774\uD574\uAC00 \uC548 \uB3FC\uC694/\uB429\uB2C8\uB2E4"
    || /^\uB2E4\uC2DC\s*\uC124\uBA85\uD574\s*\uC8FC(?:\uC138\uC694|\uC2DC\uACA0\uC5B4\uC694|\uC2E4\uB798\uC694)\??$/.test(normalized) // "\uB2E4\uC2DC \uC124\uBA85\uD574 \uC8FC\uC138\uC694"
    || /^\uC27D\uAC8C\s*\uB9D0\uD574\s*\uC8FC(?:\uC138\uC694|\uC2DC\uACA0\uC5B4\uC694|\uC2E4\uB798\uC694)\??$/.test(normalized) // "\uC27D\uAC8C \uB9D0\uD574 \uC8FC\uC138\uC694"
    // English quality parity: this function was 100% Korean-only before --
    // an English-speaking participant saying any of these got no
    // clarification at all and risked having the literal confusion phrase
    // stored as if it were their actual clinical answer. Mirrors the six
    // Korean patterns above one-for-one, same strict whole-message anchoring.
    || /^(?:huh|what|sorry,?\s*what)\??$/i.test(normalized) // "huh?" / "what?"
    || /^what\s+should\s+i\s+say\??$/i.test(normalized) // "what should I say?"
    || /^i\s+don'?t\s+understand\s+the\s+question\.?$/i.test(normalized) // "I don't understand the question"
    || /^(?:please\s+)?explain\s+(?:that|this)?\s*again\.?$/i.test(normalized) // "explain that again" / "please explain again"
    || /^(?:can|could)\s+you\s+(?:say|explain)\s+(?:that|this)?\s*(?:more\s+)?simply\??$/i.test(normalized); // "can you say that more simply?"
}

/** The complete set of answers a yes/no prompt accepts -- also the set the
 * Yes/No buttons submit once typed rather than clicked. */
const BOOLEAN_ANSWER_TEXT = new Set(["yes", "no", "true", "false", "네", "예", "응", "아니", "아니요", "sim", "não", "nao"]);

/** Short answers that are filler for an ordinary clinical question but are the
 * literal, complete answer to a consent question. */
const CONSENT_ANSWER_TEXT = new Set([
  "yes", "no", "ok", "okay", "sure", "yes please", "i'd like to", "id like to", "i would like to", "not now", "no thanks", "no thank you",
  "네", "예", "응", "그래", "좋아요", "좋습니다", "해볼게요", "해보겠어요", "아니", "아니요", "아니요 괜찮아요", "지금은 아니요",
  "sim", "não", "nao", "claro", "oui", "non", "はい", "いいえ",
]);

const RISK_SIGNAL_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: "danger", pattern: /\b(?:i am|i'm|we are|we're)\s+(?:in\s+)?immediate danger\b/i },
  { signal: "harm", pattern: /\b(?:self[ -]?harm|hurt myself|harm myself)\b/i },
  { signal: "suicide", pattern: /\b(?:suicide|suicidal|suiside|suicde|ending my life|(?:want|going) to die|wanna die|don'?t want to (?:live|be alive)|kill myself|end my life)\b/i },
  { signal: "unsafe", pattern: /\b(?:i am|i'm|feel|feeling)\s+unsafe\b/i },
  { signal: "suicidal_ideation_ko", pattern: /(?:\uC8FD\uACE0\s*\uC2F6|\uC0B4\uACE0\s*\uC2F6\uC9C0\s*\uC54A|\uC790\uC0B4)/ },
  { signal: "self_harm_ko", pattern: /(?:\uC790\uD574|\uB0B4\s*\uBAB8\uC744\s*\uD574\uCE58)/ },
  { signal: "suicidal_ideation_pt", pattern: /(?:quero\s+morrer|n[aã]o\s+quero\s+mais\s+viver|suic[ií]d)/i },
  { signal: "self_harm_pt", pattern: /(?:me\s+machucar|me\s+ferir|autoagress)/i },
  { signal: "suicidal_ideation_fr", pattern: /(?:je\s+veux\s+mourir|je\s+ne\s+veux\s+plus\s+vivre|suicid)/i },
  { signal: "self_harm_fr", pattern: /(?:me\s+faire\s+du\s+mal|automutil)/i },
  { signal: "suicidal_ideation_ja", pattern: /(?:\u6B7B\u306B\u305F\u3044|\u3082\u3046\s*\u751F\u304D\u305F\u304F\u306A\u3044|\u81EA\u6BBA)/ },
  { signal: "self_harm_ja", pattern: /(?:\u81EA\u50B7|\u81EA\u5206\u3092\s*\u50B7\u3064\u3051)/ },
  { signal: "suicidal_ideation_ko", pattern: /(?:죽고\s*싶|죽고싶|자살(?:하고)?\s*싶|자살하고싶|목숨을\s*끊)/ },
  { signal: "self_harm_ko", pattern: /(?:자해(?:하고)?\s*싶|나를\s*해치|내\s*몸을\s*해치)/ },
];

// P0-6: a lexical risk-signal hit alone doesn't distinguish "I want to die
// right now" from "I don't want to die, I'm just exhausted" / "I used to
// want to die, not anymore" / "my friend told me they want to die" -- all
// three contain the exact same trigger words as a genuine current
// disclosure. Genuine safety detection (RISK_SIGNAL_PATTERNS above) is never
// weakened or removed; these patterns only recognize EXPLICIT negation,
// past-only framing, or third-party attribution wrapped around a risk
// signal, and route that narrow case to the existing ambiguous_safety_language
// + safety_clarification flow instead of the immediate high-risk route --
// which still asks a direct safety-confirming question and still escalates
// to the full high-risk path the instant the participant confirms current
// risk (see the lastClarificationReason === "safety_clarification" branch
// below). An unqualified first-person disclosure ("지금 죽고 싶어요", "지금
// 자해하고 싶어요", "목숨을 끊고 싶어요") never matches any of these and is
// completely unaffected.
const RISK_NEGATION_PATTERNS: RegExp[] = [
  // "죽고 싶은 건 아니에요", "자살하고 싶은 게 아니었어요"
  /(?:죽고\s*싶|자살(?:하고)?\s*싶|자해(?:하고)?\s*싶).{0,8}(?:것은|건|게|는|은)?\s*아니(?:에요|야|었|었어요|다)/,
  // "예전에는 죽고 싶었지만 지금은 아니에요"
  /(?:예전에는|전에는|과거에).{0,40}지금은\s*(?:아니|안|없)/,
];
const RISK_THIRD_PARTY_PATTERNS: RegExp[] = [
  // "친구가 죽고 싶다고 해서 걱정돼요"
  /(?:친구|동생|형|누나|언니|오빠|엄마|아빠|부모님|가족|동료|남편|아내|딸|아들|그\s*사람|그가|그녀가|누군가)(?:가|이|는|은)\s*(?:죽고\s*싶|자살(?:하고)?\s*싶|자해(?:하고)?\s*싶).{0,10}(?:다고|대요|래요|라고|하더라고요|한다고)/,
];

export function isNonCurrentRiskMention(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return RISK_NEGATION_PATTERNS.some((pattern) => pattern.test(trimmed)) || RISK_THIRD_PARTY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function detectRuntimeRiskSignals(text: string) {
  return RISK_SIGNAL_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ signal }) => signal);
}

// Explicit refusal / decline-to-continue detection, one pattern per locale
// this app runs patient sessions in (mirrors the language coverage of
// RISK_SIGNAL_PATTERNS above). This is distinct from the safety_check stage,
// which looks for crisis/self-harm content -- a patient can decline to
// continue without any risk signal present, and previously that case fell
// through to normal state extraction/node resolution because only English
// phrasing was recognized here, silently ignoring e.g. a Korean-speaking
// patient saying "세션을 진행하고 싶지 않아요" (I don't want to continue the session).
// P0-1 (revised after real interactive-runtime reproduction -- see
// .claude/TASK_SCOPE.json's note2026_08_17f entry): the original fix used a
// negative lookbehind that only blocked the false positive when the target
// object's particle sat DIRECTLY before "그만" ("습관을 그만"). Real patient
// phrasing routinely separates them into two clauses -- "머리카락 만지는
// 습관이 있는데 그만하고싶어요" ("I have a habit of touching my hair, and I
// want to stop [it]") names "습관" several words before "그만", with no
// object particle immediately adjacent to it at all -- so the lookbehind
// never fired and this was still misclassified as session refusal in the
// actual npx tsx scripts/run-local-session.ts tbct-s02 --interactive
// reproduction. A regex can't reliably resolve every such elliptical
// reference, so the design is now deliberately conservative in the safer
// direction: bare "그만..." (with no session word) only counts as a refusal
// when it is the START of the message (optionally after a short subject/
// filler word) -- i.e. the participant's ENTIRE utterance is essentially
// "I want to stop", with nothing else in the message it could be
// referring to. Any sentence that names a different target BEFORE "그만",
// anywhere in the message, no longer matches this bare pattern (it can
// still match if the target named is the session itself, via
// KOREAN_SESSION_NOUN below, or the dedicated "오늘/여기서 그만" pattern).
const KOREAN_SESSION_NOUN = "(?:세션|치료|상담|이\s*대화|현재\s*대화)";
const REFUSAL_PATTERNS: RegExp[] = [
  // English
  /\b(?:i\s+(?:do\s+not|don['’]?t)\s+want\s+(?:counsel(?:ing)?|therapy|to\s+continue)|stop\s+(?:the\s+)?session|leave\s+me\s+alone)\b/i,
  // Korean: session/therapy/counseling explicitly named as the thing being
  // stopped or declined -- "상담을 그만하고 싶어요", "이 세션을 중단하고 싶어요",
  // "치료를 더 진행하고 싶지 않아요", "치료받고 싶지 않아요".
  new RegExp(`${KOREAN_SESSION_NOUN}(?:을|를)?\\s*(?:더\\s*)?(?:진행\\s*)?(?:그만(?:하고\\s*싶|두고\\s*싶|할래)?|중단하고\\s*싶|하고\\s*싶지\\s*않|하기\\s*싫|안\\s*할래|받고\\s*싶지\\s*않)`),
  // "오늘은 여기서 그만할래요" -- no session noun named, but "오늘"/"여기서"
  // anchor it to the current session rather than some other target.
  /오늘은?\s*여기(?:서|까지)\s*그만(?:할래|하고\s*싶)/,
  // Bare "그만(하고 싶어요/할래요/두고 싶어요)" as (essentially) the whole
  // message -- optionally after a short subject/filler word, never after a
  // named target. See the comment above this array for why this replaced
  // the earlier adjacency-only lookbehind check.
  /^(?:저는\s*|제가\s*|나는\s*|난\s*|이제\s*|그냥\s*|정말\s*)*그만(?:하고\s*싶|할래|두고\s*싶)/,
  /나\s*좀\s*내버려\s*(?:둬|두세요|주세요)/,
  // Portuguese
  /(?:n[aã]o\s+quero\s+(?:continuar|mais\s+terapia|mais\s+aconselhamento)|pare\s+(?:a\s+)?sess[aã]o|me\s+deixe?\s+em\s+paz)/i,
  // French
  /(?:je\s+ne\s+veux\s+(?:pas\s+continuer|plus\s+de\s+th[ée]rapie)|arr[êe]tez?\s+(?:la\s+)?session|laissez[- ]moi\s+tranquille)/i,
  // Japanese
  /(?:続けたくない|セッションをやめたい|もうやめたい|一人にして)/,
];

export function isExplicitPatientRefusal(text: string) {
  const trimmed = text.trim();
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// A body-sensation prompt asks what the patient notices physically (racing
// heart, shaky hands, tight chest); an emotion word ("좌절감을 느낀다" / "I feel
// frustrated") answers a different question and must not be accepted as-is,
// or it silently overwrites a clinically distinct field with the wrong content.
const EMOTION_WORD_PATTERN = /(좌절|슬픔|슬프|우울|불안|초조|화가\s*나|화남|분노|짜증|억울|창피|부끄|죄책감|수치심|외로움|무섭|두려움|절망|허탈|허무)|\b(?:frustrat\w*|sad(?:ness)?|anxious|anxiety|angry|anger|ashamed|shame|guilt\w*|lonely|afraid|fear\w*|hopeless)\b/i;
const BODY_SENSATION_WORD_PATTERN = /(심장|가슴|손이?\s*떨|떨림|두근|긴장|땀|호흡|숨이|어지럽|메스꺼|두통|근육|목이?\s*조|배가?|저림)|\b(?:heart\s*rac\w*|shak\w*|trembl\w*|sweat\w*|breath\w*|dizzy|nausea\w*|headache|tight\w*|muscle|tension)\b/i;

export function looksLikeFeelingNotBodySensation(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return EMOTION_WORD_PATTERN.test(trimmed) && !BODY_SENSATION_WORD_PATTERN.test(trimmed);
}

// An automatic thought is a prediction/judgment/meaning ("발표를 망칠 것 같다");
// a feeling statement ("좌절감을 느낀다") or an urge/avoidance-desire statement
// ("이 상황을 회피하고 싶어") answer a different question and should be redirected
// with a follow-up, not stored as the thought itself.
const URGE_OR_DESIRE_PATTERN = /(하고\s*싶|피하고\s*싶|회피하고\s*싶|도망치고\s*싶|그만두고\s*싶)|\b(?:want\s+to\s+(?:avoid|leave|escape|quit|stop)|feel\s+like\s+(?:avoiding|leaving|escaping))\b/i;

export function looksLikeFeelingOrUrgeNotThought(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return EMOTION_WORD_PATTERN.test(trimmed) || URGE_OR_DESIRE_PATTERN.test(trimmed);
}

// Mirror of looksLikeFeelingOrUrgeNotThought, for the opposite mismatch: a
// judgment/prediction ABOUT someone ("그 사람은 꼬인 사람이구나라고 생각할 거
// 같은데" -- "I'd think that's a twisted person") answering an EMOTION
// question. Confirmed live (S01's candidate/personal emotion prompts, which
// have no validation.kind and therefore no semantic-assessment coverage --
// see requiresSemanticInputAssessment): an explicit "-라고 생각"/"I think"
// judgment framing with no emotion word anywhere in it was accepted verbatim
// as the emotion and the turn advanced. Deliberately narrow (an explicit
// self-reported-thought marker, not just "any text that isn't an emotion
// word" -- a patient describing a feeling in words outside
// EMOTION_WORD_PATTERN's list must not be blocked) and deliberately does NOT
// flag when an emotion word is ALSO present ("나는 화가 났다고 생각해" still
// names an emotion, just phrased through "생각").
const THOUGHT_MARKER_PATTERN = /(?:라고|이라고)\s*생각(?:할|하는|이|해)|생각이?\s*들(?:어|었)|것\s*같다는\s*생각|\b(?:i\s+(?:think|thought|'d\s+think|would\s+think|believe|assumed?))\b/i;

export function looksLikeThoughtNotFeeling(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return THOUGHT_MARKER_PATTERN.test(trimmed) && !EMOTION_WORD_PATTERN.test(trimmed);
}

function compactText(value: string) {
  return normalizeText(value).replace(/[\s.,!?\u2026'"`~\u00B7\-_/\\()[\]{}]+/g, "");
}

/**
 * S08's courtroom roles (prosecutor, defense, juror) are only meaningful if
 * the participant speaks about the defendant in the third person, not as
 * themselves in the first person -- that dissociation is the whole point of
 * putting the charge on trial. This is a coarse heuristic (first-person
 * pronouns present, no third-person referent to the defendant), not a full
 * grammatical parse, so it only fires when the text reads unambiguously as
 * "I did X" with nothing else.
 *
 * Exported for runtime-execution-api.ts, which uses the same check to phrase
 * the source-mandated gentle correction ("I noticed you said 'I' -- right
 * now you are the prosecutor...") instead of a generic clarification.
 */
export function violatesThirdPersonRequirement(text: string) {
  const normalized = ` ${normalizeText(text)} `;
  const firstPerson = /\s(?:i|i'm|i am|i've|i have|i'd|i would|me|my|mine|myself)\s/.test(normalized)
    || /(?:^|\s)(?:저는|제가|저를|저의|나는|내가|나를|난)\s/.test(normalized);
  const thirdPerson = /\s(?:he|she|they|him|her|his|hers|their|them|the defendant)\s/.test(normalized)
    || /(?:피고인|그\s*사람|그녀|그가|그는|그를|그의|이\s*사람)/.test(normalized);
  return firstPerson && !thirdPerson;
}

function isMeaningfulTextResponse(input: {
  patientInput: PatientInput;
  promptItem?: PromptItem;
  field: string;
}) {
  if (input.patientInput.kind !== "text" || typeof input.patientInput.value !== "string") return true;
  const rawText = input.patientInput.value;
  if ((input.field === "evidenceFor" || input.field === "evidenceAgainst") && isNoMoreEvidence(rawText)) return true;

  const validation = input.promptItem?.validation as { kind?: string; values?: unknown; aliases?: Record<string, unknown> } | null | undefined;
  const normalized = normalizeText(rawText);
  const normalizedLexical = normalized.replace(/[.,!?…'"`~·\-_/\\()[\]{}]+/g, "").replace(/\s+/g, " ").trim();
  const activeQuestion = normalizeText(input.promptItem?.fallbackPatientText || input.promptItem?.verbatimText || "");
  const normalizedWithoutUiNoise = normalized.replace(/\b(?:read|read aloud)\b\s*$/i, "").trim();
  if (activeQuestion && activeQuestion.length >= 12 && (normalizedWithoutUiNoise === activeQuestion || normalizedWithoutUiNoise.includes(activeQuestion))) return false;
  const compact = compactText(rawText);

  // Field-scoped exception (not session<=3, and not a global constant
  // change): only fields explicitly opted in above get this behavior;
  // every other field in every session falls through to the unmodified
  // legacy checks below exactly as before.
  if (FIELDS_ACCEPTING_UNCERTAINTY.has(input.field) && (UNCERTAINTY_TEXT.has(normalized) || UNCERTAINTY_TEXT.has(normalizedLexical))) return true;
  if (META_QUESTION_AWARE_FIELDS.has(input.field) && looksLikeMetaQuestionAboutTheProcess(normalized)) return false;

  // Closed-answer prompts are decided FIRST, before the generic filler-word
  // rejection below. A yes/no question, a consent question and a two-option
  // decision are all answered with exactly the words NON_ANSWER_TEXT treats
  // as filler ("yes", "네", "sure"), so running that check first rejected a
  // participant who answered precisely what was asked -- three times over,
  // and then paused the session. For these prompts the validation IS the
  // completeness test, so deciding here loses nothing.
  if (validation?.kind === "boolean") {
    // Field-scoped, same reasoning as FIELDS_ACCEPTING_UNCERTAINTY above:
    // only problemScaleCardAvailable/goalScaleCardAvailable get the "have/
    // don't have, even with trailing text" reading -- every other
    // boolean-kind prompt keeps the exact-match-only legacy behavior.
    if (CARD_AVAILABILITY_FIELDS.has(input.field) && parseCardAvailabilityAnswer(rawText) !== null) return true;
    return BOOLEAN_ANSWER_TEXT.has(normalized) || BOOLEAN_ANSWER_TEXT.has(normalizedLexical);
  }
  // Same matcher the deterministic parser uses, so "is this a real answer?"
  // and "what value does it mean?" can never disagree -- a text answer this
  // accepts is guaranteed to resolve to a canonical value below.
  if (validation?.kind === "enum" && Array.isArray(validation.values)) {
    return matchEnumChoice(rawText, validation.values, validation.aliases) !== null;
  }
  if (validation?.kind === "informed_consent" && (CONSENT_ANSWER_TEXT.has(normalizedLexical) || CONSENT_ANSWER_TEXT.has(normalized))) return true;
  // P1-1: same "closed-answer decided first" reasoning as boolean/enum above
  // -- a rating's own numeric-range check IS the completeness test, so
  // deciding here avoids a single-digit answer ("4" for S02's 0-5 scale)
  // failing the generic compact.length >= 2 check below purely because a
  // single Latin digit is one character long. Also accepts the matching
  // color word for a color-coded scale (validation.includeColor), so
  // "노란색" alone -- 3 characters, but a real, complete answer -- isn't
  // rejected on some OTHER generic ground before reaching that path either.
  if (validation?.kind === "rating") {
    const min = Number((validation as { min?: unknown }).min ?? 0);
    const max = Number((validation as { max?: unknown }).max ?? 100);
    const percent = parsePercent(rawText);
    if (typeof percent === "number" && percent >= min && percent <= max) return true;
    if ((validation as { includeColor?: unknown }).includeColor && matchColorRatingWord(rawText) !== null) return true;
  }
  // Phase 1 (runtime orchestration simplification): private_placeholder_labels
  // is a closed-form answer like boolean/enum/rating above -- a lone "x" is a
  // complete, valid answer (the X/Y/Z letter itself), not an incomplete one,
  // so it must be decided here, before the generic compact.length >= 2 gate
  // below rejects it purely for being one character long.
  if (validation?.kind === "private_placeholder_labels") {
    const allowedLabels = Array.isArray((validation as { allowed?: unknown }).allowed) ? ((validation as { allowed: unknown[] }).allowed as unknown[]).map((label) => String(label).toUpperCase()) : ["X", "Y", "Z"];
    return parsePrivatePlaceholderLabelsInput(input.patientInput, allowedLabels) !== null;
  }

  if (!compact || NON_ANSWER_TEXT.has(normalized) || NON_ANSWER_TEXT.has(normalizedLexical) || NON_ANSWER_TEXT.has(compact) || /^(?:hm+|uh+|um+)$/i.test(normalizedLexical)) return false;
  if (/^(?:could|can|would) you (?:say|ask|explain|repeat|rephrase|put)\b.*(?:simply|again|differently|mean)?\??$/i.test(normalized)) return false;
  // A long, unbroken keyboard-like token is not a usable clinical answer. Keep
  // ordinary one-word emotions ("anxious", "sad") valid while rejecting the
  // common paste/test gibberish shape before any model call.
  if (!/\s/.test(normalized) && compact.length >= 14 && !/[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(compact)) return false;

  return compact.length >= 2 && /[A-Za-z0-9\uAC00-\uD7A3\u00C0-\u00FF]/.test(compact);
}

function parsePercent(value: string | string[] | number | boolean) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  return Number(match[0]);
}

export async function extractRuntimeState(input: {
  patientInput: PatientInput;
  currentNode: ClinicalStageNode;
  currentPromptItem?: PromptItem;
  currentContext: RuntimeContext;
  locale?: string;
}): Promise<StateExtractionResult> {
  const nextFields = { ...input.currentContext.fields };
  const rawText = Array.isArray(input.patientInput.value) ? input.patientInput.value.join(" ") : String(input.patientInput.value);
  const lowered = normalizeText(rawText);
  const payload: Record<string, unknown> = {};
  // S07's language-lock node (n02) is meant to lock onto the language of the
  // patient's first substantive message in THIS session, per the protocol's
  // "detect, don't ask" instruction -- but by the time that node runs, the
  // first substantive message was already this session's opening reply (n01).
  // Capture it here rather than asking a fresh meta-question later.
  //
  // crp-consent is a boolean, which the UI renders as Yes/No buttons, so its
  // rawText is literally "true"/"false" -- script detection on that always
  // returned en-US and locked every session, including Korean ones, to
  // English. Detect from real text when there is real text (crp-offer, the
  // free-text opening, now runs first), and otherwise fall back to the
  // locale the session was actually created with.
  const localeCaptureIds = new Set(["tbct-s07-n01-p01-crp-offer", "tbct-s07-n01-p02-crp-consent"]);
  if (input.currentPromptItem && localeCaptureIds.has(input.currentPromptItem.id) && !nextFields.sessionLanguage) {
    const hasFreeText = input.patientInput.kind === "text" && typeof input.patientInput.value === "string" && input.patientInput.value.trim().length > 0;
    nextFields.sessionLanguage = hasFreeText ? detectScriptLocale(rawText) : (input.locale ?? "en-US");
    nextFields.languageLocked = true;
  }
  const validation = input.currentPromptItem?.validation as { kind?: string } | null | undefined;
  const expectedFields = input.currentPromptItem
    ? input.currentPromptItem.outputFields
    : [String(payload.field ?? payload.responseField ?? input.currentNode.requiredFields[0] ?? input.currentNode.id)];
  const field = String(expectedFields[0] ?? "internalTurnEvidence");
  if (input.currentContext.lastClarificationReason === "safety_clarification") {
    if (/^(?:yes|yes,|i do|that is what i mean|\uB124|\uC608|\uADF8\uB7F0 \uB73B)/i.test(lowered)) {
      return { fields: { ...nextFields, crisisSignal: true }, responseCategory: "affirmative", riskLevel: "high", riskSignals: ["patient_confirmed_safety_concern"], confidence: 1, missingFields: [] };
    }
    if (/^(?:no|no,|not that|i mean|\uC544\uB2C8|\uC544\uB2C8\uC694)/i.test(lowered)) {
      return { fields: nextFields, responseCategory: "negative", riskLevel: "low", riskSignals: [], confidence: 1, missingFields: expectedFields };
    }
    return { fields: nextFields, responseCategory: "text", riskLevel: "low", riskSignals: ["ambiguous_safety_language"], confidence: 0.4, missingFields: expectedFields };
  }
  const kind = String(validation?.kind ?? payload.kind ?? input.patientInput.kind);
  const derivedBooleanFields = kind === "rating_or_absent" ? expectedFields.filter((item) => /Recorded$/i.test(item)) : [];
  const directlyEnteredFields = expectedFields.filter((item) => !derivedBooleanFields.includes(item));
  // P1-1: S02's problem/goal rating scale accepts the color word in place of
  // (or alongside) the digit -- see COLOR_RATING_PATTERNS. Substituting the
  // matched color's digit into the text this function parses numbers from
  // lets every existing numeric/rating code path below handle a color answer
  // exactly like a typed number, with no separate storage branch. Only fires
  // when includeColor is set (currently S02-only) and no digit is already
  // present, so a digit the participant DID type always wins.
  const colorRatingValidationMeta = input.currentPromptItem?.validation as { kind?: string; includeColor?: unknown } | null | undefined;
  const isColorCodedRating = colorRatingValidationMeta?.kind === "rating" && Boolean(colorRatingValidationMeta.includeColor);
  const colorRatingValue = isColorCodedRating ? matchColorRatingWord(rawText) : null;
  // "2랑 3 사이 같아요" / "2인지 3인지 모르겠어요" must not resolve to the first
  // number that happens to appear -- see isUncertainBetweenTwoRatings and the
  // early return below, which routes this to the existing
  // currentProblemScoreUncertain/currentGoalScoreUncertain clarification
  // instead of silently recording a guessed score.
  const uncertainBetweenRatingValues = isColorCodedRating && isUncertainBetweenTwoRatings(rawText);
  const ratingParseText = isColorCodedRating && !uncertainBetweenRatingValues && colorRatingValue !== null && !/\d/.test(rawText)
    ? String(colorRatingValue)
    : rawText;
  const cardAvailabilityValidationKind = (input.currentPromptItem?.validation as { kind?: string } | null)?.kind;
  const isCardAvailabilityField = CARD_AVAILABILITY_FIELDS.has(field) && cardAvailabilityValidationKind === "boolean" && input.patientInput.kind === "text" && typeof input.patientInput.value === "string";
  const deterministic = /ratings$/i.test(field)
    ? { handled: false as const }
    : (() => {
        // Try the shared parser FIRST -- it already correctly handles every
        // exact-match case (네/예/아니요, English yes/no, a literal boolean
        // patientInput.kind, ...), and must keep doing so unchanged. The
        // card-availability extension only ever ADDS acceptance for phrasing
        // the shared parser doesn't recognize (see parseCardAvailabilityAnswer's
        // comment); it never overrides or skips the shared result.
        const base = parseDeterministicPromptInput(input.patientInput, input.currentPromptItem?.validation);
        if (isCardAvailabilityField && !(base.handled && base.valid)) {
          const value = parseCardAvailabilityAnswer(input.patientInput.value as string);
          if (value !== null) return { handled: true as const, valid: true as const, value, reason: undefined };
        }
        return base;
      })();
  const percent = parsePercent(ratingParseText);
  // participationRatingStable is a free-text reflection field ("How does
  // that feel to you now?") that happens to contain "Rating" in its name --
  // excluded explicitly so a natural-language answer with no digits in it
  // isn't rejected as numeric input missing a number.
  const numericLike = kind === "rating" || (field !== "participationRatingStable" && /intensity|percent|rating|score|weight/i.test(field));
  // Respect the prompt's own configured range (e.g. a 0-5 color-coded scale)
  // instead of always assuming a 0-100% belief/intensity rating.
  const ratingRange = input.currentPromptItem?.validation as { min?: unknown; max?: unknown } | null | undefined;
  const effectiveRatingMin = Number(ratingRange?.min ?? 0);
  const effectiveRatingMax = Number(ratingRange?.max ?? 100);
  const validPercent = typeof percent === "number" && percent >= effectiveRatingMin && percent <= effectiveRatingMax;
  const riskSignals = detectRuntimeRiskSignals(lowered);
  // P0-6: a negated/historical/third-party mention still counts as a risk
  // signal for every "be conservative" gate below (riskSignals.length > 0),
  // but must not itself confirm current self-risk -- see isNonCurrentRiskMention.
  const isAmbiguousRiskMention = riskSignals.length > 0 && isNonCurrentRiskMention(rawText);
  const riskLevel = riskSignals.length > 0 && !isAmbiguousRiskMention ? "high" : input.currentContext.riskLevel ?? "low";
  if (riskSignals.length > 0 && !isAmbiguousRiskMention) nextFields.crisisSignal = true;
  // Phase 2 (runtime orchestration simplification): S02's problems/goals now
  // have a single semantic owner -- assessRuntimePatientInput, the same
  // assessment layer every other session's insight-style fields already use
  // -- instead of a session-scoped regex classifier deciding "is this a real
  // candidate, a meta-question, or nothing more" on its own. Safety is
  // checked first (riskSignals, above) and always wins; deterministic
  // closed-form parsing doesn't apply to these fields (free-text "array"
  // kind); this is the open-text interpretation step for exactly these two
  // fields, replacing the old P0-1 regex early-return that used to sit here.
  // looksLikeS02MetaOrClarification/classifyS02ListResponse are kept defined
  // (not deleted this phase -- looksLikeS02MetaOrClarification still backs
  // looksLikeS02ExplanationRequest, used elsewhere for P1's rating-card
  // clarification) but no longer gate storage for problems/goals here.
  if (!riskSignals.length && input.currentPromptItem && isS02CollectionField({ promptItem: input.currentPromptItem, field })) {
    if (!rawText.trim()) {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: 0, missingFields: expectedFields };
    }
    const assessment = await assessRuntimePatientInput({ patientInput: input.patientInput, promptItem: input.currentPromptItem, locale: input.locale });
    // Fail-closed (Phase 2 section 11): a provider error/timeout/malformed
    // response must never silently append raw text to a clinical list --
    // that is exactly the bug this phase fixes ("강박증을 치료받을 수
    // 있나요?" falling through to "it's non-empty text, so append it").
    if (assessment.error) {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: 0, missingFields: expectedFields };
    }
    if (assessment.safetyLevel === "high" || assessment.safetyLevel === "critical") {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel: "high", riskSignals: assessment.safetySignals?.length ? assessment.safetySignals : ["assessment_high_risk"], confidence: assessment.confidence, missingFields: [] };
    }
    if (assessment.safetyLevel === "moderate") {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel: "low", riskSignals: ["ambiguous_safety_language", ...(assessment.safetySignals ?? [])], confidence: assessment.confidence, missingFields: expectedFields };
    }
    if (assessment.intent === "refusal") {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals: [...riskSignals, "patient_refusal_semantic"], confidence: assessment.confidence, missingFields: expectedFields };
    }
    const turnAction = deriveS02CollectionTurnAction(assessment);
    if (turnAction === "collection_stop") {
      const stoppedFields: Record<string, unknown> = { ...input.currentContext.fields, [`${field}NoMore`]: true };
      refreshListRatingPointers(stoppedFields);
      return { fields: stoppedFields, responseCategory: "text", riskLevel, riskSignals, confidence: assessment.confidence, missingFields: [] };
    }
    if (turnAction === "clarification_request" || turnAction === "unresolved") {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: assessment.confidence, missingFields: expectedFields };
    }
    // accept_answer: store the participant's own wording verbatim -- never
    // the model's rephrasing (assessment.extractedFields is intentionally
    // unused here, same rule dialogue-agent-contract.ts's
    // assistantMustNotSupply already enforces for the dialogue-agent side).
    const currentList = Array.isArray(input.currentContext.fields[field]) ? (input.currentContext.fields[field] as string[]) : [];
    const acceptedFields: Record<string, unknown> = { ...nextFields };
    if (isDuplicateListEntry(currentList, rawText)) {
      acceptedFields[`${field}Duplicate`] = true;
    } else {
      acceptedFields[field] = [...currentList, rawText];
      acceptedFields[`${field}Duplicate`] = false;
      // P0-4 (goal-dream-small-step gating): unchanged from the prior phase
      // -- a real distant dream is only ever identified here, at goal-dream,
      // when the answer is genuinely accepted as an item.
      if (input.currentPromptItem.id === "tbct-s02-n07-p05-goal-dream") acceptedFields.goalDistantDreamIdentified = true;
    }
    for (const [key, value] of Object.entries(acceptedFields)) { if (Array.isArray(value)) acceptedFields[`${key}Count`] = value.length; }
    refreshListRatingPointers(acceptedFields);
    return { fields: acceptedFields, responseCategory: "text", riskLevel, riskSignals, confidence: assessment.confidence, missingFields: [] };
  }
  // Phase 3 (runtime orchestration simplification): S02's rating-one-item
  // correction now has a single semantic owner -- assessRuntimePatientInput,
  // the same assessment layer Phase 2 already gave problems/goals collection
  // -- instead of the session-scoped classifyS02RatingCorrection regex.
  // Order matters and is checked BEFORE the numeric-range gate below: a
  // correction with no digit in it must not fail as an invalid rating, and
  // one WITH a stray digit ("5. 근데 이건 앞에 있던 거랑 같은 항목이에요") must
  // never be captured as that digit's rating. A genuinely pure closed-form
  // answer ("5", "노란색") skips the semantic call entirely -- no need to ask
  // an assessment model to classify an unambiguous number.
  if (!riskSignals.length && isColorCodedRating && input.currentPromptItem && isS02RatingCorrectionField(field)) {
    const ratingListField = field === "problemRatings" ? "problems" : "goals";
    if (!isPureClosedFormRatingAnswer(rawText, isColorCodedRating)) {
      const assessment = await assessRuntimePatientInput({ patientInput: input.patientInput, promptItem: input.currentPromptItem, locale: input.locale });
      // Fail-closed (Phase 3 section 27, same principle as Phase 2 section
      // 11): a provider error must never silently record a stray digit as a
      // rating, and must never guess whether the current item should be
      // removed.
      if (assessment.error) {
        return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: 0, missingFields: expectedFields };
      }
      if (assessment.safetyLevel === "high" || assessment.safetyLevel === "critical") {
        return { fields: input.currentContext.fields, responseCategory: "text", riskLevel: "high", riskSignals: assessment.safetySignals?.length ? assessment.safetySignals : ["assessment_high_risk"], confidence: assessment.confidence, missingFields: [] };
      }
      if (assessment.safetyLevel === "moderate") {
        return { fields: input.currentContext.fields, responseCategory: "text", riskLevel: "low", riskSignals: ["ambiguous_safety_language", ...(assessment.safetySignals ?? [])], confidence: assessment.confidence, missingFields: expectedFields };
      }
      if (assessment.intent === "refusal") {
        return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals: [...riskSignals, "patient_refusal_semantic"], confidence: assessment.confidence, missingFields: expectedFields };
      }
      const turnAction = deriveS02RatingTurnAction(assessment);
      if (turnAction === "current_item_correction") {
        const correctedFields = applyCurrentRatingItemCorrection({ listField: ratingListField, ratingsField: field, fields: { ...nextFields } });
        if (!correctedFields) {
          // Invariant violated (ratings.length already >= list.length --
          // there is no current unrated item to remove). Never guess; ask
          // again instead of silently deleting an arbitrary item.
          return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: 0, missingFields: expectedFields };
        }
        // inputDisposition: "state_corrected" tells runtime-execution-api.ts
        // to reduce this turn as patient_state_corrected, not
        // patient_input_accepted -- see reduceRuntimeState's doc comment for
        // why that distinction matters (repeat_until iteration budget).
        return { fields: correctedFields, responseCategory: "text", riskLevel, riskSignals, confidence: assessment.confidence, missingFields: [], inputDisposition: "state_corrected" };
      }
      if (turnAction === "clarification_request" || turnAction === "unresolved") {
        return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: assessment.confidence, missingFields: expectedFields };
      }
      // accept_answer: fall through to the existing numeric/color rating
      // extraction below (CUMULATIVE_RATING_FIELDS) -- the same accumulation
      // logic every rating already goes through, now reached via the
      // semantic gate for non-pure-closed-form text instead of skipping it.
    }
  }
  const numericValues = [...ratingParseText.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter((value) => value >= 0 && value <= 100);
  if (deterministic.handled && !deterministic.valid && !riskSignals.length) {
    return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: 1, missingFields: expectedFields };
  }
  // The prompt actively collecting entry N+1 of a list (S02's problem-/goal-
  // follow-up questions -- problem-home-work-relationships and siblings)
  // targets the same list field but, being a follow_up rather than the
  // original question, carries no validation.kind of its own -- so `kind`
  // above falls through to "text" and LIST_BUILDING_VALIDATION_KINDS alone
  // misses it. Checking whether the field already holds a list catches
  // exactly this continuation case without touching first-turn behavior.
  const isBuildingExistingList = Array.isArray(input.currentContext.fields[field]);
  if ((LIST_BUILDING_VALIDATION_KINDS.has(kind) || isBuildingExistingList) && isListAcknowledgementOnly(rawText) && !riskSignals.length) {
    return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: 1, missingFields: expectedFields };
  }
  // A request to explain the active task is conversational control, not the
  // participant's clinical answer -- but only for participant_summary_required
  // (see isExplanationRequest's header comment). Keep the field unresolved so
  // the same Claude turn can explain the construct and return to the task
  // instead of storing "what do you mean?" as worksheet content.
  if (kind === "participant_summary_required" && input.patientInput.kind === "text" && isExplanationRequest(rawText) && !riskSignals.length) {
    return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: 1, missingFields: expectedFields };
  }
  if (numericLike && (numericValues.length < directlyEnteredFields.length || !validPercent) && !riskSignals.length) {
    return {
      fields: input.currentContext.fields,
      responseCategory: "text",
      riskLevel,
      riskSignals,
      confidence: 0.25,
      missingFields: directlyEnteredFields.slice(numericValues.length),
    };
  }
  // A pair of ratings such as the Consensus chair's advantage/disadvantage
  // weights must total 100; otherwise treat the turn as incomplete and ask
  // the patient to restate it rather than silently recording an inconsistent
  // pair. See SUM_TO_100_PAIR_KINDS for which validation kinds this applies to.
  if (kind && SUM_TO_100_PAIR_KINDS.has(kind) && directlyEnteredFields.length === 2 && numericValues.length >= 2 && !riskSignals.length && Math.abs(numericValues[0] + numericValues[1] - 100) > 1) {
    return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals, confidence: 0.3, missingFields: directlyEnteredFields };
  }
  // The source's third-person rule for courtroom roles (S08 KP3): when the
  // participant argues a role in the first person, the therapist gently
  // corrects ONCE ("I noticed you said 'I' -- right now you are the
  // prosecutor...") and then proceeds. Rejecting here routes the turn into
  // the clarification path, where runtime-execution-api.ts phrases that exact
  // correction; the clarificationAttemptCount gate makes it one-time -- a
  // participant who keeps their phrasing after the reminder is accepted
  // rather than looped toward a max-attempts pause. "No more"-style answers
  // are exempt: they end a collection loop, they don't argue the role.
  const requiresThirdPerson = Boolean((input.currentPromptItem?.validation as { requiresThirdPerson?: boolean } | null)?.requiresThirdPerson);
  if (
    !riskSignals.length
    && requiresThirdPerson
    && input.patientInput.kind === "text"
    && typeof input.patientInput.value === "string"
    && !isNoMoreEvidence(rawText)
    && (input.currentContext.clarificationAttemptCount ?? 0) === 0
    && violatesThirdPersonRequirement(rawText)
  ) {
    return {
      fields: input.currentContext.fields,
      responseCategory: "text",
      riskLevel,
      riskSignals,
      confidence: 0.3,
      missingFields: expectedFields.length ? [field] : [],
    };
  }
  if (!riskSignals.length && !isMeaningfulTextResponse({ patientInput: input.patientInput, promptItem: input.currentPromptItem, field })) {
    return {
      fields: input.currentContext.fields,
      responseCategory: "text",
      riskLevel,
      riskSignals,
      confidence: 0.2,
      missingFields: expectedFields.length ? [field] : [],
    };
  }
  const explicitlyProvidedFields = new Set<string>();
  if (!numericLike && expectedFields.length > 1) {
    for (const expectedField of expectedFields) {
      const escaped = expectedField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = rawText.match(new RegExp(`(?:^|[,;\\n])\\s*${escaped}\\s*:\\s*([^,;\\n]+)`, "i"));
      if (match?.[1]?.trim()) {
        nextFields[expectedField] = match[1].trim();
        explicitlyProvidedFields.add(expectedField);
      }
    }
  }
  const allExpectedFieldsProvided = expectedFields.length > 0 && expectedFields.every((expectedField) => explicitlyProvidedFields.has(expectedField));
  // The patient has already been asked to clarify this exact PromptItem at
  // least once (clarificationAttemptCount resets to 0 the moment any turn
  // succeeds -- see runtime-execution-api.ts) and is now answering again.
  // Semantic assessment (especially the deterministic fallback used when no
  // cloud provider is configured, see assessment-providers.ts) can reject a
  // perfectly reasonable elaboration it simply can't cleanly split or
  // classify -- most visibly for non-English, multi-field prompts like
  // "distressing situation + automatic thought" answered in one Korean
  // sentence, where the deterministic model's field-splitting only
  // recognizes English connector phrasing ("...and I thought that..."). A
  // second on-topic reply should not loop back to the identical question a
  // third time just because that classification still can't confidently
  // parse it -- see the fallback-fill below, applied once we know we won't
  // hard-reject on relevance/completion alone this turn.
  const isLenientRetry = (input.currentContext.clarificationAttemptCount ?? 0) >= 1;
  if (!riskSignals.length && !allExpectedFieldsProvided && input.currentPromptItem && requiresSemanticInputAssessment({ patientInput: input.patientInput, promptItem: input.currentPromptItem, field })) {
    const assessment = await assessRuntimePatientInput({ patientInput: input.patientInput, promptItem: input.currentPromptItem, locale: input.locale });
    if (assessment.error && /\b(?:disappear|not wake up|better off without me|better off dead|no reason to live|cannot go on|can't go on|hopeless|desperate)\b/i.test(rawText)) {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel: "low", riskSignals: ["ambiguous_safety_language", "assessment_failure_conservative_clarification"], confidence: 0, missingFields: expectedFields };
    }
    // Safety-level escalation and explicit-refusal detection stay strict
    // regardless of retry count -- lenience here is about relevance/
    // completion classification, never about safety signals.
    if (assessment.safetyLevel === "high" || assessment.safetyLevel === "critical") {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel: "high", riskSignals: assessment.safetySignals?.length ? assessment.safetySignals : ["assessment_high_risk"], confidence: assessment.confidence, missingFields: [] };
    }
    if (assessment.safetyLevel === "moderate") {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel: "low", riskSignals: ["ambiguous_safety_language", ...(assessment.safetySignals ?? [])], confidence: assessment.confidence, missingFields: expectedFields };
    }
    // Model-classified refusal, in whatever language the session runs in --
    // catches phrasing the static isExplicitPatientRefusal keyword list
    // (English-only fast path, checked unconditionally by the caller) will
    // never cover. Reported as a risk signal so runtime-execution-api.ts can
    // route it into the same "patient declined to continue" pause branch.
    if (assessment.intent === "refusal") {
      return { fields: input.currentContext.fields, responseCategory: "text", riskLevel, riskSignals: [...riskSignals, "patient_refusal_semantic"], confidence: assessment.confidence, missingFields: expectedFields.length ? [field] : [] };
    }
    if (!assessment.accepted && !isLenientRetry) {
      return {
        fields: input.currentContext.fields,
        responseCategory: "text",
        riskLevel,
        riskSignals,
        confidence: "confidence" in assessment ? assessment.confidence : 0,
        missingFields: expectedFields.length ? [field] : [],
      };
    }
    // For a single-field prompt there is nothing to split, so the patient's
    // own wording is always what gets stored -- the assessment above only
    // decided accept/reject. Merging its extractedFields here would let the
    // model's own phrasing silently replace the patient's, which is exactly
    // the "AI supplies the answer" failure this system is meant to prevent.
    // Only a genuinely multi-field prompt (e.g. splitting one message into
    // distressingSituation + automaticThought) needs the model's help
    // separating clinically distinct concepts. This can run even when
    // assessment.accepted was false (a lenient retry past the rejection
    // above) -- extractedFields reflects whatever the model could still
    // classify per-field regardless of its overall verdict, and using it is
    // strictly more precise than the raw-text fallback-fill below, which
    // only covers whatever remains unset after this.
    if (expectedFields.length > 1) {
      for (const [allowedField, value] of Object.entries(assessment.extractedFields ?? {})) {
        if (expectedFields.includes(allowedField)) nextFields[allowedField] = value;
      }
    }
  }

  const currentFieldValue = input.currentContext.fields[field];
  if (Array.isArray(currentFieldValue) && !LIST_BUILDING_VALIDATION_KINDS.has(kind) && field !== "evidenceFor" && field !== "evidenceAgainst" && kind !== "participation_percentages" && !numericLike) {
    // A follow-up/confirmation prompt sharing a list-typed field (e.g. one of
    // several "problems" elicitation questions) must not silently overwrite
    // the list already built by an earlier prompt just because it has no
    // validation.kind of its own. Treat it as one more entry in the same
    // list instead of destroying everything collected so far.
    const current = currentFieldValue as string[];
    // P0-1: S02's problems/goals additionally recognize idiom-based "no
    // more" phrasing ("이미 이루어서 없어요", "딱히 없어요") the global
    // isNoMoreEvidence exact-match set doesn't cover -- see
    // classifyS02ListResponse's comment. Every other list field keeps the
    // exact prior isNoMoreEvidence-only behavior.
    if (isNoMoreEvidence(rawText) || (S02_LIST_FIELDS.has(field) && looksLikeS02NoMoreIdiom(rawText))) {
      nextFields[`${field}NoMore`] = true;
    } else if (!isDuplicateListEntry(current, rawText)) {
      nextFields[field] = [...current, rawText].filter(Boolean);
      // P0-4: goal-dream is the only prompt that elicits a genuine "distant
      // dream" candidate -- goal-dream-small-step must only fire when a
      // REAL one was named here (not "없어요"/a meta remark, both already
      // routed away before reaching this branch).
      if (input.currentPromptItem?.id === "tbct-s02-n07-p05-goal-dream") nextFields.goalDistantDreamIdentified = true;
    }
  } else if (kind === "language_lock_from_first_substantive_message") {
    // The protocol locks the session language from the patient's own first
    // substantive reply rather than asking a meta-question about it.
    nextFields.sessionLanguage = detectScriptLocale(rawText);
    nextFields.languageLocked = true;
  } else if (CUMULATIVE_RATING_FIELDS[field] && numericLike) {
    // These prompts are reused turn after turn to rate one list item at a
    // time; accumulate instead of overwriting so later totals are correct.
    const current = Array.isArray(input.currentContext.fields[field]) ? (input.currentContext.fields[field] as number[]) : [];
    // P1-1: "2랑 3 사이 같아요" must not silently resolve to the first number
    // that happens to appear -- flag the uncertainty (the catalog's
    // score-clarification prompt activates on it) and record nothing this
    // turn, rather than rejecting the turn outright (which would discard
    // this exact field change -- only "accepted" turns persist fields).
    if (uncertainBetweenRatingValues) {
      nextFields[`${CUMULATIVE_RATING_FIELDS[field]}Uncertain`] = true;
      const candidates = extractUncertainRatingCandidates(rawText);
      if (candidates) nextFields[`${CUMULATIVE_RATING_FIELDS[field]}UncertainRange`] = candidates;
    } else {
      const value = validPercent ? percent : deterministic.handled && deterministic.valid ? Number(deterministic.value) : null;
      if (typeof value === "number" && Number.isFinite(value)) {
        nextFields[field] = [...current, value];
        nextFields[CUMULATIVE_RATING_FIELDS[field]] = value;
        const correctionPrefix = field === "problemRatings" ? "problem" : field === "goalRatings" ? "goal" : null;
        if (correctionPrefix) {
          nextFields[`${correctionPrefix}RatingCorrectionApplied`] = false;
        }
        // A resolved rating clears any earlier between-two-scores
        // uncertainty flag, so score-clarification doesn't keep firing once
        // the participant has actually settled on a value.
        nextFields[`${CUMULATIVE_RATING_FIELDS[field]}Uncertain`] = false;
      }
    }
  } else if (numericLike && (directlyEnteredFields.length > 1 || derivedBooleanFields.length > 0)) {
    directlyEnteredFields.forEach((expectedField, index) => { nextFields[expectedField] = numericValues[index]; });
    derivedBooleanFields.forEach((expectedField) => { nextFields[expectedField] = true; });
  } else if (field === "initialATBeliefPercent" || field === "conclusionBeliefPercent" || field === "revisedATBeliefPercent" || field === "initialEmotionIntensityPercent" || field === "newEmotionIntensities") {
    nextFields[field] = validPercent ? percent : input.patientInput.value;
  } else if (kind === "computed_remainder") {
    // The patient (not the assistant) states their own remaining share; the
    // runtime only checks it against the mathematical remainder of the
    // other contributors already recorded, so a mismatch can be explored
    // via the existing "participantRejectsRemainder" branch instead of the
    // assistant silently supplying or overwriting the number.
    const otherRounds = (nextFields.participationRatingsRound1 ?? nextFields.participationRatingRounds) as Array<{ percent: number }> | undefined;
    const sumOthers = Array.isArray(otherRounds) ? otherRounds.reduce((sum, item) => sum + (Number(item?.percent) || 0), 0) : 0;
    const expectedRemainder = Math.max(0, 100 - sumOthers);
    nextFields[field] = validPercent ? percent : input.patientInput.value;
    nextFields.expectedParticipationRemainder = expectedRemainder;
    nextFields.participantRejectsRemainder = typeof percent === "number" && Math.abs(percent - expectedRemainder) > 1;
  } else if (kind === "participation_percentages" && field === "participationRatingRounds") {
    // Step 6 (re-rating, bounded to rounds 2-3 -- see the maxIterations
    // comment on updated-percentage in source-fidelity-catalog.ts for why
    // this stops at a fixed round count rather than a dynamic stability
    // loop). Unlike the flat participationRatingsRound1 list below, this
    // field is an array OF ROUNDS -- each round itself an array of
    // {contributor, percent} entries -- since the same prompt is answered
    // once per contributor, across two full passes. A new round starts
    // exactly when the previous one (or none yet) already covers every
    // contributor.
    const contributors = Array.isArray(nextFields.contributors) ? (nextFields.contributors as string[]) : [];
    const rounds = Array.isArray(nextFields.participationRatingRounds) ? (nextFields.participationRatingRounds as Array<Array<{ contributor: string; percent: number }>>) : [];
    const percentMatch = rawText.match(/-?\d+(?:\.\d+)?/);
    if (percentMatch && contributors.length > 0) {
      const contributorPercent = Number(percentMatch[0]);
      const lastRound = rounds[rounds.length - 1];
      const startNewRound = !lastRound || lastRound.length >= contributors.length;
      const roundInProgress = startNewRound ? [] : lastRound;
      const contributorName = contributors[roundInProgress.length] ?? `Contributor ${roundInProgress.length + 1}`;
      const updatedRound = [...roundInProgress, { contributor: contributorName, percent: contributorPercent }];
      const updatedRounds = startNewRound ? [...rounds, updatedRound] : [...rounds.slice(0, -1), updatedRound];
      nextFields.participationRatingRounds = updatedRounds;
      const roundComplete = updatedRound.length >= contributors.length;
      nextFields.allContributorsRatedThisRound = roundComplete;
      nextFields.currentParticipationContributorText = contributors[updatedRound.length];
      nextFields.participationReratingComplete = roundComplete && updatedRounds.length >= 2;
    }
  } else if (LIST_BUILDING_VALIDATION_KINDS.has(kind) || field === "evidenceFor" || field === "evidenceAgainst") {
    // A growing list the patient builds one entry at a time (problems,
    // goals, contributors, symptom items, evidence, disadvantages, ...).
    // Skip an exact repeat of an existing entry instead of registering it
    // as a second, distinct item.
    const current = Array.isArray(input.currentContext.fields[field]) ? (input.currentContext.fields[field] as string[]) : [];
    // P0-1: same S02 idiom extension as the follow-up-prompt branch above.
    if (isNoMoreEvidence(rawText) || (S02_LIST_FIELDS.has(field) && looksLikeS02NoMoreIdiom(rawText))) {
      nextFields[`${field}NoMore`] = true;
    } else if (isDuplicateListEntry(current, rawText)) {
      nextFields[`${field}Duplicate`] = true;
    } else {
      nextFields[field] = [...current, rawText].filter(Boolean);
      nextFields[`${field}NoMore`] = false;
      nextFields[`${field}Duplicate`] = false;
      if (input.currentPromptItem?.id === "tbct-s02-n07-p05-goal-dream") nextFields.goalDistantDreamIdentified = true;
      // S07's empty chair stores both sides' turns in one flat list, so the
      // worksheet had to guess who was speaking from array-index parity --
      // labels that silently shift if an entry is added, edited or removed.
      // Record the speaker at capture time instead. Emotion always speaks
      // first (the Step 3 prompt is "Emotion, speak directly to Reason"),
      // and the chairs alternate from there.
      if (field === "emotionReasonDialogue") {
        const speakers = Array.isArray(nextFields.emotionReasonSpeakers) ? (nextFields.emotionReasonSpeakers as string[]) : [];
        nextFields.emotionReasonSpeakers = [...speakers, speakers[speakers.length - 1] === "emotion" ? "reason" : "emotion"];
      }
      // The S06 modifier-decomposition follow-up ("Is [core situation]
      // harder when...") refers back to the first item the participant
      // named, before the list branches into specific variants.
      if (field === "symptomItems") nextFields.symptomCoreSituation = (nextFields[field] as string[])[0];
    }
  } else if (field === "automaticThought") {
    // Leave the field unset (rather than storing a feeling/urge verbatim as
    // "the thought") so it comes back through missingFields and the patient
    // is asked what specifically went through their mind.
    nextFields.automaticThoughtReportedAsFeeling = looksLikeFeelingOrUrgeNotThought(rawText);
    if (!nextFields.automaticThoughtReportedAsFeeling) nextFields.automaticThought = rawText;
  } else if (kind === "private_placeholder_labels") {
    // Section 13 known-blocker fix: "아니요" (decline), "네, X로 할게요"
    // (name one), and "X랑 Y요" (name two) must all be recognized -- the
    // catalog had no parser at all for this kind, so every answer here was
    // stored as the raw sentence, and privateProblemAdded (the flag
    // acknowledge-private-placeholder/continue-without-placeholder branch on)
    // was never set anywhere, permanently dead. The AI must never ask what
    // the private problem actually IS (the whole point of the X/Y/Z
    // convention is that it stays undescribed) -- only the letter(s) named
    // are ever extracted, and per the source manual they're tracked
    // alongside the other problems for rating.
    //
    // Phase 1: parsing now lives once in parseDeterministicPromptInput
    // (deterministic, computed above) instead of being re-derived here with
    // a second inline regex. Reaching this branch at all means deterministic
    // was handled+valid (a genuinely unparseable answer -- neither an
    // explicit decline nor a nameable letter -- already returned as a
    // clarification earlier in this function), so deterministic.value here
    // is always unambiguous: [] means the participant declined, a non-empty
    // array means they named letters. Parse failure can never reach this
    // branch and can therefore never be silently treated as a decline.
    const parsedLabels = deterministic.handled && Array.isArray(deterministic.value) ? (deterministic.value as string[]) : [];
    nextFields.privateProblemPlaceholders = parsedLabels;
    nextFields.privateProblemAdded = parsedLabels.length > 0;
    if (parsedLabels.length > 0) {
      const currentProblems = Array.isArray(input.currentContext.fields.problems) ? (input.currentContext.fields.problems as string[]) : [];
      nextFields.problems = [...currentProblems, ...parsedLabels.filter((label) => !currentProblems.includes(label))];
    }
  } else if (field === "underlyingBelief") {
    nextFields.underlyingBelief = rawText;
    nextFields.workingAutomaticThought = rawText;
  } else if (field === "workingAutomaticThought") {
    nextFields.workingAutomaticThought = rawText;
  } else if (/BodySensations$/i.test(field) && looksLikeFeelingNotBodySensation(rawText)) {
    // Same idea for body-sensation prompts: an emotion word ("좌절감을 느낀다")
    // isn't a physical sensation, so leave the field unset and let the
    // missing-field clarification ask for one (racing heart, shaky hands, ...).
    nextFields[`${field}ReportedAsFeeling`] = true;
  } else if (/Emotion$/i.test(field) && looksLikeThoughtNotFeeling(rawText)) {
    // See looksLikeThoughtNotFeeling's own comment -- leave the field unset
    // (rather than storing a judgment/prediction verbatim as "the emotion")
    // so it comes back through missingFields and the patient is asked again,
    // same pattern as automaticThought/BodySensations above.
    nextFields[`${field}ReportedAsThought`] = true;
  } else if (expectedFields.length === 1) {
    nextFields[field] = deterministic.handled && deterministic.valid ? deterministic.value : input.patientInput.value;
  }

  // Some prompts (e.g. the second/third TBCT candidate examples) are meant to
  // surface a *different* reaction than an earlier sibling field. If the
  // patient's answer just repeats the sibling verbatim, flag it so a
  // catalog-authored clarification prompt can gently invite them to consider
  // how this situation might differ, instead of silently accepting the copy.
  const siblingField = (input.currentPromptItem?.validation as { siblingField?: unknown } | null)?.siblingField;
  if (typeof siblingField === "string" && typeof nextFields[field] === "string" && typeof nextFields[siblingField] === "string") {
    nextFields[`${field}RepeatsSibling`] = normalizeText(nextFields[field] as string) === normalizeText(nextFields[siblingField] as string);
  }

  // Multi-concept text prompts must not copy one value into clinically distinct
  // fields. Accept explicit `field: value` segments; otherwise keep the first
  // field and request the missing concepts on the same PromptItem.
  if (!numericLike && expectedFields.length > 1 && explicitlyProvidedFields.size === 0) {
    for (const expectedField of expectedFields) {
      const escaped = expectedField.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = rawText.match(new RegExp(`(?:^|[,;\\n])\\s*${escaped}\\s*:\\s*([^,;\\n]+)`, "i"));
      if (match?.[1]?.trim()) nextFields[expectedField] = match[1].trim();
    }
  }

  // Lenient-retry fallback: every kind-specific branch above (list-building,
  // ratings, the named single-concept fields, the explicit "field: value"
  // matcher) had its chance to place this answer somewhere meaningful. If a
  // field is STILL unset after all of that on a second-or-later attempt at
  // this exact prompt, an unparsed but on-topic elaboration is a better
  // record than an indefinitely repeated clarification -- store the
  // patient's own words rather than leave the field empty forever. This
  // never overwrites a field a more specific branch already populated
  // (e.g. a genuinely split distressingSituation from an earlier partial
  // answer), and it does not apply to numeric/rating/boolean/enum fields,
  // which fail earlier and unconditionally when malformed.
  if (isLenientRetry && !riskSignals.length && !numericLike) {
    for (const expectedField of expectedFields) {
      if (nextFields[expectedField] === undefined || nextFields[expectedField] === "") nextFields[expectedField] = rawText;
    }
  }
  const missingExpectedFields = expectedFields.filter((expectedField) => nextFields[expectedField] === undefined || nextFields[expectedField] === "");

  // Derive a `<field>Count` for every list-shaped field so branch conditions
  // already authored in the catalog (e.g. "evidenceForCount < 2") have a
  // real value to read instead of always evaluating against `undefined`.
  for (const [key, value] of Object.entries(nextFields)) {
    if (Array.isArray(value)) nextFields[`${key}Count`] = value.length;
  }
  refreshListRatingPointers(nextFields);
  for (const [listField, rule] of Object.entries(LIST_SUFFICIENCY_RULES)) {
    const count = Number(nextFields[`${listField}Count`] ?? 0);
    nextFields[rule.sufficiencyField] = count >= rule.target
      || (nextFields[`${listField}NoMore`] === true && count >= rule.minBeforeNoMore);
  }
  // S08 Steps 10/12 pair each loop's entries 1:1 with the previous loop's
  // (one rebuttal per defense item, one surrebuttal per rebuttal, one
  // "Therefore..." per surrebutted pair). Their repeat_until prompts complete
  // on these derived flags, so the loop keeps inviting the NEXT item until
  // every pair is covered -- or the participant says they cannot answer one,
  // which S08's unrebutted-defense-note then records explicitly.
  const pairCompletion: Array<{ listField: string; pairedField: string; completeField: string }> = [
    { listField: "prosecutionRebuttals", pairedField: "defenseEvidence", completeField: "prosecutionRebuttalsComplete" },
    { listField: "defenseSurrebuttals", pairedField: "prosecutionRebuttals", completeField: "defenseSurrebuttalsComplete" },
    { listField: "thereforeConclusions", pairedField: "defenseSurrebuttals", completeField: "thereforeConclusionsComplete" },
  ];
  for (const { listField, pairedField, completeField } of pairCompletion) {
    const count = Number(nextFields[`${listField}Count`] ?? 0);
    const pairedCount = Number(nextFields[`${pairedField}Count`] ?? 0);
    nextFields[completeField] = pairedCount > 0 && (count >= pairedCount || nextFields[`${listField}NoMore`] === true);
  }

  return {
    fields: nextFields,
    responseCategory: typeof input.patientInput.value === "boolean" ? (input.patientInput.value ? "affirmative" : "negative") : Array.isArray(input.patientInput.value) ? "selection" : "text",
    emotionalState: lowered.includes("anxious") || lowered.includes("anxiety") ? "anxious" : lowered.includes("relief") ? "relieved" : lowered.includes("good") ? "stable" : undefined,
    activityCompletion: input.patientInput.kind === "activity_completion" ? (String(input.patientInput.value) as StateExtractionResult["activityCompletion"]) : input.currentContext.activityCompletion,
    homeworkStatus: input.patientInput.kind === "homework_status" ? (String(input.patientInput.value) as StateExtractionResult["homeworkStatus"]) : input.currentContext.homeworkStatus,
    riskLevel,
    riskSignals: isAmbiguousRiskMention ? ["ambiguous_safety_language", ...riskSignals] : riskSignals,
    confidence: 0.92,
    missingFields: riskSignals.length ? [] : missingExpectedFields,
  };
}

export function mergeExtractedRuntimeContext(context: RuntimeContext, extracted: StateExtractionResult): RuntimeContext {
  return {
    ...context,
    fields: extracted.fields,
    responseCategory: extracted.responseCategory,
    emotionalState: extracted.emotionalState,
    activityCompletion: extracted.activityCompletion ?? context.activityCompletion,
    homeworkStatus: extracted.homeworkStatus ?? context.homeworkStatus,
    riskLevel: extracted.riskLevel,
    riskSignals: extracted.riskSignals,
  };
}
