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

/** The empty row: a pattern the participant had no example for. Stored rather
 * than skipped so the pointer stays aligned with the registry and the worksheet
 * shows the pattern as looked at. */
export const NO_EXAMPLE_MARKER = "—";

const BARE_YES_NO_SLUGS = new Set(["today-agenda", "agenda-continue", "homework-commitment"]);

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
    const before = stringList(extracted.fields.distortionExamples);
    const stored = stringList(fields.distortionExamples);
    // "없어요" is a real answer for this pattern -- the row stays empty and the
    // loop moves on. Two shapes have to be handled, because the shared list path
    // decides first and its stop-word set is not the same as ours: either it
    // recognized the phrase and appended nothing, or it did not and appended the
    // phrase itself as though it were an example.
    if (hasNoExampleForPattern(text)) {
      const rows = stored.length > before.length ? [...before, NO_EXAMPLE_MARKER] : [...stored, NO_EXAMPLE_MARKER];
      accept(rows);
      log("no example for this pattern; empty row recorded", { distortionExamples: rows });
    } else if (looksLikeDistortionUnclear(text)) {
      // Not an example: they do not see why this one is a distortion yet. The
      // row is not written and the field stays missing, so the engine treats the
      // turn as a clarification and asks about the same pattern again -- where
      // the step's guidance tells Claude to ask what feels off rather than
      // explain. No flag is set: a turn the engine does not accept never commits
      // its fields, so a flag here would be discarded anyway.
      if (targetField && !missingFields.includes(targetField)) missingFields.push(targetField);
      if (before.length) fields.distortionExamples = before;
      else delete fields.distortionExamples;
      log("participant does not yet see why this pattern is a distortion", { distortionExamples: before });
    }
    const rows = stringList(fields.distortionExamples);
    const done = rows.length >= COGNITIVE_DISTORTIONS.length;
    fields.allDistortionsReviewed = done;
    if (done) log("every pattern has a row; walkthrough complete", { allDistortionsReviewed: true });
  }

  return { extracted: { ...extracted, fields, missingFields }, logs };
}
