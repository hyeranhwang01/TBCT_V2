import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { StateExtractionResult } from "@/types/runtime-session";
import { avoidTermsFrom, generateS01Scene } from "@/patient/sessions/s01/generation";

// S01 redesign turn rules (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign).
// submitPatientInput calls applyS01TurnRules once per S01 patient turn, right
// after extractRuntimeState and before the worksheet projection, so whatever
// is written here is seen by the same turn's activation conditions, the
// worksheet and the commit. Rules are keyed by prompt SLUG, never by the
// positional prompt id, so reordering S01 nodes cannot silently break them.
// Risk level and risk signals are never touched: a turn that carries any risk
// signal is returned unchanged. Participant content stays the participant's
// own words -- the only system-written values are flags, the three-person
// scene and its hints, and the emotions given to persons 2 and 3.

export type S01TurnRulesInput = {
  extracted: StateExtractionResult;
  promptItem: PromptItem;
  rawText: string;
  locale: string;
  sessionId: string;
  turnId: string;
};
export type S01TurnRulesLog = { summary: string; output: Record<string, unknown> };
export type S01TurnRulesOutput = { extracted: StateExtractionResult; logs: S01TurnRulesLog[] };

export function s01PromptSlug(promptItemId: string): string | null {
  const match = /^tbct-s01-n\d+-p\d+-(.+)$/.exec(promptItemId);
  return match ? match[1] : null;
}

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/^[.,!?~…'"`]+|[.,!?~…'"`]+$/g, "").trim();
}

const YES = new Set([
  "네", "예", "응", "어", "넵", "네네", "그래요", "그렇죠", "그럼요", "맞아요", "네 맞아요", "맞습니다", "좋아요", "네 좋아요",
  "할게요", "네 할게요", "해볼게요", "해 볼게요", "네 해볼게요", "할 수 있어요", "할 수 있을 것 같아요", "가능해요", "가능할 것 같아요",
  "보여요", "네 보여요", "이해돼요", "이해가 돼요", "알겠어요", "네 알겠어요", "같아요", "같았어요", "비슷해요",
  "yes", "yeah", "yep", "sure", "ok", "okay", "i can", "i will", "i see", "i see it", "got it", "same",
  // Korean chat shorthand a participant actually types (2026-09-13 live
  // session). A bare "ㄴ" is deliberately NOT here: it reads as either the
  // first letter of "네" (yes) or as "노" (no), so it stays unrecognized and
  // gets a plain yes/no re-ask instead of being guessed at.
  "ㅇ", "ㅇㅇ", "ㅇㅋ",
]);
const NO = new Set([
  "아니요", "아뇨", "아니", "아니에요", "아닌 것 같아요", "달라요", "달랐어요", "다를 것 같아요", "다르게 생각했을 것 같아요", "안 보여요", "잘 안 보여요",
  "no", "nope", "not really", "different",
  "ㄴㄴ",
]);
const STOP = new Set([
  "없어요", "없습니다", "없어", "없음", "없다", "없었어요", "없었습니다", "없었던 것 같아요", "없는 것 같아요", "딱히 없어요", "따로 없어요", "더 없어요", "더는 없어요",
  "아니요", "아뇨", "아니", "그게 다예요", "그게 다에요", "그게 전부예요", "그게 다야", "그뿐이에요",
  "none", "no", "nope", "nothing", "no more", "nothing else", "that's all", "that's it", "that is all",
]);
const STOP_CONTAINS = ["더 이상 없", "더이상 없"];
const UNCERTAIN = new Set([
  "모르겠어요", "잘 모르겠어요", "모르겠다", "모르겠네요", "잘 모르겠네요", "몰라요", "몰라", "모름", "글쎄요", "글쎄",
  "생각이 안 나요", "생각 안 나요", "생각이 안나요", "기억이 안 나요", "기억 안 나요", "떠오르지 않아요", "잘 떠오르지 않아요", "떠오르는 게 없어요",
  "idk", "i don't know", "i dont know", "i do not know", "not sure", "i'm not sure", "im not sure", "no idea", "can't think of anything", "i can't think of anything",
]);

export function isBareYesNo(text: string) {
  const normalized = normalize(text);
  return YES.has(normalized) || NO.has(normalized);
}
function isBareNo(text: string) {
  return NO.has(normalize(text));
}
export function isStopAnswer(text: string) {
  const normalized = normalize(text);
  if (STOP.has(normalized) || STOP_CONTAINS.some((phrase) => normalized.includes(phrase))) return true;
  // "아니요 없습니다" (2026-09-13 live session): a leading no in front of the
  // closer is still a closer. The shared detector matches the whole message
  // exactly, so this combined form fell through and was stored as another
  // difficulty. Only the leading no is stripped -- "아니요 그건 다른 문제예요"
  // still has real content after it and stays a normal answer.
  const withoutLeadingNo = normalized.replace(/^(아니요|아니오|아뇨|아니)\s*[,.]?\s*/, "").trim();
  if (withoutLeadingNo === normalized || !withoutLeadingNo) return false;
  return STOP.has(withoutLeadingNo) || STOP_CONTAINS.some((phrase) => withoutLeadingNo.includes(phrase));
}
export function isUncertainAnswer(text: string) {
  return UNCERTAIN.has(normalize(text));
}

/** A situation/thought answer long enough that the worksheet box needs the
 * participant's own one-line version (user decision 2026-09-12). */
export function isLongAnswer(text: string, locale: string) {
  const trimmed = text.trim();
  const sentences = trimmed.split(/(?<=[.!?。])\s+|\n+/).filter((part) => part.trim().length > 1).length;
  return locale.toLowerCase().startsWith("ko") ? trimmed.length > 40 || sentences >= 2 : trimmed.length > 90 || sentences >= 2;
}

/** "What made the difference?" answered with the emotion rather than the
 * thought -- triggers the follow-up "and what made the emotions differ?". */
export function namesEmotionNotThought(text: string) {
  const korean = /(감정|기분|느낌|마음)/.test(text) && !/(생각|해석|받아들|판단|믿|관점|시각)/.test(text);
  const english = /\b(emotions?|feel|feelings?|mood)\b/i.test(text) && !/\b(thoughts?|think|thinking|interpret\w*|believ\w*|mind|perspective|view)\b/i.test(text);
  return korean || english;
}

const OUTCOME_FINE = /(괜찮았|별일\s*(없|아니)|아무\s*일(도)?\s*(없|안\s*일어)|생각보다\s*(괜찮|잘|나았|별)|잘\s*(됐|되었|끝났|풀렸|넘어갔|해결)|무사히|문제\s*(없|안\s*생)|일어나지\s*않|안\s*일어났|오해였|오해가\s*풀|해결(됐|되었|했))|turned out (fine|ok|okay|well)|nothing (bad )?happened|went (fine|well|ok)|wasn'?t (as|that) bad|didn'?t (actually )?happen|worked out|was resolved|it was fine/i;
const OUTCOME_BAD = /(안\s*괜찮|괜찮지\s*않|망했|최악|실제로\s*(일어났|그렇게\s*됐)|더\s*(나빠|심해|안\s*좋아)|결국\s*(싸웠|틀어졌|망))|went badly|got worse|it did happen|really happened|was worse|fell apart/i;

/** Only a clear "it turned out fine" unlocks "what does it tell you that what
 * you feared didn't happen?"; anything unclear or negative skips it. */
export function fearedOutcomeDidNotHappen(text: string) {
  return OUTCOME_FINE.test(text) && !OUTCOME_BAD.test(text);
}

export function isDistortionSuggestionRequest(text: string) {
  return /(추천|골라\s*주|알려\s*주|어떤\s*게\s*맞|뭐가\s*맞|어느\s*게\s*맞|제안해)/.test(text) || /(suggest|recommend|which (one )?(fits|applies|matches)|pick (one )?for me|tell me which)/i.test(text);
}

const ORDINALS: Record<string, number> = {
  "첫 번째": 0, "첫번째": 0, "첫째": 0, "1번": 0, "1 번": 0, "1번째": 0, "하나": 0, "1": 0, "first": 0, "the first one": 0,
  "두 번째": 1, "두번째": 1, "둘째": 1, "2번": 1, "2 번": 1, "2번째": 1, "둘": 1, "2": 1, "second": 1, "the second one": 1,
  "세 번째": 2, "세번째": 2, "셋째": 2, "3번": 2, "3 번": 2, "3번째": 2, "셋": 2, "3": 2, "third": 2, "the third one": 2,
  "네 번째": 3, "네번째": 3, "넷째": 3, "4번": 3, "4 번": 3, "4번째": 3, "넷": 3, "4": 3, "fourth": 3, "the fourth one": 3,
};
export function parseOrdinal(text: string): number | null {
  const cleaned = normalize(text).replace(/\s*(거|것|꺼)?\s*(이요|요|예요|이에요|입니다|이죠|죠)$/, "").trim();
  return cleaned in ORDINALS ? ORDINALS[cleaned] : null;
}

// Bare yes/no is the whole intended answer here ("함께 해보실 수 있을까요?",
// "이어지는 게 보이세요?", "상황은 같았나요, 달랐나요?" ...), but the engine
// treats a bare "네"/"yes" as a non-answer on free-text prompts.
const BARE_YES_NO_SLUGS = new Set(["practice-commitment", "link-check", "friend-same-thought", "problem-link", "situation-same", "feelings-compared", "actions-compared", "read-a-few", "homework-commitment"]);
const STOP_FLAG_BY_SLUG: Record<string, string> = { "second-emotion": "personalEmotionsNoMore", "third-emotion": "personalEmotionsNoMore", "second-behavior": "personalBehaviorsNoMore" };
// List-shaped prompts need their OWN stop handling: STOP_FLAG_BY_SLUG above
// deletes the target field, and for a list that would throw away every item
// collected so far (mergeExtractedRuntimeContext replaces fields wholesale
// rather than merging them). Here the array is kept and only the closer that
// the shared extractor appended this turn is taken back out.
const LIST_STOP_BY_SLUG: Record<string, { listField: string; flag: string }> = {
  "other-difficulty": { listField: "s01Problems", flag: "s01ProblemsNoMore" },
  "other-difficulty-more": { listField: "s01Problems", flag: "s01ProblemsNoMore" },
};
// "잘 모르겠어요" on these routes to a follow-up that offers examples/a hint
// instead of burning a clarification attempt.
const NEEDS_HELP_FLAG_BY_SLUG: Record<string, string> = {
  "recent-moment": "situationNeedsExamples",
  "first-behavior": "personalBehaviorNeedsExamples",
  "body": "personalBodySensationsNeedsExamples",
  "usual-prevention": "cycleSafetyStrategyNeedsExamples",
  "candidate-two-thought": "candidateTwoThoughtNeedsHint",
  "candidate-three-thought": "candidateThreeThoughtNeedsHint",
};
// The follow-ups themselves: a second "not sure" is accepted as-is so the
// session can never loop on them.
const HELP_PROMPT_SLUGS = new Set(["situation-examples", "behavior-examples", "body-examples", "usual-prevention-hint", "candidate-two-thought-hint", "candidate-three-thought-hint"]);
const HINT_FIELD_BY_SLUG: Record<string, string> = { "candidate-two-thought-hint": "candidateTwoThoughtHint", "candidate-three-thought-hint": "candidateThreeThoughtHint" };
const LINE_FLAG_BY_SLUG: Record<string, string> = { "recent-moment": "situationNeedsLine", "situation-examples": "situationNeedsLine", "thought-behind-emotion": "thoughtNeedsLine" };
const LINE_SKIP_FLAG_BY_SLUG: Record<string, string> = { "write-situation-line": "situationLineSkipped", "write-thought-line": "thoughtLineSkipped" };

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
}

export async function applyS01TurnRules(input: S01TurnRulesInput): Promise<S01TurnRulesOutput> {
  const { extracted, promptItem } = input;
  const unchanged: S01TurnRulesOutput = { extracted, logs: [] };
  if (promptItem.sessionId !== "tbct-s01" || extracted.riskSignals.length > 0) return unchanged;
  const slug = s01PromptSlug(promptItem.id);
  const target = promptItem.outputFields[0];
  if (!slug || !target) return unchanged;

  const fields: Record<string, unknown> = { ...extracted.fields };
  let missing = [...extracted.missingFields];
  const logs: S01TurnRulesLog[] = [];
  const text = input.rawText.trim();
  const isKorean = input.locale.toLowerCase().startsWith("ko");
  const accept = (value?: unknown) => {
    if (value !== undefined) fields[target] = value;
    missing = missing.filter((field) => field !== target);
  };

  if (BARE_YES_NO_SLUGS.has(slug) && isBareYesNo(text)) accept(text);

  const stopFlag = STOP_FLAG_BY_SLUG[slug];
  if (stopFlag && isStopAnswer(text)) {
    delete fields[target];
    fields[stopFlag] = true;
    accept();
  }

  const listStop = LIST_STOP_BY_SLUG[slug];
  if (listStop && isStopAnswer(text)) {
    const list = (Array.isArray(fields[listStop.listField]) ? [...(fields[listStop.listField] as unknown[])] : []).filter((item): item is string => typeof item === "string");
    if (list.length > 0 && normalize(list[list.length - 1]) === normalize(text)) list.pop();
    fields[listStop.listField] = list;
    // Recomputed here because the shared extractor derives the count before
    // this hook runs (runtime-context.ts).
    fields[`${listStop.listField}Count`] = list.length;
    fields[listStop.flag] = true;
    accept();
    // With a single difficulty there is nothing to choose between, so record
    // it as the representative one and let spec.ts skip that question.
    if (list.length === 1 && !hasValue(fields.s01RepresentativeProblem)) {
      fields.s01RepresentativeProblem = list[0];
      fields.s01RepresentativeProblemSource = "only_item";
      fields.s01RepresentativeAuto = true;
    }
    logs.push({ summary: `${slug}: closed the difficulty list (${list.length} kept)`, output: { slug, kept: list.length, representativeAuto: fields.s01RepresentativeAuto === true } });
  }

  const helpFlag = NEEDS_HELP_FLAG_BY_SLUG[slug];
  if (helpFlag && isUncertainAnswer(text)) {
    delete fields[target];
    fields[helpFlag] = true;
    accept();
  }

  if (HELP_PROMPT_SLUGS.has(slug)) {
    const hintField = HINT_FIELD_BY_SLUG[slug];
    const hint = hintField ? fields[hintField] : undefined;
    if (typeof hint === "string" && ((isBareYesNo(text) && !isBareNo(text)) || isUncertainAnswer(text))) {
      accept(hint);
      fields[`${target}Source`] = "accepted_hint";
    } else if (isUncertainAnswer(text)) {
      accept(text);
    }
  }

  const skipFlag = LINE_SKIP_FLAG_BY_SLUG[slug];
  if (skipFlag && isUncertainAnswer(text)) {
    delete fields[target];
    fields[skipFlag] = true;
    accept();
  }

  if (slug === "representative-difficulty") {
    const list = Array.isArray(fields.s01Problems) ? fields.s01Problems.filter((item): item is string => typeof item === "string") : [];
    const index = parseOrdinal(text);
    if (index !== null && index < list.length) {
      accept(list[index]);
      fields.s01RepresentativeProblemSource = "ordinal";
    } else if (list.length === 1 && isBareYesNo(text) && !isBareNo(text)) {
      accept(list[0]);
      fields.s01RepresentativeProblemSource = "only_item";
    }
  }

  if (slug === "identify-distortion" && isDistortionSuggestionRequest(text)) {
    delete fields[target];
    fields.distortionSuggestionRequested = true;
    accept();
  }

  const accepted = !missing.includes(target) && hasValue(fields[target]);
  const lineFlag = LINE_FLAG_BY_SLUG[slug];
  if (lineFlag && accepted) fields[lineFlag] = isLongAnswer(String(fields[target]), input.locale);
  if (slug === "what-made-difference" && accepted) fields.conclusionAnsweredEmotion = namesEmotionNotThought(text);
  if (slug === "what-happened" && accepted) fields.fearedOutcomeDidNotMaterialize = fearedOutcomeDidNotHappen(text);

  if (slug === "short-long-term" && accepted && typeof fields.threePersonScene !== "string") {
    const problems = Array.isArray(fields.s01Problems) ? fields.s01Problems.filter((item): item is string => typeof item === "string").join(" ") : undefined;
    const caseTexts = [fields.situationThoughtDistinction, fields.situationLine, fields.openingInitialThought, fields.thoughtLine, fields.s01RepresentativeProblem, fields.friendThought].map((value) => (typeof value === "string" ? value : undefined));
    const result = await generateS01Scene({ locale: input.locale, avoidTerms: avoidTermsFrom([...caseTexts, problems]) }, { sessionId: input.sessionId, turnId: input.turnId });
    fields.threePersonScene = result.scene;
    fields.candidateTwoThoughtHint = result.hintTwo;
    fields.candidateThreeThoughtHint = result.hintThree;
    fields.candidateTwoEmotion = isKorean ? "의심" : "suspicion";
    fields.candidateThreeEmotion = isKorean ? "화" : "anger";
    fields.threePersonSceneSource = result.source;
    if (result.rejectReason) fields.threePersonSceneRejectReason = result.rejectReason;
    if (result.model) fields.threePersonSceneModel = result.model;
    fields.threePersonSceneGeneratedAt = new Date().toISOString();
    logs.push({
      summary: `S01 three-person scene (${result.source}${result.rejectReason ? `: ${result.rejectReason}` : ""})`,
      output: { kind: "s01_scene", source: result.source, rejectReason: result.rejectReason ?? null, model: result.model ?? null, scene: result.scene, hintTwo: result.hintTwo, hintThree: result.hintThree },
    });
  }

  return { extracted: { ...extracted, fields, missingFields: missing }, logs };
}
