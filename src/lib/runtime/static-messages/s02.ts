import type { PromptItem } from "@/lib/protocol/source-fidelity-types";
import { ratingNumbers, reflectThenAskForNextRating } from "@/lib/runtime/static-messages/field-helpers";

const APPROVED_TEXT: Record<string, string> = {
  "tbct-s02-n03-p01-offer-private-placeholders": "Before we rate your problems, some people have something private they'd rather not describe in detail. If that's true for you, you don't have to explain it — you can just call it X, Y, or Z instead, and we'll still rate it. Would you like to add a problem like that?",
  // six-anchor-problem-scale, discomfort-distress-distinction and
  // six-anchor-goal-scale moved to computed branches in resolveStaticText
  // below (CCPH/CCGH scale UX pass) -- their wording now depends on runtime
  // state (problemScaleCardAvailable/goalScaleCardAvailable), which a static
  // string can't express.
  "tbct-s02-n11-p01-thanks": "Thank you for mapping these problems and goals with me today.",
  // §7.3, P0-07B (정적분석 리포트): "your therapist" assumed a role Arm 3
  // (AI-Only) participants don't have -- EN and KO had drifted to different
  // meanings (KO was already neutral, EN wasn't). Neutralized to match.
  "tbct-s02-n11-p03-final-score-summary": "These ratings give you a starting point for focusing on what matters most and tracking change over time.",
  // §5.4 [교체]: was "That's good to hear" -- reads a low score as a grade
  // ("good"), which the manual explicitly rejects ("no good or bad total").
  // Neutral acknowledgement instead.
  "tbct-s02-n05-p03-acknowledge-manageable": "Thank you for telling me how that feels for you right now.",
};

const SCALE_COLORS_KO = ["연한 파란색", "진한 파란색", "연한 초록색", "진한 초록색", "노란색", "빨간색"];
const SCALE_COLORS_EN = ["light blue", "dark blue", "light green", "dark green", "yellow", "red"];
function colorForScoreKo(score: number) {
  return SCALE_COLORS_KO[score] ?? "";
}
function colorForScoreEn(score: number) {
  return SCALE_COLORS_EN[score] ?? "";
}
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// P1-1: "2랑 3 사이 같아요" / "2인지 3인지 모르겠어요" -- names the two candidate
// scores/colors back to the participant instead of silently recording the
// first number that happened to appear, and instead of asking about the
// NEXT item the way reflectThenAskForNextRating(Ko) would (the ratings array
// hasn't grown this turn, so that composer would otherwise just repeat the
// SAME "rate the next item" question with no acknowledgement of the
// uncertainty at all -- runtime-context.ts's currentProblemScoreUncertain/
// currentGoalScoreUncertain flag and the paired *UncertainRange are what
// this branches on).
function composeScoreUncertaintyClarification(input: { listField: unknown; ratingsField: unknown; range: unknown; isKorean: boolean }) {
  const list = stringList(input.listField);
  const ratings = ratingNumbers(input.ratingsField);
  const item = list[ratings.length];
  const range = Array.isArray(input.range) && input.range.length === 2 ? (input.range as [number, number]) : null;
  if (!range) {
    return input.isKorean ? "지금은 어느 점수가 더 가깝게 느껴지세요?" : "Which score feels closer to how it is for you right now?";
  }
  const [a, b] = range;
  return input.isKorean
    ? `${item ? `"${item}"이(가) ` : ""}${a}점(${colorForScoreKo(a)})에 더 가까우신가요, 아니면 ${b}점(${colorForScoreKo(b)})에 더 가까우신가요? 지금 느끼시는 것에 더 맞는 쪽을 골라 주세요.`
    : `${item ? `For "${item}", ` : ""}does it feel closer to a ${a} (${colorForScoreEn(a)}) or a ${b} (${colorForScoreEn(b)})? Pick whichever feels truer to how it is for you right now.`;
}

// Korean-language equivalent of runtime-static-message.ts's
// reflectThenAskForNextRating, which is English-only (its sentence
// structure is hardcoded, not just its words) -- that shared helper can't
// be edited from this file, so this local copy exists for the Korean
// branch. Mirrors the same list/ratings-pointer logic (§7.1).
function reflectThenAskForNextRatingKo(input: { listField: unknown; ratingsField: unknown; askVerb: string }) {
  const list = stringList(input.listField);
  const ratings = ratingNumbers(input.ratingsField);
  const parts: string[] = [];
  if (ratings.length > 0 && list[ratings.length - 1]) {
    const score = ratings[ratings.length - 1];
    parts.push(`감사합니다. ${list[ratings.length - 1]}은(는) 지금 ${score}점 — ${colorForScoreKo(score)} — 이시군요.`);
  }
  const next = list[ratings.length];
  if (next) parts.push(`${input.askVerb} ${next}에 대해서는 어떻게 평가하시겠어요?`);
  return parts.join(" ") || undefined;
}

function continueAfterRatingCorrection(input: {
  listField: unknown;
  ratingsField: unknown;
  askVerb: string;
  isKorean: boolean;
}) {
  const list = stringList(input.listField);
  const ratings = ratingNumbers(input.ratingsField);
  const next = list[ratings.length];
  if (!next) return undefined;
  return input.isKorean
    ? `알겠습니다. 말씀하신 항목은 평가 목록에서 제외했어요. ${input.askVerb} ${next}에 대해서는 어떻게 평가하시겠어요?`
    : `Understood — I removed that item from the rating list. ${input.askVerb} ${next}?`;
}

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown>, locale?: string): string | undefined {
  const isKorean = (locale ?? "").toLowerCase().startsWith("ko");

  if (promptItem.id === "tbct-s02-n02-p06-problem-confirmation") {
    if (fields.problemsDuplicate === true) {
      return isKorean
        ? "이미 목록에 있는 내용이라 중복으로 추가하지는 않았어요. 기존 문제 항목은 그대로 유지할게요."
        : "That is already on the list, so I did not add it twice. I'll keep the existing problem entry as it is.";
    }
    return isKorean ? "알겠습니다 — 목록에 추가할게요." : "Got it — I'll add that to the list.";
  }
  if (promptItem.id === "tbct-s02-n07-p07-goal-confirmation") {
    if (fields.goalsDuplicate === true) {
      return isKorean
        ? "이미 목록에 있는 내용이라 중복으로 추가하지는 않았어요. 기존 목표 항목은 그대로 유지할게요."
        : "That is already on the list, so I did not add it twice. I'll keep the existing goal entry as it is.";
    }
    return isKorean ? "정말 멋진 목표네요 — 추가해 드릴게요." : "That's a wonderful goal — I'll add that.";
  }

  // CCPH scale UX pass: the participant must actually understand the 0-5
  // scale before rating starts, not just have the anchor text technically
  // exist somewhere in the codebase (see .claude/TASK_SCOPE.json's
  // note2026_08_17g entry for the full brief). Moved from the static
  // APPROVED_TEXT/koreanText maps to a computed branch here because the
  // wording now depends on runtime state: whether the participant has the
  // physical rating card (problemScaleCardAvailable), so "no card" doesn't
  // block the session -- Claude/the deterministic fallback offers to walk
  // through the scale verbally instead of silently moving on.
  if (promptItem.id === "tbct-s02-n04-p02-six-anchor-problem-scale") {
    const noCard = fields.problemScaleCardAvailable === false;
    const noCardPrefixKo = noCard ? "카드가 없어도 괜찮아요. 제가 지금 기준을 하나씩 설명해 드릴게요.\n\n" : "";
    // English quality parity: this branch used to be verbose enough (~730-800
    // chars) to fail runtime-release-normalizer.ts's isPatientSafeFallbackText
    // 600-char cap -- the crucial six-anchor scale explanation was silently
    // replaced by the content-free generic locale line (defaultFallbackPatientText)
    // on EVERY English CCPH turn, while Korean's denser Hangul phrasing (446
    // chars) always passed. Found via a real (non-Claude, deterministic-fallback)
    // English session run that showed the generic line instead of the scale.
    // Trimmed to keep the same 6 anchors/meaning within budget with margin.
    const noCardPrefixEn = noCard ? "That's fine -- I'll walk you through it.\n\n" : "";
    return isKorean
      ? `${noCardPrefixKo}이제 말씀해 주신 문제들을 하나씩 0점에서 5점까지 평가해 볼게요. 이 점수는 잘하고 못하고를 평가하는 점수가 아니라, 지금 그 문제가 얼마나 불편하고 해결하기 어렵게 느껴지는지를 보여주는 표시예요. 각 숫자에는 알아보기 쉽게 색상이 함께 붙어 있어요. 숫자로 말씀하셔도 되고, 색상으로 말씀하셔도 괜찮아요.\n\n0점, 연한 파란색: 문제가 아주 작거나, 이미 해결되어 더 이상 문제가 아닌 상태예요.\n1점, 진한 파란색: 불편하기는 하지만 비교적 해결하기 쉬운 상태예요.\n2점, 연한 초록색: 분명한 불편감이 있고 해결하기도 쉽지 않은 상태예요.\n3점, 진한 초록색: 불편감이 크고 해결하기도 매우 어렵게 느껴지는 상태예요.\n4점, 노란색: 단순한 불편함을 넘어 상당히 괴롭고, 해결하기도 매우 어렵게 느껴지는 상태예요.\n5점, 빨간색: 너무 괴로워서 지금은 해결 방법이 잘 보이지 않는 상태예요.`
      : `${noCardPrefixEn}Let's rate each problem, one at a time, from 0 to 5. This is not a test -- it shows how hard the problem feels to deal with right now. Each number has a color, so answer with either.\n\n0, light blue: very small, or not a problem anymore.\n1, dark blue: uncomfortable, but fairly easy to solve.\n2, light green: clearly uncomfortable, not easy to solve.\n3, dark green: a lot of discomfort, very hard to solve.\n4, yellow: quite distressing and very hard to solve.\n5, red: so distressing you cannot see a way to solve it now.`;
  }
  if (promptItem.id === "tbct-s02-n04-p03-discomfort-distress-distinction") {
    return isKorean
      ? "간단히 나누면, 0~3점의 파란색·초록색은 불편하지만 아직 감당할 수 있는 범위이고, 4~5점의 노란색·빨간색은 괴로움이 훨씬 크게 느껴지는 범위예요. 노란색이나 빨간색이라고 해서 잘못된 점수라는 뜻은 아니에요 — 지금 어디에 있는지를 알아보기 위한 표시입니다.\n\n이 기준이 대략 이해되시나요? 헷갈리는 부분이 있으면 제가 다시 쉽게 설명해 드릴게요."
      : "To put it simply: 0 to 3 (blue and green) means it's uncomfortable but still manageable. 4 and 5 (yellow and red) mean it feels like much more than that. Being at yellow or red doesn't mean anything is wrong with your answer -- it's just showing where things stand right now.\n\nDoes this make general sense so far? If anything is confusing, just let me know and I'll explain it again more simply.";
  }
  if (promptItem.id === "tbct-s02-n08-p02-six-anchor-goal-scale") {
    const noCard = fields.goalScaleCardAvailable === false;
    const noCardPrefixKo = noCard ? "카드가 없어도 괜찮아요. 제가 지금 기준을 하나씩 설명해 드릴게요.\n\n" : "";
    // English quality parity: same 600-char safety-cap overflow bug as the
    // problem-scale branch above (was ~660-730 chars) -- see that branch's
    // comment for the full explanation.
    const noCardPrefixEn = noCard ? "That's fine -- I'll walk you through it.\n\n" : "";
    return isKorean
      ? `${noCardPrefixKo}이제 목표들도 같은 0~5 색상 체계로 평가해 볼게요. 색상은 앞에서와 같지만 이번에는 의미가 조금 달라요. 문제가 얼마나 힘든지를 평가하는 게 아니라, 이 목표를 이루는 것이 지금 얼마나 어렵거나 부담스럽게 느껴지는지를 평가합니다.\n\n0점, 연한 파란색: 쉽고 편안하게 이룰 수 있거나 이미 이룬 목표예요.\n1점, 진한 파란색: 아주 쉽지는 않지만 비교적 접근할 수 있는 목표예요.\n2점, 연한 초록색: 이루기가 어렵거나 불편하게 느껴지는 목표예요.\n3점, 진한 초록색: 이루기가 매우 어렵거나 불편하게 느껴지는 목표예요.\n4점, 노란색: 이루는 과정이 괴롭고 정말 어렵게 느껴지는 목표예요.\n5점, 빨간색: 너무 괴롭게 느껴져 지금은 시도하는 것조차 상상하기 어려운 목표예요.`
      : `${noCardPrefixEn}Let's rate your goals on the same 0-to-5 color scale. Same colors, different meaning -- not how uncomfortable a problem feels, but how hard the goal feels to reach right now.\n\n0, light blue: easy and comfortable, or already achieved.\n1, dark blue: not especially easy, but manageable.\n2, light green: difficult or uncomfortable to achieve.\n3, dark green: very difficult or uncomfortable to achieve.\n4, yellow: pursuing it feels distressing and hard.\n5, red: so distressing it is hard to even imagine trying.`;
  }

  // §5.4 [구현 구체화]: totals used to be computed unconditionally, so
  // rating only 1 of 3 listed problems/goals still produced a confident
  // "your total is X" sentence. Now gated on every listed item actually
  // having a rating, and (§Appendix A-6) always includes the "not a grade,
  // no good or bad total" baseline framing from the manual.
  if (promptItem.id === "tbct-s02-n06-p01-problem-total") {
    const items = stringList(fields.problems);
    const ratings = ratingNumbers(fields.problemRatings);
    if (items.length === 0 || items.length !== ratings.length) return undefined;
    const total = ratings.reduce((sum, value) => sum + value, 0);
    const priority = ratings.filter((value) => value >= 4).length;
    return isKorean
      ? `오늘 문제 총점은 ${total}점이에요. 그중 ${priority}개가 노란색이나 빨간색 범위에 있고, 보통 치료가 가장 의미 있게 작용하는 부분이 바로 거기예요. 이 숫자는 성적이 아니고, 좋은 총점이나 나쁜 총점이라는 것도 없어요. 오늘의 상태를 담은 스냅샷이자, 앞으로 변화를 재어 볼 출발점입니다.`
      : `Your total problem score today is ${total}. ${priority} of them are in the yellow or red range — those are where therapy usually does its most valuable work. This number isn't a grade, and there's no good or bad total. It's a snapshot of where things stand today, and the starting point you'll measure your progress from.`;
  }
  if (promptItem.id === "tbct-s02-n10-p01-goal-total") {
    const items = stringList(fields.goals);
    const ratings = ratingNumbers(fields.goalRatings);
    if (items.length === 0 || items.length !== ratings.length) return undefined;
    const total = ratings.reduce((sum, value) => sum + value, 0);
    const priority = ratings.filter((value) => value >= 4).length;
    return isKorean
      ? `오늘 목표 총점은 ${total}점이에요. 그중 ${priority}개가 노란색이나 빨간색 범위에 있어요. 이 숫자도 성적이 아니고, 좋은 총점이나 나쁜 총점이라는 것도 없어요. 오늘의 상태를 담은 스냅샷이자, 앞으로 변화를 재어 볼 출발점입니다.`
      : `Your total goals score today is ${total}. ${priority} of them are in the yellow or red range. This number isn't a grade either, and there's no good or bad total — it's today's snapshot and the starting point you'll measure your progress from.`;
  }
  if (promptItem.id === "tbct-s02-n11-p02-recorded-summary") {
    const problemRatings = ratingNumbers(fields.problemRatings);
    const goalRatings = ratingNumbers(fields.goalRatings);
    const problemTotal = problemRatings.reduce((sum, value) => sum + value, 0);
    const goalTotal = goalRatings.reduce((sum, value) => sum + value, 0);
    return isKorean
      ? `평가 내용이 기록되었어요. 문제 총점은 ${problemTotal}점, 목표 총점은 ${goalTotal}점이에요. 앞으로의 평가와 비교해서 변화를 살펴볼 수 있어요.`
      : `Your ratings have been recorded. Your total problem score is ${problemTotal}, and your total goals score is ${goalTotal}. These can be compared with future ratings to track change.`;
  }
  if (promptItem.id === "tbct-s02-n05-p01-reflect-problem-score") {
    if (fields.currentProblemScoreUncertain === true) {
      return composeScoreUncertaintyClarification({ listField: fields.problems, ratingsField: fields.problemRatings, range: fields.currentProblemScoreUncertainRange, isKorean });
    }
    if (fields.problemRatingCorrectionApplied === true) {
      return continueAfterRatingCorrection({
        listField: fields.problems,
        ratingsField: fields.problemRatings,
        askVerb: isKorean ? "같은 0에서 5까지의 색상 척도로" : "Using the same 0 to 5 color scale, how would you rate",
        isKorean,
      });
    }
    return isKorean
      ? reflectThenAskForNextRatingKo({ listField: fields.problems, ratingsField: fields.problemRatings, askVerb: "같은 0에서 5까지의 색상 척도로" })
      : reflectThenAskForNextRating({ listField: fields.problems, ratingsField: fields.problemRatings, askVerb: "Using the same 0 to 5 color scale, how would you rate" });
  }
  if (promptItem.id === "tbct-s02-n09-p01-reflect-goal-score") {
    if (fields.currentGoalScoreUncertain === true) {
      return composeScoreUncertaintyClarification({ listField: fields.goals, ratingsField: fields.goalRatings, range: fields.currentGoalScoreUncertainRange, isKorean });
    }
    if (fields.goalRatingCorrectionApplied === true) {
      return continueAfterRatingCorrection({
        listField: fields.goals,
        ratingsField: fields.goalRatings,
        askVerb: isKorean ? "지금 이 목표를 추구하는 것이 얼마나 어렵거나 힘들게 느껴지시나요 —" : "Right now, how difficult or distressing does it feel to pursue",
        isKorean,
      });
    }
    // §5.2 부수 수정: askVerb no longer claims "the same scale" (CCGH's
    // anchors differ from CCPH's, only the colors repeat).
    return isKorean
      ? reflectThenAskForNextRatingKo({ listField: fields.goals, ratingsField: fields.goalRatings, askVerb: "지금 이 목표를 추구하는 것이 얼마나 어렵거나 힘들게 느껴지시나요 —" })
      : reflectThenAskForNextRating({ listField: fields.goals, ratingsField: fields.goalRatings, askVerb: "Right now, how difficult or distressing does it feel to pursue" });
  }
  return APPROVED_TEXT[promptItem.id];
}

export const koreanText: Record<string, string> = {
  "tbct-s02-n03-p01-offer-private-placeholders": "문제를 평가하기 전에, 어떤 분들은 자세히 이야기하고 싶지 않은 개인적인 문제가 있을 수 있어요. 그런 경우라면 자세히 설명하지 않아도 괜찮아요 — 그냥 X, Y, Z라고 부르셔도 되고, 그래도 함께 평가할 수 있어요. 그런 문제를 추가하시고 싶으신가요?",
  // six-anchor-problem-scale, discomfort-distress-distinction and
  // six-anchor-goal-scale moved to computed branches in resolveStaticText
  // above -- see the comment there.
  "tbct-s02-n11-p01-thanks": "오늘 함께 문제와 목표를 정리해 주셔서 감사해요.",
  "tbct-s02-n11-p03-final-score-summary": "이 점수들은 무엇이 가장 중요한지 파악하고 시간에 따른 변화를 추적할 수 있는 시작점이 되어줄 거예요.",
  "tbct-s02-n05-p03-acknowledge-manageable": "지금 그렇게 느끼신다는 걸 말씀해 주셔서 감사해요.",
  "tbct-s02-n07-p08-goal-dream-small-step": "이 목록에서 지금 당장 손이 닿는 것이라기보다 먼 꿈처럼 느껴지는 게 있다면, 그쪽으로 움직이기 위해 지금 할 수 있는 작은 일 하나는 무엇일까요?",

  // 세션로그 §9-2/§12-2/§12-3 [P0/P1]: opening(4) + elicit-problems(7) +
  // hidden-problems(2) + problem-scale(1) + rate-problems(2) +
  // problem-summary(2) + elicit-goals(7) + goal-scale(1) + rate-goals(2) +
  // goal-summary(1) = 29건, 노드 단위로 verbatim 복원.
  "tbct-s02-n01-p01-first-session-opening": "안녕하세요! 요즘 마음에 걸리는 것들 — 어려움도, 이루고 싶은 목표도 — 함께 정리해 보려고 왔어요. 여기엔 맞고 틀린 답이 없어요. 지금 가장 진솔하게 느껴지는 걸 말씀해 주시면 됩니다.",
  "tbct-s02-n01-p02-returning-opening": "다시 만나서 반가워요. 오늘 시작하기 전에 하나 확인하고 싶은데요 — 지난 세션 이후로 계속 마음에 남아 있는 게 있으신가요? 이어서 다루고 싶은 이야기나, 다시 짚어보고 싶은 게 있다면요.",
  "tbct-s02-n01-p03-between-session-bridge": "그거 어떠셨어요? 한 주 동안 실제로 써 보실 수 있었나요, 그리고 뭔가 달라진 게 있었을까요?",
  "tbct-s02-n01-p04-assessment-transition": "그 말씀 들으니 좋네요. 이제 오늘 상황이 어떤지 함께 살펴볼게요 — 지금 겪고 계신 어려움과, 향해 가고 계신 목표 둘 다요.",
  "tbct-s02-n02-p01-problem-framing": "앞으로 대여섯 달 동안 함께 치료를 해 나간다고 할 때, 그걸 해결하면 한결 나아지겠다 싶은 가장 중요한 문제나 어려움 다섯 가지는 무엇일까요? 무엇으로부터 숨을 좀 돌리고 싶으신가요? 무엇에서 자유로워지고 싶으신가요?",
  "tbct-s02-n02-p02-problem-home-work-relationships": "집이나 직장, 또는 인간관계에서 마음에 계속 걸리는 일이 있으신가요?",
  "tbct-s02-n02-p03-problem-avoidance": "요즘 계속 피하고 있거나 걱정하고 있는 일이 있으신가요?",
  "tbct-s02-n02-p04-problem-therapy-goal": "무엇 때문에 치료를 받으러 오셨나요, 또는 가장 바꾸고 싶은 게 무엇인가요?",
  "tbct-s02-n02-p05-problem-forward-importance": "지금 가장 힘들게 하는 것, 그리고 해결되면 정말 달라질 것 같은 일들을 떠올려 보세요.",
  // problem-confirmation is resolved dynamically above so it can distinguish
  // a newly added item from a duplicate that the runtime deliberately kept out.
  "tbct-s02-n02-p07-problem-reframe": "그거 정말 힘드셨겠어요. 좀 더 도움이 되는 방식으로 정리해 볼까요 — '[situation]에 어떻게 대처하고 있는지'로 표현해 보면 어떨까요? 그러면 상황 자체는 통제할 수 없더라도, 그 안에서 본인의 여정을 계속 추적해 나갈 수 있어요. 이렇게 느껴지시나요?",
  "tbct-s02-n03-p02-acknowledge-private-placeholder": "그런 게 있다는 걸 알려주셔서 감사해요. 그것도 용기가 필요한 일이에요. 다른 것들과 함께 계속 추적해 나갈 거고, 준비되셨을 때 — 혹은 끝내 그럴 필요가 없으시더라도 — 더 이야기하고 싶으시면 언제든 그렇게 하시면 됩니다.",
  "tbct-s02-n03-p03-continue-without-placeholder": "네, 그럼요 — 괜찮습니다. 그럼 계속 진행할게요.",
  "tbct-s02-n04-p01-rating-card-check": "지금 평가 척도 카드를 가지고 계신가요?",
  "tbct-s02-n05-p02-acknowledge-distress": "그거 정말 힘드셨겠어요. 말씀해 주셔서 감사해요. 그런 부분들이 바로 우리가 집중해서 다뤄야 할 지점이에요.",
  "tbct-s02-n05-p04-score-clarification": "[description of lower score] 쪽에 가깝다고 느끼시는지, 아니면 [description of higher score] 쪽에 가깝다고 느끼시는지 — 지금은 어느 쪽이 더 맞는 것 같으세요?",
  "tbct-s02-n06-p02-problem-total-personal": "이 숫자는 지금 본인이 어디에 있는지를 그대로 보여주는, 아주 개인적인 숫자예요. 맞고 틀린 총점은 없습니다. 중요한 건 이 점수를 시간에 따라 계속 추적해 나가는 거고, 치료가 진행되면서 이 숫자가 달라지는 걸 보시게 될 거예요. 이 점수와 함께 보는 색상 그래프를 통해 빨간색·노란색이 초록색·파란색 쪽으로 옮겨가는 걸 확인하실 수 있어요.",
  "tbct-s02-n06-p03-transition-to-goals": "정말 잘해 주셨어요. 이제 반대편도 살펴볼게요 — 앞으로 이루고 싶은 것들이요. 목표를 생각하는 게 문제를 생각하는 것만큼이나 어렵게 느껴질 때도 있는데, 그것도 아주 자연스러운 거예요.",
  "tbct-s02-n07-p01-goal-framing": "앞으로 대여섯 달 동안 치료가 정말 잘 진행된다면, 이루고 싶은 가장 중요한 목표나 바람 다섯 가지는 무엇일까요? 무엇이 있으면 더 충만하고, 더 건강하고, 더 행복하게 느껴지실까요?",
  "tbct-s02-n07-p02-goal-life-change": "치료가 정말 잘 진행된다면, 삶에서 무엇이 달라져 있을까요?",
  "tbct-s02-n07-p03-goal-difficult-action": "너무 어렵거나 두려워서 시도하지 못했지만, 해보고 싶었던 일이 있으신가요?",
  "tbct-s02-n07-p04-goal-freedom": "무엇이 있으면 좀 더 편안하고, 좀 더 본인다우며, 좀 더 자유롭게 느껴지실까요?",
  "tbct-s02-n07-p05-goal-dream": "오랫동안 하고 싶었거나 되고 싶었던 것 — 장기적인 꿈이라도 — 본인에게 중요하게 느껴지는 게 있으신가요?",
  "tbct-s02-n07-p06-goal-overlap": "그건 우리 목록에 넣어야 할 문제이기도 하고, 목표이기도 한 것 같네요. 둘 다에 추가해 드릴까요?",
  // goal-confirmation is likewise dynamic; a fixed Korean entry here would
  // overwrite its duplicate-aware text in resolvePromptLocaleText.
  "tbct-s02-n08-p01-goal-rating-card-check": "아직 평가 카드를 가지고 계신가요?",
  "tbct-s02-n09-p02-acknowledge-difficult-goal": "지금은 멀게 느껴지더라도, 정말 의미 있는 목표네요. 이런 목표들이야말로 치료를 통해 풀리는 경우가 많아요.",
  "tbct-s02-n09-p03-acknowledge-achieved-goal": "훌륭해요 — 이미 이걸 이루며 살고 계신 것 같네요!",
  "tbct-s02-n09-p04-goal-score-clarification": "[description of lower score] 쪽에 가깝다고 느끼시는지, 아니면 [description of higher score] 쪽에 가깝다고 느끼시는지 — 지금은 어느 쪽이 더 맞는 것 같으세요?",
  "tbct-s02-n10-p02-goal-total-personal": "문제 점수와 마찬가지로, 이것도 아주 개인적인 숫자이고 목표를 향해 나아가면서 계속 달라질 거예요. 점수와 함께 보는 그래프를 통해 이런 변화를 시각적으로 확인하실 수 있어요.",
};

// P1-3: same phase-preserving fallback pattern as static-messages/s01.ts's
// resolveRepeatedFallbackText. Without this, runtime-orchestrator.ts's
// generic repeatedFallback override ("share one specific moment when it felt
// strongest") could replace an S02 problem/goal/rating question with an
// unrelated personal-example prompt after three identical fallback turns.
// The highest-traffic constructs (problem, goal, rating) get a hand-tuned,
// construct-preserving rephrase; every other S02 prompt falls back to the
// same "let's try that more simply" prefix in front of its OWN
// already-approved text, so it can never drift onto a different construct.
const REPEATED_FALLBACK_REPHRASE: Record<string, { en: string; ko: string }> = {
  "tbct-s02-n02-p01-problem-framing": {
    en: "No need to list several -- just one difficulty or problem that's been on your mind lately is enough to start with.",
    ko: "여러 개를 한 번에 말씀하지 않으셔도 괜찮아요 -- 요즘 마음에 걸리는 어려움이나 문제 하나만 먼저 말씀해 주세요.",
  },
  "tbct-s02-n07-p01-goal-framing": {
    en: "Just one goal is enough for now -- something you'd like therapy to help you move toward.",
    ko: "지금은 목표 하나면 충분해요 -- 치료를 통해 이루고 싶은 것 하나를 말씀해 주세요.",
  },
  "tbct-s02-n05-p01-reflect-problem-score": {
    en: "Just a number from 0 to 5 (or the matching color) for this one problem is all I need right now.",
    ko: "지금은 이 문제 하나에 대해 0에서 5 사이의 숫자나, 거기에 맞는 색으로만 답해 주시면 돼요.",
  },
  "tbct-s02-n09-p01-reflect-goal-score": {
    en: "Just a number from 0 to 5 (or the matching color) for this one goal is all I need right now.",
    ko: "지금은 이 목표 하나에 대해 0에서 5 사이의 숫자나, 거기에 맞는 색으로만 답해 주시면 돼요.",
  },
};

export function resolveRepeatedFallbackText(input: { promptItemId: string; approvedPatientText: string; locale?: string }): string {
  const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
  const specific = REPEATED_FALLBACK_REPHRASE[input.promptItemId];
  if (specific) return isKorean ? specific.ko : specific.en;
  return isKorean ? `조금 더 간단하게 다시 여쭤볼게요. ${input.approvedPatientText}` : `Let's take that a little more simply. ${input.approvedPatientText}`;
}
