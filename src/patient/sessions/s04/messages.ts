import type { PromptItem } from "@/lib/protocol/source-fidelity-types";

const APPROVED_TEXT: Record<string, string> = {
  "tbct-s04-n12-p02-all-actions-first": "Before drawing a conclusion, let’s review the actions and reactions you identified together.",
};

export function resolveStaticText(promptItem: PromptItem): string | undefined {
  return APPROVED_TEXT[promptItem.id];
}

// Keys are position-derived (`tbct-s04-n{nodeIndex}-p{promptIndex}-{slug}`, see
// source-fidelity-catalog.ts), so reordering or inserting a node/prompt in
// sessions/s04.ts shifts every later ID and silently unmatches these entries.
// Add new prompts at the end of their array, or renumber here to match.
export const koreanText: Record<string, string> = {
  // Step 1 -- interpersonal situation
  "tbct-s04-n01-p01-describe-situation": "살펴보고 싶은 대인관계 상황에서 어떤 일이 일어나고 있나요? 지금 그 일이 일어나고 있는 것처럼 이야기해 주셔도 좋아요.",

  // Pathway determination -- the source marks the category names as "for AI
  // recognition only ... never named to the patient", so this wording states
  // what happens next without naming the branch it selected.
  "tbct-s04-n02-p01-recognize-pathway": "당신의 관점과 상대방의 관점을 하나씩 함께 그려볼게요. 어느 쪽 해석이 맞다고 미리 정해두지 않고 살펴보겠습니다.",

  // Step 2 -- participant's automatic thought and belief
  "tbct-s04-n03-p01-patient-automatic-thought": "그 상황에서 어떤 생각이 스쳐 지나가나요?",
  "tbct-s04-n03-p02-patient-thought-belief": "그 생각을 얼마나 믿고 계신가요? 0에서 100% 사이의 숫자로 말씀해 주세요.",

  // Step 3 -- emotion and intensity
  "tbct-s04-n04-p01-patient-emotion": "그 생각을 믿을 때 어떤 감정이 드나요?",
  "tbct-s04-n04-p02-patient-emotion-intensity": "그 감정은 얼마나 강한가요? 0에서 100% 사이의 숫자로 말씀해 주세요.",

  // Step 4 -- behavior, body, and the confirmation of the summary so far
  "tbct-s04-n05-p01-patient-behavior": "그 생각을 믿고 그렇게 느낄 때, 무엇을 하시나요?",
  "tbct-s04-n05-p02-patient-body": "그 순간 몸에서 느껴지는 것이 있나요?",
  "tbct-s04-n05-p03-confirm-summary": "지금까지 이야기한 생각과 감정, 행동과 몸의 반응을 정리해 보았는데, 실제 경험과 맞나요?",

  // Steps 5-7 -- the other person's perspective. All three are asked as what the
  // other person *might* think/feel/do; the source is explicit that the
  // participant is not expected to read the other person's mind, and phrasing
  // step 7 as a question about what they actually did collapses the exercise.
  "tbct-s04-n06-p01-other-person-thought": "당신이 그렇게 행동할 때, 상대방의 마음에는 어떤 생각이 스쳐 지나갈까요?",
  // Fires only on the social anxiety / feared-evaluation pathway.
  "tbct-s04-n06-p02-plausible-possibility": "상대방의 마음을 정확히 읽어야 하는 것은 아니에요. 그럴 수도 있겠다 싶은 가능성 하나를 떠올려 주시면 충분합니다.",
  "tbct-s04-n07-p01-other-person-emotion": "상대방이 그런 생각을 했다면, 어떤 감정을 느낄까요?",
  "tbct-s04-n08-p01-other-person-behavior": "그럼 상대방은 어떻게 행동할 것 같으세요?",

  // Feedback loop -- one of the two central insights of the Inter-TR
  "tbct-s04-n09-p01-notice-cycle": "지금까지 이야기한 것을 하나의 순환으로 놓고 보면, 무엇이 보이시나요?",
  "tbct-s04-n09-p02-behavior-influences-response": "당신의 행동이 상대방의 반응에 어떤 영향을 준다고 보시나요?",
  "tbct-s04-n09-p03-response-influences-participant": "그러면 상대방의 반응은 다시 당신에게 어떤 영향을 주나요?",
  "tbct-s04-n09-p04-cycle-self-perpetuation": "이 순환이 계속 반복되게 만드는 것은 무엇일까요?",

  // Locus of control -- the second central insight
  "tbct-s04-n10-p01-outside-control": "이 순환에서 당신의 통제 밖에 있는 부분은 어디인가요?",
  "tbct-s04-n10-p02-other-person-control": "상대방의 생각이나 감정, 행동을 직접 통제할 수 있을까요?",
  "tbct-s04-n10-p03-own-leverage": "그렇다면 이 순환에서 당신이 가장 크게 영향을 줄 수 있는 부분은 어디일까요?",

  // Step 8 -- re-rating
  "tbct-s04-n11-p01-final-at-belief": "이 순환이 보이는 지금, 처음의 그 생각을 얼마나 믿고 계신가요? 0에서 100% 사이의 숫자로 말씀해 주세요.",

  // Action plan
  "tbct-s04-n12-p01-own-behavior-action": "바꿀 수 있는 것이 자신의 행동이라면, 무엇을 해보시겠어요?",
  "tbct-s04-n12-p02-all-actions-first": "결론을 내리기 전에, 함께 파악한 행동들과 반응들을 먼저 살펴볼게요.",
  "tbct-s04-n12-p03-obstacles": "그 계획을 실행할 때 어떤 어려움이 생길 수 있을까요?",
  "tbct-s04-n12-p04-solutions": "그 어려움이 생긴다면 어떻게 해볼 수 있을까요?",
  "tbct-s04-n12-p05-implementation-timing": "언제 실행해 보시겠어요?",

  // Final check-in. n13-p01 re-reads the same field as n11-p01; the source's
  // step table has only one re-rating, so this wording marks it as a repeat
  // rather than presenting it as a fresh question. Whether the duplicate node
  // should exist at all is open.
  "tbct-s04-n13-p01-final-belief-check": "마지막으로 한 번 더 여쭐게요. 처음의 그 생각을 지금 얼마나 믿고 계신가요? 0에서 100% 사이의 숫자로 말씀해 주세요.",
  "tbct-s04-n13-p02-final-emotional-check": "지금 전반적으로 어떠신가요? 그대로인지, 조금 나아졌는지, 많이 나아졌는지 말씀해 주세요.",

  // Social anxiety / feared-evaluation branch
  "tbct-s04-n14-p01-test-feared-prediction": "걱정하시는 그 일이 실제로 일어나는지 확인해 볼 수 있는 방법을 함께 찾아볼게요.",
};
