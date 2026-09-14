// Labels for the S01 worksheets (s01/worksheet.tsx). The participant sees
// them in their session locale; the clinician view has no locale and gets
// English.

export type S01Locale = "ko" | "en";

export function s01Locale(locale?: string): S01Locale {
  return (locale ?? "").toLowerCase().startsWith("ko") ? "ko" : "en";
}

export type S01Labels = {
  problemsTitle: string;
  problems: string;
  representative: string;
  goal: string;
  goalBenefit: string;
  ccdTitle: string;
  situation: string;
  firstWords: string;
  thought: string;
  belief: string;
  emotions: string;
  behaviorBody: string;
  behavior: string;
  body: string;
  friend: string;
  dottedNote: string;
  cycleTitle: string;
  cycleFeeling: string;
  cycleThought: string;
  cyclePrevention: string;
  cycleLink: string;
  cycleEffect: string;
  outcome: string;
  threeTitle: string;
  scene: string;
  person: (n: number) => string;
  insight: string;
  summary: string;
  distortionsChosen: string;
  distortionListTitle: string;
  distortionListHomeworkNote: string;
  feeling: string;
  given: string;
  reviewTitle: string;
  empty: string;
};

export const S01_LABELS: Record<S01Locale, S01Labels> = {
  ko: {
    problemsTitle: "나의 어려움과 목표",
    problems: "어려움",
    representative: "대표 어려움",
    goal: "상담이 끝났을 때 바라는 모습",
    goalBenefit: "이루면 달라질 것",
    ccdTitle: "나의 인지 모델 (Level 1)",
    situation: "상황",
    firstWords: "처음 하신 말",
    thought: "자동적 사고",
    belief: "믿는 정도",
    emotions: "감정",
    behaviorBody: "행동 · 몸의 반응",
    behavior: "행동",
    body: "몸",
    friend: "친구라면 했을 생각",
    dottedNote: "상황과 생각 사이의 점선은, 같은 상황이라도 꼭 같은 생각이 드는 건 아니라는 뜻이에요.",
    cycleTitle: "되돌아오는 화살표",
    cycleFeeling: "행동 뒤의 감정",
    cycleThought: "더 강해진 생각",
    cyclePrevention: "막으려고 하는 행동",
    cycleLink: "처음 어려움과의 연결",
    cycleEffect: "당장 / 길게 보면",
    outcome: "그 뒤 실제로 일어난 일",
    threeTitle: "세 사람 예시 (Level 1 × 3)",
    scene: "상황 (세 사람 모두 같음)",
    person: (n) => ["첫 번째", "두 번째", "세 번째"][n - 1] + " 사람",
    insight: "무엇이 차이를 만들었나",
    summary: "내 요약",
    distortionsChosen: "내가 알아차린 인지 왜곡",
    distortionListTitle: "인지 왜곡 15가지",
    distortionListHomeworkNote: "이 목록은 오늘 세션이 끝나면 숙제 화면에서 ‘내 예시’를 적으며 다시 보게 돼요.",
    feeling: "감정",
    given: "주어진 감정",
    reviewTitle: "칸별 확인 · 수정",
    empty: "대화하면서 채워져요",
  },
  en: {
    problemsTitle: "My difficulties and goals",
    problems: "Difficulties",
    representative: "The one underneath",
    goal: "When counseling ends",
    goalBenefit: "What would change",
    ccdTitle: "My cognitive model (Level 1)",
    situation: "Situation",
    firstWords: "In my first words",
    thought: "Automatic thought",
    belief: "Belief",
    emotions: "Feelings",
    behaviorBody: "Behavior · Body",
    behavior: "Behavior",
    body: "Body",
    friend: "What a friend might think",
    dottedNote: "The dotted arrow between situation and thought means the same situation does not have to lead to the same thought.",
    cycleTitle: "Returning arrows",
    cycleFeeling: "Feeling after what I did",
    cycleThought: "The thought that got stronger",
    cyclePrevention: "What I do to prevent it",
    cycleLink: "Link to my difficulty",
    cycleEffect: "Right away / over time",
    outcome: "What actually happened",
    threeTitle: "Three-person example (Level 1 × 3)",
    scene: "Situation (same for all three)",
    person: (n) => `Person ${n}`,
    insight: "What made the difference",
    summary: "My summary",
    distortionsChosen: "Distortions I recognized",
    distortionListTitle: "The 15 cognitive distortions",
    distortionListHomeworkNote: "You'll see this same list again in this week's homework, where you write your own examples.",
    feeling: "Feeling",
    given: "given",
    reviewTitle: "Review / edit each field",
    empty: "Fills in as we talk",
  },
};
