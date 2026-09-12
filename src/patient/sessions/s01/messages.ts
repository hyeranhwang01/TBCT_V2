import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import { FIXED_S01_SCENE } from "@/patient/sessions/s01/generation";

// S01 redesign (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign). Keys
// are positional prompt ids (see the header of spec.ts) -- a stale key fails
// silently, so s01/messages.test.ts checks that every key exists and that
// every S01 prompt resolves to Korean text.

// A warm, content-neutral opening: the manual's example acknowledgment
// ("That sounds like a lot to be carrying") answers one worked example's
// content, not whatever a real participant says.
const APPROVED_TEXT: Record<string, string> = {
  "tbct-s01-n01-p01-warm-acknowledgement": "Thank you for coming. Let's start step by step with what we'll do together today.",
};

const SCENE_PROMPT_ID = "tbct-s01-n10-p02-scene";

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown> = {}, locale?: string): string | undefined {
  // The three-person scene generated for this session (stored by
  // s01/turn-rules.ts), else the fixed real-session scene. Deliberately NOT
  // in koreanText below: a koreanText entry would override this text.
  if (promptItem.id === SCENE_PROMPT_ID) {
    const stored = fields.threePersonScene;
    if (typeof stored === "string" && stored.trim()) return stored.trim();
    return (locale ?? "").toLowerCase().startsWith("ko") ? FIXED_S01_SCENE.ko.scene : FIXED_S01_SCENE.en.scene;
  }
  return APPROVED_TEXT[promptItem.id];
}

// Quoted placeholders are followed by a fixed noun ("‘[their emotion]’, 그
// 감정이 ...") so the Korean particle never depends on the participant's word.
export const koreanText: Record<string, string> = {
  "tbct-s01-n01-p01-warm-acknowledgement": "와 주셔서 감사해요. 오늘 함께할 것부터 차근차근 시작해 볼게요.",

  "tbct-s01-n02-p01-main-difficulty": "요즘 도움을 받고 싶은 어려움이 있으세요? 떠오르는 것부터 편하게 말씀해 주세요.",
  "tbct-s01-n02-p02-difficulty-example": "그 어려움이 드러났던 구체적인 예를 하나 들어 주실 수 있을까요?",
  "tbct-s01-n02-p03-other-difficulty": "그 밖에 도움을 받고 싶은 다른 어려움도 있나요?",
  "tbct-s01-n02-p04-other-difficulty-more": "또 다른 어려움이 있을까요? 없으면 없다고 하셔도 괜찮아요.",
  "tbct-s01-n02-p05-representative-difficulty": "말씀해 주신 것들 중에서, 다른 어려움들을 대표하는 가장 큰 어려움은 무엇일까요? '두 번째 거요'처럼 말씀하셔도 돼요.",
  "tbct-s01-n02-p06-goal-at-end": "상담이 끝났을 때, ‘[representative difficulty]’, 이 어려움이 어떻게 되어 있으면 좋겠어요?",
  "tbct-s01-n02-p07-goal-benefit": "그렇게 된다면 어떤 기분이 들 것 같고, 생활에서는 무엇이 달라질까요?",

  "tbct-s01-n03-p01-collaboration-and-practice": "상담은 함께 만들어 가는 과정이에요. 일주일 168시간 중 이렇게 이야기 나누는 시간은 한 시간 남짓이라, 대화 밖의 나머지 시간에 하는 작은 연습이 효과를 크게 좌우해요.",
  "tbct-s01-n03-p02-practice-commitment": "이렇게 함께 해 보실 수 있을까요?",

  "tbct-s01-n04-p01-recent-moment": "최근 일주일 동안 ‘[representative difficulty]’, 이 어려움이 느껴졌던 때가 있었나요? 그때 어떤 일이 있었는지 말씀해 주세요.",
  "tbct-s01-n04-p02-situation-examples": "아주 작은 일이어도 괜찮아요. 예를 들면 해야 할 일이 있었다거나, 발표를 하거나, 누구를 만나야 했던 일 같은 거요. 비슷한 일이 있었을까요?",
  "tbct-s01-n04-p03-write-situation-line": "방금 말씀하신 걸 워크시트에 한 줄로 적는다면, 어떻게 적으면 좋을까요?",

  "tbct-s01-n05-p01-first-emotion": "그때 기분이 어떠셨어요?",
  "tbct-s01-n05-p02-first-emotion-intensity": "0은 전혀 없음, 100은 가장 강함이라면, 그 감정은 어느 정도였어요?",
  "tbct-s01-n05-p03-second-emotion": "그때 함께 느낀 다른 감정도 있었나요?",
  "tbct-s01-n05-p04-second-emotion-intensity": "그 감정은 0에서 100 중 어느 정도였어요?",
  "tbct-s01-n05-p05-third-emotion": "또 다른 감정도 있었나요?",
  "tbct-s01-n05-p06-third-emotion-intensity": "그 감정도 0에서 100 중 어느 정도였는지 말씀해 주세요.",

  "tbct-s01-n06-p01-thought-behind-emotion": "‘[their emotion]’, 그 감정이 왜 들었을까요? 그때 머릿속에 어떤 생각이 스쳤을까요?",
  "tbct-s01-n06-p02-write-thought-line": "그 생각을 워크시트에 한 줄로 적는다면, 어떻게 적으면 좋을까요?",
  "tbct-s01-n06-p03-thought-belief": "그 당시에 그 생각을 얼마나 강하게 믿으셨어요? 0은 전혀 믿지 않음, 100은 완전히 믿음이에요.",

  "tbct-s01-n07-p01-first-behavior": "그때 어떻게 하셨어요?",
  "tbct-s01-n07-p02-behavior-examples": "예를 들면 자리를 피했거나, 말을 하지 않았거나, 울었거나, 바로 해결하려고 했을 수도 있어요. 어떠셨어요?",
  "tbct-s01-n07-p03-second-behavior": "그 밖에 또 하신 행동이 있었나요?",
  "tbct-s01-n07-p04-body": "그때 몸에서는 어떤 느낌이 있었어요? 예를 들면 긴장되거나, 떨리거나, 가슴이 두근거렸을 수도 있어요.",
  "tbct-s01-n07-p05-body-examples": "아주 작은 것도 괜찮아요. 얼굴이 뜨거웠다거나, 가슴이 답답했다거나, 손이 떨렸다거나요. 그런 게 있었을까요?",

  "tbct-s01-n08-p01-link-check": "워크시트를 보면, 상황 → 생각 → 감정 → 행동과 몸의 반응으로 이어져 있어요. 이렇게 연결되는 게 보이세요?",
  "tbct-s01-n08-p02-dotted-line": "상황에서 생각으로 가는 화살표는 점선이에요. 같은 상황이라도 꼭 같은 생각이 드는 건 아니라는 뜻이에요.",
  "tbct-s01-n08-p03-friend-same-thought": "가까운 친구가 똑같은 상황에 있었다면, 똑같이 생각했을까요?",
  "tbct-s01-n08-p04-friend-thought": "그 친구는 어떻게 생각했을 것 같아요?",

  "tbct-s01-n09-p01-after-behavior-feeling": "‘[their behavior]’, 그렇게 하고 난 뒤에는 기분이 어땠어요?",
  "tbct-s01-n09-p02-thought-strengthened": "그런 기분이 들면, 어떤 생각이 더 강해지나요?",
  "tbct-s01-n09-p03-usual-prevention": "그런 일이 다시 생기지 않게 하려고, 평소에 어떻게 하세요?",
  "tbct-s01-n09-p04-usual-prevention-hint": "어떤 분들은 그런 상황을 피하기도 하고, 미리 대비하거나 계획을 많이 세우기도 해요. 둘 중에 비슷한 게 있을까요?",
  "tbct-s01-n09-p05-problem-link": "그게 처음에 말씀하신 ‘[representative difficulty]’, 그 어려움과도 이어질까요?",
  "tbct-s01-n09-p06-short-long-term": "그렇게 하면 당장은 어떤가요? 그리고 길게 보면 어떻게 되는 것 같아요?",

  "tbct-s01-n10-p01-preview": "이번에는 다른 사람들 이야기로 같은 원리를 한 번 더 볼게요. 내 일이 아니라서 한 발 떨어져 보면 더 잘 보이거든요.",

  "tbct-s01-n11-p01-candidate-one-emotion": "그 말을 들은 첫 번째 사람은 어떤 기분이 들까요? 일단 긍정적인 쪽부터 생각해 볼게요.",
  "tbct-s01-n11-p02-candidate-one-thought": "그런 기분이 들었다면, 어떤 생각이 스쳤을까요?",
  "tbct-s01-n11-p03-candidate-one-behavior": "그런 생각과 기분이라면, 어떻게 행동할 것 같아요?",
  "tbct-s01-n11-p04-candidate-one-body": "그때 몸은 어떤 느낌일까요?",

  "tbct-s01-n12-p01-candidate-two-thought": "두 번째 사람은 똑같은 말을 듣고 ‘의심’이 들었어요. 어떤 생각을 했기에 의심이 들었을까요?",
  "tbct-s01-n12-p02-candidate-two-thought-hint": "예를 들면 ‘[person two hint]’ 같은 생각이면 그럴 수 있어요. 두 번째 사람은 어떤 생각을 했을까요?",
  "tbct-s01-n12-p03-candidate-two-behavior": "그렇게 의심이 들면, 어떻게 행동할 것 같아요?",
  "tbct-s01-n12-p04-candidate-two-body": "그때 몸은 어떤 느낌일까요?",

  "tbct-s01-n13-p01-candidate-three-thought": "세 번째 사람은 똑같은 말을 듣고 ‘화’가 났어요. 어떤 생각을 했기에 화가 났을까요?",
  "tbct-s01-n13-p02-candidate-three-thought-hint": "예를 들면 ‘[person three hint]’ 같은 생각이면 그럴 수 있어요. 세 번째 사람은 어떤 생각을 했을까요?",
  "tbct-s01-n13-p03-candidate-three-behavior": "그렇게 화가 나면, 어떻게 행동할 것 같아요?",
  "tbct-s01-n13-p04-candidate-three-body": "그때 몸은 어떤 느낌일까요?",

  "tbct-s01-n14-p01-situation-same": "세 사람의 상황은 같았나요, 달랐나요?",
  "tbct-s01-n14-p02-feelings-compared": "그러면 세 사람의 기분은 같았나요, 달랐나요?",
  "tbct-s01-n14-p03-actions-compared": "행동은요?",
  "tbct-s01-n14-p04-what-made-difference": "상황은 같았는데, 무엇이 달라서 이렇게 달라졌을까요?",
  "tbct-s01-n14-p05-emotion-cause-follow-up": "그러면 그 감정은 무엇 때문에 달라졌을까요?",

  "tbct-s01-n15-p01-return-bridge": "이제 아까 말씀하신 ‘[their situation]’, 그 상황으로 돌아가서, 방금 본 것과 같은 패턴이 본인에게 어떻게 나타났는지 볼게요.",
  "tbct-s01-n15-p02-what-made-feeling": "세 사람은 같은 말을 듣고도 생각에 따라 기분이 달랐죠. 본인 상황에서는 무엇이 ‘[their emotion]’, 그 기분을 만들었다고 보세요?",
  "tbct-s01-n15-p03-what-happened": "‘[their behavior]’, 그렇게 하신 뒤에 그 일은 실제로 어떻게 됐어요?",
  "tbct-s01-n15-p04-outcome-meaning": "그러면 두려워하셨던 일이 실제로는 일어나지 않았다는 것이, 어떤 의미가 있을까요?",

  "tbct-s01-n16-p01-participant-summary": "다음으로 넘어가기 전에 여쭤보고 싶은 게 있어요. 그 상황에서 생각, 감정, 행동이 어떻게 연결되는지, 스스로 알아차리거나 이해하신 걸 본인의 말로 표현해 주시겠어요?",

  "tbct-s01-n17-p01-show-list": "대화 옆에 ‘인지 왜곡 15가지’ 목록을 펼쳐 두었어요. 흔히 나타나는 생각의 패턴들이에요.",
  "tbct-s01-n17-p02-intro-distortions": "지금까지 살펴본 이런 부정적인 자동적 사고들 — 인지치료에서는 이를 부르는 이름이 있습니다. 바로 인지 왜곡(cognitive distortion)이라고 해요. 모든 자동적 사고가 왜곡인 것은 아니지만, 그중 일부는 살펴볼 만한 사고의 오류나 과장인 경우가 있습니다.",
  "tbct-s01-n17-p03-read-a-few": "그중에서 두세 개만 읽어 보시겠어요?",
  "tbct-s01-n17-p04-identify-distortion": "그 상황에서 머릿속에 스쳐 지나간 생각을 살펴볼 때 — 이 중에 해당하는 왜곡이 있나요? 없다고 느끼셔도 괜찮습니다.",
  // Last-resort text only: runtime-orchestrator.ts grounds this turn on the
  // registry-validated candidate list when the participant asked for it.
  "tbct-s01-n17-p05-suggested-candidates": "말씀해 주신 생각과 비교해 볼 만한 패턴을 몇 가지 골라 볼게요. 이 중에 비슷하게 느껴지는 게 있나요? 없어도 괜찮아요.",
  "tbct-s01-n17-p06-meaning-of-distortion": "만약 이 생각이 인지 왜곡 — 일종의 사고의 오류 — 일 수도 있다는 걸 알게 되신다면, 어떤 차이가 있을까요?",

  "tbct-s01-n18-p01-homework-assignment": "이번 주에는 인지 왜곡 목록을 곁에 두고, 이런 생각이 들 때마다 해당하는 왜곡의 ‘내 예시’ 칸에 짧게 적어 보세요. 다음 시간에 같이 볼게요.",
  "tbct-s01-n18-p02-homework-commitment": "할 수 있으시겠어요?",
  "tbct-s01-n18-p03-goodbye": "오늘 이야기 나눠 주셔서 고마워요. 다음 시간에 뵐게요.",
};

// When the dialogue agent falls back to identical approved text three turns
// in a row, runtime-orchestrator.ts's generic override would ask for "one
// specific moment" -- a new personal-experience question that must never
// jump out of the current S01 step. These rephrase the same step instead;
// every other S01 prompt gets the generic "more simply" prefix below.
const REPEATED_FALLBACK_REPHRASE: Record<string, { en: string; ko: string }> = {
  "tbct-s01-n04-p01-recent-moment": {
    en: "No pressure at all -- even something small is fine. In the past week, was there a moment when that difficulty showed up a little?",
    ko: "부담 갖지 않으셔도 괜찮아요. 아주 작은 일이어도 좋아요 — 최근에 그 어려움이 조금이라도 느껴졌던 순간이 있었을까요?",
  },
  "tbct-s01-n05-p01-first-emotion": {
    en: "Thinking back to that moment -- what feeling came up?",
    ko: "그 순간으로 다시 돌아가 볼게요 — 그때 어떤 기분이 들었나요?",
  },
  "tbct-s01-n06-p01-thought-behind-emotion": {
    en: "Right now we're not trying to describe the situation more -- just whatever thought went through your mind at that moment, even roughly.",
    ko: "지금은 상황을 더 자세히 설명하시는 것보다, 그 순간 머릿속에 어떤 생각이 스쳐 지나갔는지만 한 번 떠올려보시면 됩니다.",
  },
  "tbct-s01-n07-p01-first-behavior": {
    en: "Just the behavior part -- what did you do, or want to do, at that moment?",
    ko: "이번엔 행동만요 — 그때 어떻게 하셨나요, 또는 뭘 하고 싶으셨나요?",
  },
  "tbct-s01-n07-p04-body": {
    en: "Even something small is fine -- did you notice anything at all in your body in that moment?",
    ko: "아주 사소한 것도 괜찮아요 — 그 순간 몸에서 느껴진 게 있었을까요?",
  },
  "tbct-s01-n11-p01-candidate-one-emotion": {
    en: "Just thinking about that first person again -- hearing those words, what feeling might come up for them?",
    ko: "다시 첫 번째 사람을 생각해볼게요 — 그 말을 들었다면 어떤 기분이 들 것 같나요?",
  },
  "tbct-s01-n11-p03-candidate-one-behavior": {
    en: "Just the behavior part -- with that feeling, how do you think they'd act?",
    ko: "이번엔 행동 부분만요 — 그런 기분이었다면 어떻게 행동할 것 같나요?",
  },
  "tbct-s01-n12-p01-candidate-two-thought": {
    en: "Thinking about the second person again -- they felt suspicious. What thought might have led to that?",
    ko: "다시 두 번째 사람을 생각해볼게요 — 의심이 들었다면, 어떤 생각이 스쳤을까요?",
  },
  "tbct-s01-n13-p01-candidate-three-thought": {
    en: "Thinking about the third person again -- they got angry. What thought might have led to that?",
    ko: "다시 세 번째 사람을 생각해볼게요 — 화가 났다면, 어떤 생각이 스쳤을까요?",
  },
  "tbct-s01-n14-p04-what-made-difference": {
    en: "Let me put it more simply: the words were the same, but the three reactions were different. What do you think made that difference?",
    ko: "조금 더 쉽게 여쭤볼게요. 들은 말은 같았는데 세 사람의 반응은 달랐어요. 무엇이 그 차이를 만들었을까요?",
  },
};

/**
 * Step-preserving replacement for runtime-orchestrator.ts's generic
 * repeated-fallback override, S01 only. Any prompt not listed above gets a
 * locale-aware "let's try that more simply" prefix in front of its own
 * approved text, so no S01 prompt can turn into a new personal-experience
 * question.
 */
export function resolveRepeatedFallbackText(input: { promptItemId: string; approvedPatientText: string; locale?: string }): string {
  const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
  const specific = REPEATED_FALLBACK_REPHRASE[input.promptItemId];
  if (specific) return isKorean ? specific.ko : specific.en;
  return isKorean ? `조금 더 간단하게 다시 여쭤볼게요. ${input.approvedPatientText}` : `Let's take that a little more simply. ${input.approvedPatientText}`;
}
