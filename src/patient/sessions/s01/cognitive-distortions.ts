// S01-only approved cognitive distortion registry (task redesign brief,
// .claude/TASK_SCOPE.json's note2026_08_17d entry). This is the ONLY source
// of cognitive-distortion names/descriptions Claude is allowed to reference
// for S01's identify-distortion step -- see s01-distortion-candidates.ts,
// which validates every model-returned id against DISTORTION_IDS below
// before anything reaches the participant. Deliberately NOT shared-Runtime
// content: S02-S08 never import this file.

export type CognitiveDistortion = {
  id: string;
  nameKo: string;
  nameEn: string[];
  descriptionKo: string;
  exampleKo: string[];
  // English quality parity: descriptionEn/exampleEn are the equivalent
  // fields for the deterministic (offline) candidate-selection fallback in
  // s01-distortion-candidates.ts. Before these existed, that fallback's
  // relevanceReason was hardcoded to Korean regardless of session locale --
  // an English-speaking participant using this codebase without a
  // configured ANTHROPIC_API_KEY (this dev/test environment's actual
  // default) saw an English name followed by a Korean explanation sentence.
  descriptionEn: string;
  exampleEn: string[];
};

export const S01_COGNITIVE_DISTORTIONS: CognitiveDistortion[] = [
  {
    id: "dichotomous-thinking",
    nameKo: "이분법적 사고",
    nameEn: ["Dichotomous thinking", "All-or-nothing thinking", "Black-and-white thinking", "Polarized thinking"],
    descriptionKo: "상황이나 사람을 연속선상에서 보지 않고 성공/실패, 좋음/나쁨처럼 두 극단으로만 판단함.",
    exampleKo: ["실수했으니 나는 실패자야."],
    descriptionEn: "Judging things as either all good or all bad, with no middle ground.",
    exampleEn: ["I made a mistake, so I'm a failure."],
  },
  {
    id: "fortune-telling-catastrophizing",
    nameKo: "미래예측 / 파국화",
    nameEn: ["Fortune telling", "Catastrophizing"],
    descriptionKo: "미래를 부정적으로 예측하고, 그 일이 생기면 견딜 수 없을 정도로 끔찍할 것이라고 생각함.",
    exampleKo: ["나는 실패할 거고, 그러면 견딜 수 없을 거야."],
    descriptionEn: "Predicting the worst will happen, and that it would be unbearable.",
    exampleEn: ["I'm going to fail, and then I won't be able to handle it."],
  },
  {
    id: "discounting-positive",
    nameKo: "긍정적인 것 무시·평가절하",
    nameEn: ["Discounting the positive", "Disqualifying the positive"],
    descriptionKo: "긍정적인 경험이나 결과가 있어도 의미가 없거나 우연이라고 치부함.",
    exampleKo: ["시험에 합격했지만 그냥 운이 좋았던 거야."],
    descriptionEn: "Dismissing good things that happen as meaningless or just luck.",
    exampleEn: ["I passed the exam, but I just got lucky."],
  },
  {
    id: "emotional-reasoning",
    nameKo: "감정적 추론",
    nameEn: ["Emotional reasoning"],
    descriptionKo: "내가 그렇게 느끼기 때문에 그것이 사실이라고 판단함.",
    exampleKo: ["비행기가 무서우니까 비행은 위험한 게 분명해."],
    descriptionEn: "Assuming something must be true simply because it feels that way.",
    exampleEn: ["I'm afraid of flying, so flying must be dangerous."],
  },
  {
    id: "labeling",
    nameKo: "낙인찍기",
    nameEn: ["Labeling"],
    descriptionKo: "한 행동이나 특성을 근거로 자신이나 타인에게 고정적이고 전반적인 부정적 이름표를 붙임.",
    exampleKo: ["나는 패배자야."],
    descriptionEn: "Giving yourself or others a fixed, harsh label based on one thing.",
    exampleEn: ["I'm a loser."],
  },
  {
    id: "magnification-minimization",
    nameKo: "과대평가 / 과소평가",
    nameEn: ["Magnification", "Minimization"],
    descriptionKo: "부정적인 것은 지나치게 크게 보고 긍정적인 것은 작게 봄.",
    exampleKo: ["B를 받았어. 역시 나는 수준이 낮아.", "A를 받았지만 내가 똑똑한 건 아니야."],
    descriptionEn: "Blowing negatives out of proportion while shrinking the positives.",
    exampleEn: ["I got a B. I guess I'm just not that capable.", "I got an A, but that doesn't mean I'm actually smart."],
  },
  {
    id: "selective-abstraction",
    nameKo: "선택적 추상화",
    nameEn: ["Selective abstraction", "Mental filter", "Tunnel vision"],
    descriptionKo: "전체 상황은 보지 않고 일부 부정적인 정보만 골라서 집중함.",
    exampleKo: ["상사가 발표는 좋다고 했지만 슬라이드 하나를 수정했으니 사실 마음에 안 들었던 거야."],
    descriptionEn: "Focusing on one negative detail while ignoring everything else.",
    exampleEn: ["My boss said the presentation was good, but they changed one slide, so they must have actually disliked it."],
  },
  {
    id: "mind-reading",
    nameKo: "마음읽기",
    nameEn: ["Mind reading"],
    descriptionKo: "충분한 근거 없이 다른 사람이 무엇을 생각하거나 의도하는지 안다고 믿음.",
    exampleKo: ["저 사람은 내가 실패했다고 생각하고 있을 거야."],
    descriptionEn: "Assuming you know what someone else is thinking without real evidence.",
    exampleEn: ["That person probably thinks I failed."],
  },
  {
    id: "overgeneralization",
    nameKo: "과잉일반화",
    nameEn: ["Overgeneralization"],
    descriptionKo: "한두 번의 경험을 근거로 항상, 절대, 모두처럼 광범위하게 일반화함.",
    exampleKo: ["쉬는 날만 되면 항상 비가 와."],
    descriptionEn: "Generalizing broadly -- always, never, everyone -- from one experience.",
    exampleEn: ["It always rains on my day off."],
  },
  {
    id: "personalizing",
    nameKo: "개인화",
    nameEn: ["Personalizing"],
    descriptionKo: "다른 사람의 행동이나 외부 사건이 나와 관련 있거나 나를 향한 것이라고 해석함.",
    exampleKo: ["점원이 감사 인사를 안 했으니 나를 무시한 거야."],
    descriptionEn: "Assuming someone else's behavior is about you or aimed at you.",
    exampleEn: ["The clerk didn't say thank you, so they must be disrespecting me."],
  },
  {
    id: "should-statements",
    nameKo: "당위적 사고",
    nameEn: ["Should statements", "Musts", "Oughts", "Have-tos"],
    descriptionKo: "자신이나 타인, 상황이 반드시 이래야만 한다고 생각함.",
    exampleKo: ["나는 더 좋은 엄마였어야 했어."],
    descriptionEn: "Believing you, others, or a situation absolutely must be a certain way.",
    exampleEn: ["I should have been a better mother."],
  },
  {
    id: "jumping-to-conclusions",
    nameKo: "성급한 결론",
    nameEn: ["Jumping to conclusions"],
    descriptionKo: "충분한 근거가 없는데도 빠르게 긍정적 또는 부정적 결론을 내림.",
    exampleKo: ["처음 보자마자 저 사람은 나쁜 의도가 있다는 걸 알았어."],
    descriptionEn: "Reaching a quick conclusion without enough evidence.",
    exampleEn: ["The moment I saw them, I knew they had bad intentions."],
  },
  {
    id: "blaming",
    nameKo: "비난하기",
    nameEn: ["Blaming others", "Blaming oneself"],
    descriptionKo: "부정적인 감정의 원인을 전적으로 타인에게 돌리거나 반대로 타인의 행동까지 자신의 책임으로 돌림.",
    exampleKo: ["내가 불행한 건 부모님 때문이야.", "아들이 이기적인 사람과 결혼한 건 내 잘못이야."],
    descriptionEn: "Putting the entire blame on someone else, or entirely on yourself.",
    exampleEn: ["I'm unhappy because of my parents.", "It's my fault my son married someone selfish."],
  },
  {
    id: "what-if",
    nameKo: "'만약에?' 사고",
    nameEn: ["What if?"],
    descriptionKo: "앞으로 일어날 수 있는 부정적 상황을 계속 '만약 ~하면 어떡하지?'라고 반복적으로 생각함.",
    exampleKo: ["차 사고가 나면 어떡하지?", "연인이 나를 떠나면 어떡하지?"],
    descriptionEn: "Repeatedly imagining bad outcomes, always asking 'what if...?'",
    exampleEn: ["What if I get into a car accident?", "What if my partner leaves me?"],
  },
  {
    id: "unfair-comparisons",
    nameKo: "불공정한 비교",
    nameEn: ["Unfair comparisons"],
    descriptionKo: "자신보다 잘한다고 보이는 사람과 비교하여 자신을 불리한 위치에 놓음.",
    exampleKo: ["저 사람은 나보다 성공했으니 나는 실패자야."],
    descriptionEn: "Comparing yourself unfavorably to someone who seems to be doing better.",
    exampleEn: ["That person is more successful than me, so I'm a failure."],
  },
];

export const S01_DISTORTION_IDS = new Set(S01_COGNITIVE_DISTORTIONS.map((item) => item.id));

export function findDistortionById(id: string): CognitiveDistortion | undefined {
  return S01_COGNITIVE_DISTORTIONS.find((item) => item.id === id);
}
