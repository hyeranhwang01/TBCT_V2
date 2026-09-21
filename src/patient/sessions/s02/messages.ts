import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";

// S02 deterministic fallback only (.claude/TASK_SCOPE.json
// note2026_09_21_s02_cognitive_distortions). Since the 2026-09-19 task-intent
// change every S02 turn is normally phrased by Claude from
// s02/task-intents.ts; what lives here is what ships when the model call
// cannot be made -- so it has to be correct, but it is not the usual path.
//
// Two rules that bite here:
//  - koreanText[id] WINS over resolveStaticText for ko (resolvePromptLocaleText
//    in runtime-release-normalizer.ts is a flat id -> text map consulted
//    first), so a prompt resolved dynamically below must NOT have a koreanText
//    entry. Only review-distortion is dynamic.
//  - isPatientSafeFallbackText rejects text over 600 characters and any Latin
//    /\bmodels?\b/, replacing the whole message with a content-free line.
//    Korean "인지 모델" is unaffected; English must say "how thoughts work".

const REVIEW_DISTORTION_ID = "tbct-s02-n05-p01-review-distortion";
const HOMEWORK_UPDATE_ID = "tbct-s02-n02-p01-homework-update";
const SCORE_DISTORTION_ID = "tbct-s02-n07-p01-score-distortion";
const TOTAL_ID = "tbct-s02-n08-p01-total";

// After S01, the homework question recalls what the practice actually was and
// how much of it they did -- previousS01HomeworkExampleCount, seeded at session
// creation by shared/runtime/session-continuity.ts. Only the wording changes;
// nothing is written to a field, and with no seed the question is unchanged.
//
// This is composed here in full, question included, rather than prefixed onto a
// koreanText entry: for ko, koreanText[id] wins outright over this function
// (resolvePromptLocaleText), so a prefix added here would silently vanish in
// Korean. The S01 recap that S02 carried before this redesign had exactly that
// defect -- its three prompts all had koreanText entries, so the recap only
// ever appeared in tests that called this function directly.
function homeworkUpdateText(fields: Record<string, unknown>, isKorean: boolean): string {
  const question = isKorean
    ? "한 주 동안 과제는 어떠셨어요? 적어 보신 게 있으신지, 그리고 해 보시니 어떠셨는지 들려주세요."
    : "How did the practice go this week? Were you able to write any examples, and how was it for you?";
  if (fields.previousSessionDefinitionId !== "tbct-s01") return question;
  const count = fields.previousS01HomeworkExampleCount;
  if (typeof count !== "number") return question;
  const recap = isKorean
    ? `지난 시간에 인지 왜곡 목록을 곁에 두고, 그런 생각이 들 때 '내 예시' 칸에 적어 보기로 했었죠.${count > 0 ? ` 지금까지 ${count}개 적어 주셨네요.` : ""}`
    : `Last time, the plan was to keep the list of cognitive distortions nearby and write an example in the 'My examples' column whenever a thought like that came up.${count > 0 ? ` You've written ${count} so far.` : ""}`;
  return `${recap} ${question}`;
}

function storedRowCount(fields: Record<string, unknown>): number {
  return Array.isArray(fields.distortionExamples) ? fields.distortionExamples.length : 0;
}

/** One stored row per pattern, in registry order, so the row count is the index
 * of the pattern being asked about. Same list/pointer arithmetic the rating
 * loops use. */
function currentDistortion(fields: Record<string, unknown>) {
  const index = Math.min(storedRowCount(fields), COGNITIVE_DISTORTIONS.length - 1);
  return { index, distortion: COGNITIVE_DISTORTIONS[index] };
}

/** The walkthrough's fallback text, composed per pattern from the registry so
 * fifteen explanations are data rather than fifteen prompts. */
function composeReviewDistortion(fields: Record<string, unknown>, isKorean: boolean): string {
  // The discussion turn (s02PatternPhase === "discuss") talks about the example
  // just given, so the pattern it is on is the LAST stored row rather than the
  // pointer, which has already moved on.
  if (fields.s02PatternPhase === "discuss") return composeDiscussDistortion(fields, isKorean);
  const { index, distortion } = currentDistortion(fields);
  const ordinal = index + 1;
  if (isKorean) {
    return `${ordinal}번째 유형은 '${distortion.nameKo}'입니다. ${distortion.descriptionKo} 예를 들면 "${distortion.exampleKo[0]}" 같은 생각이에요. 최근에 이런 생각을 하신 적이 있으신가요? 떠오르지 않으면 없다고 말씀해 주셔도 괜찮아요.`;
  }
  return `Pattern ${ordinal} is "${distortion.nameEn[0]}". ${distortion.descriptionEn} For instance: "${distortion.exampleEn[0]}" Have you had a thought like that recently? If nothing comes to mind, it's fine to say so.`;
}

/**
 * Last-resort wording for the discussion turn. It cannot do what the turn is
 * for -- pointing at the part of the participant's own sentence -- because that
 * needs a live model, so it does the one thing a fixed sentence can do without
 * asserting anything about their words: name the pattern, leave the reading to
 * them, and invite agreement or disagreement. That is deliberately weaker than
 * the real turn rather than a confident guess about their example.
 */
function composeDiscussDistortion(fields: Record<string, unknown>, isKorean: boolean): string {
  const stored = Array.isArray(fields.distortionExamples) ? fields.distortionExamples.length : 0;
  const index = Math.max(0, Math.min(stored - 1, COGNITIVE_DISTORTIONS.length - 1));
  const distortion = COGNITIVE_DISTORTIONS[index];
  const name = isKorean ? distortion.nameKo : distortion.nameEn[0];
  // The discussion can run to three turns when the participant keeps adding
  // (s02/turn-rules.ts). One sentence repeated three times reads as a broken
  // program, so each turn has its own -- the same reason
  // REPEATED_FALLBACK_REPHRASE exists, which does not apply here because these
  // turns are all accepted rather than a prompt being stuck.
  const spent = typeof fields.s02PatternDiscussTurns === "number" ? fields.s02PatternDiscussTurns : 0;
  if (isKorean) {
    if (spent >= 2) return `이 부분은 여기까지 보고 다음 유형으로 넘어가 볼게요. '${name}'에 대해 더 덧붙이고 싶은 게 있으세요?`;
    if (spent === 1) return `방금 덧붙여 주신 부분을 조금 더 볼게요. 그때 실제로 있었던 일과, 거기서 내리신 결론을 나눠 보면 어떻게 될까요?`;
    return `말씀해 주신 내용에서 '${name}'가 어디쯤에서 나타나는 것 같으세요? 이 유형은 ${distortion.descriptionKo} 아니라고 느껴지시면 그렇게 말씀해 주셔도 괜찮아요.`;
  }
  if (spent >= 2) return `Let's leave this one here and move to the next pattern. Anything else you want to add about "${name}"?`;
  if (spent === 1) return `Let's stay with what you just added for a moment. If you separate what actually happened from what you concluded from it, how does that look?`;
  return `Where in what you just described do you think "${name}" shows up? This pattern is: ${distortion.descriptionEn} If it doesn't feel like it fits, it's fine to say so.`;
}

/** The scoring question, per pattern. Asks for both halves in one turn -- a
 * repeat_until loop runs one prompt per iteration, so two prompts cannot
 * alternate fifteen times inside one node. */
function composeScoreDistortion(fields: Record<string, unknown>, isKorean: boolean): string {
  const scored = Array.isArray(fields.cdQuestScores) ? fields.cdQuestScores.length : 0;
  const index = Math.min(scored, COGNITIVE_DISTORTIONS.length - 1);
  const distortion = COGNITIVE_DISTORTIONS[index];
  const ordinal = index + 1;
  if (isKorean) {
    return `${ordinal}번째, '${distortion.nameKo}'입니다. 지난 한 주 동안 이런 생각이 얼마나 자주 있었나요 — 한두 번, 3~5일, 아니면 6~7일 정도였을까요? 그리고 그럴 때 그 생각을 얼마나 믿었나요 — 약간(30% 이하), 꽤(31~70%), 아주 강하게(70% 이상) 중에서요.`;
  }
  return `Pattern ${ordinal}, "${distortion.nameEn[0]}". How often did this come up over the past week -- once or twice, three to five days, or six to seven days? And how strongly did you believe it at the time -- a little (up to 30%), quite strongly (31-70%), or very strongly (over 70%)?`;
}

/** The total, spoken not asked. s02/turn-rules.ts wrote cdQuestTotal when the
 * fifteenth score landed. */
function composeTotal(fields: Record<string, unknown>, isKorean: boolean): string {
  const total = typeof fields.cdQuestTotal === "number" ? fields.cdQuestTotal : null;
  const high = typeof fields.cdQuestHighCount === "number" ? fields.cdQuestHighCount : null;
  if (isKorean) {
    const head = total === null ? "점수를 모두 더해 볼게요." : `모두 더하면 ${total}점이에요.`;
    const tail = high && high > 0 ? ` 그중 ${high}개가 4점 이상이고요.` : "";
    return `${head}${tail} 여기에는 정해진 컷오프가 없고, 좋은 총점이나 나쁜 총점도 없어요. 지난 한 주의 모습을 담은 기록이고, 앞으로 변화를 재어 볼 출발점입니다.`;
  }
  const head = total === null ? "Let's add those up." : `Adding those up comes to ${total}.`;
  const tail = high && high > 0 ? ` ${high} of them are at 4 or above.` : "";
  return `${head}${tail} There is no cut-off here and no good or bad total -- it is a record of this past week, and the starting point you'll measure change from.`;
}

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown>, locale?: string): string | undefined {
  const isKorean = (locale ?? "").toLowerCase().startsWith("ko");
  if (promptItem.id === REVIEW_DISTORTION_ID) return composeReviewDistortion(fields, isKorean);
  if (promptItem.id === SCORE_DISTORTION_ID) return composeScoreDistortion(fields, isKorean);
  if (promptItem.id === TOTAL_ID) return composeTotal(fields, isKorean);
  if (promptItem.id === HOMEWORK_UPDATE_ID) return homeworkUpdateText(fields, isKorean);
  return APPROVED_TEXT[promptItem.id];
}

// English fallbacks for the prompts whose spec patientText would otherwise be
// used verbatim. Only the ones that need different wording from the spec live
// here; the rest fall through to patientText.
const APPROVED_TEXT: Record<string, string> = {
  // Never reaches the dialogue agent: a safety prompt ships exactly as written.
  // "your therapist" is avoided -- Arm 3 participants do not have one; the
  // participant manual's own distress box says study clinician.
  "tbct-s02-n11-p01-pause-and-escalate":
    "It sounds like things feel very heavy right now, and that matters more than finishing this exercise. Please pause here and reach out to your study clinician, or your local emergency services, as soon as you can. You don't have to face this alone.",
};

export const koreanText: Record<string, string> = {
  "tbct-s02-n01-p01-greeting-recap":
    "다시 만나 반가워요. 지난 시간에는 어떤 상황이 하나의 생각을 떠올리게 하고, 그 생각이 감정과 행동, 몸의 느낌까지 이어진다는 것을 함께 살펴봤어요. 그리고 마지막에 생각이 왜곡될 수 있는 15가지 패턴을 소개했죠.",

  // homework-update is composed in resolveStaticText above so the S01 homework
  // recap can reach Korean -- a koreanText entry here would override it.
  "tbct-s02-n02-p02-normalize-overlap":
    "그건 대부분의 분들이 겪는 일이고 잘못된 게 아니에요. 15가지 패턴은 서로 겹치는 부분이 있어서, 한 예시가 두세 가지에 동시에 해당될 수도 있어요. 꼭 하나만 골라야 하는 건 아닙니다.",

  "tbct-s02-n03-p01-today-agenda": "오늘은 그 15가지 패턴을 하나씩 살펴보면서, 각각에 해당하는 본인의 예시가 있는지 함께 찾아보려고 해요. 이렇게 진행해도 괜찮으세요?",
  "tbct-s02-n03-p02-agenda-concern": "괜찮아요, 말씀해 주셔서 고맙습니다. 어떤 점이 마음에 걸리시나요? 편하게 말씀해 주세요.",
  "tbct-s02-n03-p03-agenda-continue":
    "말씀해 주셔서 고맙습니다. 오늘은 원하시는 속도로 하시면 되고, 말씀하고 싶은 만큼만 이야기하셔도 되고, 언제든 멈추셔도 괜찮아요. 오늘 세션을 이어서 해 보시겠어요?",
  "tbct-s02-n03-p04-agenda-stop": "네, 오늘은 여기서 멈추겠습니다. 말씀해 주셔서 고맙습니다. 다시 이어서 하고 싶어지실 때 여기서부터 시작하실 수 있어요.",

  "tbct-s02-n04-p01-distortion-concept":
    "우리 머릿속을 지나가는 생각이 다 잘못된 건 아니에요. 그런데 어떤 생각은 도움이 되지 않거나, 균형이 맞지 않거나, 근거가 별로 없기도 해요. 그런 생각을 인지왜곡이라고 부릅니다.",
  "tbct-s02-n04-p02-research-evidence":
    "브라질 바이아 연방대학교에서 대학생 184명을 대상으로 한 연구에서, 이런 생각 패턴이 더 자주, 더 강하게 나타나는 분들은 우울과 불안 점수도 함께 높게 나타났습니다.",
  "tbct-s02-n04-p03-future-use": "이 목록은 나중에 이 생각들 밑에 있는 더 깊은 패턴을 살펴볼 때 다시 쓰이게 됩니다.",

  // review-distortion is composed per pattern in resolveStaticText above -- a
  // fixed Korean entry here would override it for every pattern.

  "tbct-s02-n06-p01-cdquest-explain":
    "이제 15가지 패턴마다 두 가지를 적어볼게요. 먼저 지난 한 주 동안 얼마나 자주 있었는지 — 한두 번, 3~5일, 6~7일 중에서요. 그리고 그럴 때 그 생각을 얼마나 믿었는지 — 약간(30% 이하), 꽤(31~70%), 아주 강하게(70% 이상) 중에서요. 이 둘을 합치면 0점에서 5점까지 점수가 나옵니다.",
  "tbct-s02-n06-p02-understanding-check": "여기까지 이해되셨어요? 헷갈리는 부분이 있으면 다시 설명해 드릴게요.",

  // score-distortion is composed per pattern in resolveStaticText above.

  // total is composed from the stored scores in resolveStaticText above.
  "tbct-s02-n08-p02-how-do-you-feel": "이걸 다 보고 나니 어떤 생각이 드세요?",
  "tbct-s02-n08-p03-innate-vs-learned":
    "우리가 타고나는 부분도 분명히 있고, 그건 우리가 고른 게 아니에요. 그런데 생각하는 습관은 좀 달라요. 태어나면서부터 나를 탓하겠다고 정하고 오는 사람은 없잖아요. 살아오면서 익혀진 것이고, 그래서 바뀔 수 있는 것이기도 해요.",
  "tbct-s02-n09-p01-what-to-adjust": "이 패턴들 중에서 어떤 것을 좀 조정해 보고 싶으세요?",

  "tbct-s02-n10-p01-session-recap":
    "오늘은 이렇게 함께했어요. 먼저 한 주 동안 해 오신 과제를 같이 살펴봤고요. 그다음 생각이 왜곡될 수 있는 15가지 패턴을 하나씩 짚으면서 각각이 어디에서 나타나는지 찾아봤고, 마지막으로 하나하나 얼마나 자주 있었고 얼마나 믿었는지 점수를 매겨 봤어요.",
  "tbct-s02-n10-p02-homework-assignment":
    "이번 주에는 같은 양식을 새로 한 장 채워 보세요. 이런 생각이 들 때마다 '내 예시' 칸에 짧게 적고, 주말에 오늘처럼 패턴마다 점수를 매겨 보시면 됩니다. 다음 시간에 오늘 것과 비교해 볼게요.",
  "tbct-s02-n10-p03-homework-commitment": "할 수 있으시겠어요?",
  "tbct-s02-n10-p04-next-preview":
    "다음 시간에는 한 단계 더 들어가 볼게요. 상황 속에서 스쳐 지나가는 생각이 첫 번째 층이고, 그 아래에는 우리가 지키며 살아가는 가정과 규칙이, 더 아래에는 스스로에 대해 오래 품어 온 믿음이 자리하고 있어요.",
  "tbct-s02-n10-p05-goodbye": "오늘 이야기 나눠 주셔서 고마워요. 다음 시간에 뵐게요.",

  "tbct-s02-n11-p01-pause-and-escalate":
    "지금 많이 무겁게 느껴지시는 것 같아요. 그건 이 연습을 끝내는 것보다 훨씬 중요한 일이에요. 여기서 잠시 멈추고, 가능한 한 빨리 연구 담당 임상가나 지역 응급 서비스에 연락해 주세요. 혼자 감당하지 않으셔도 됩니다.",
};

// Phase-preserving fallback (P1-3 pattern, wired in runtime-orchestrator.ts for
// tbct-s02): without this, the generic repeatedFallback override could replace
// an S02 step with an unrelated personal-example prompt after three identical
// fallback turns. The walkthrough and the two yes/no steps get a
// construct-preserving rephrase; everything else falls back to the same
// "let's try that more simply" prefix in front of its OWN approved text, so it
// can never drift onto a different construct.
const REPEATED_FALLBACK_REPHRASE: Record<string, { en: string; ko: string }> = {
  "tbct-s02-n05-p01-review-distortion": {
    en: "Just one example of your own for this one pattern is all I need -- and if none comes to mind, saying so is a complete answer.",
    ko: "이 패턴 하나에 대해 본인의 예시 하나만 말씀해 주시면 돼요. 떠오르지 않으면 없다고 말씀하시는 것도 온전한 답이에요.",
  },
  "tbct-s02-n02-p01-homework-update": {
    en: "However it went is fine -- even if you wrote nothing, just tell me how the week was with the list.",
    ko: "어떻게 되셨든 괜찮아요. 적은 게 없더라도, 목록을 두고 한 주가 어떠셨는지만 말씀해 주세요.",
  },
  "tbct-s02-n03-p01-today-agenda": {
    en: "Is going through the fifteen patterns one at a time all right with you? Yes or no is enough.",
    ko: "15가지 패턴을 하나씩 살펴보는 방식이 괜찮으신가요? 네, 아니요로만 답해 주셔도 돼요.",
  },
  "tbct-s02-n07-p01-score-distortion": {
    en: "Two things for this one pattern: how many days it came up this past week, and how strongly you believed it at the time. If it did not come up at all, that is a 0.",
    ko: "이 패턴 하나에 대해 두 가지만요. 지난 한 주에 며칠 정도 있었는지, 그리고 그럴 때 얼마나 믿었는지예요. 아예 없었다면 0점이에요.",
  },
  "tbct-s02-n10-p03-homework-commitment": {
    en: "Do you think you can do that this week? Yes or no is enough.",
    ko: "이번 주에 해 보실 수 있을까요? 네, 아니요로만 답해 주셔도 돼요.",
  },
};

export function resolveRepeatedFallbackText(input: { promptItemId: string; approvedPatientText: string; locale?: string }): string {
  const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
  const specific = REPEATED_FALLBACK_REPHRASE[input.promptItemId];
  if (specific) return isKorean ? specific.ko : specific.en;
  return isKorean ? `조금 더 간단하게 다시 여쭤볼게요. ${input.approvedPatientText}` : `Let's take that a little more simply. ${input.approvedPatientText}`;
}
