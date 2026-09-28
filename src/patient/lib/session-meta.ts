export type UiLocale = "ko" | "en";

type Localized = Record<UiLocale, string>;

export type PatientSessionMeta = {
  number: number;
  definitionId: string;
  title: Localized;
  /** Short technique name shown as a caption, never as the main title. */
  technique: string;
  purpose: Localized;
  steps: Record<UiLocale, [string, string, string]>;
  /** Two-to-four-word names of the same three steps, for the session header. */
  shortSteps: Record<UiLocale, [string, string, string]>;
};

// Patient-facing copy for each of the eight sessions. Written from the step
// structure of each session's own source (docs/prompts/TBCT_AI_Prompt_S0N.md
// for S01/S02, src/patient/sessions/s0N/spec.ts for the rest), so every line
// describes something the session actually does -- nothing here is new
// clinical content. S02 is CD-Quest since the 2026-09-21 redesign; the old
// home screen still called it "problems and goals".
export const PATIENT_SESSIONS: PatientSessionMeta[] = [
  {
    number: 1,
    definitionId: "tbct-s01",
    title: { ko: "TBCT 모델 소개", en: "Introduction to TBCT" },
    technique: "CCD",
    purpose: {
      ko: "도움받고 싶은 어려움과 목표를 정하고, 나의 한 장면을 통해 상황·생각·감정·행동이 어떻게 이어지는지 함께 살펴봐요.",
      en: "Name what you'd like help with and a goal, then use one moment of your own to see how situation, thought, feeling and action connect.",
    },
    steps: {
      ko: ["도움받고 싶은 어려움과 상담 목표 정하기", "최근의 한 장면으로 생각·감정·행동의 연결 보기", "생각의 함정(인지왜곡) 알아보고 한 주 연습 정하기"],
      en: ["Choose a difficulty and a goal for counseling", "Look at one recent moment: thought, feeling, action", "Meet the cognitive distortions and plan the week"],
    },
    shortSteps: {
      ko: ["어려움과 목표", "생각·감정·행동의 연결", "생각의 함정"],
      en: ["Difficulty & goal", "How it connects", "Thinking traps"],
    },
  },
  {
    number: 2,
    definitionId: "tbct-s02",
    title: { ko: "인지왜곡 유형", en: "Cognitive distortions" },
    technique: "CD-Quest",
    purpose: {
      ko: "15가지 생각의 함정을 하나씩 짚으며 내 경험 속 예를 찾고, 지난 한 주 동안 얼마나 자주·강하게 나타났는지 점수로 확인해요.",
      en: "Go through the fifteen thinking traps one at a time, find your own examples, and score how often and how strongly each showed up this week.",
    },
    steps: {
      ko: ["지난 한 주의 연습 돌아보기", "15가지 생각의 함정마다 내 예시 찾기", "질문지(CD-Quest)로 점수 매기고 다룰 것 정하기"],
      en: ["Look back on last week's practice", "Find your own example for each of the fifteen", "Score them with the CD-Quest and choose a focus"],
    },
    shortSteps: {
      ko: ["지난주 돌아보기", "15가지 함정의 예", "점수와 초점"],
      en: ["Last week", "The fifteen traps", "Score & focus"],
    },
  },
  {
    number: 3,
    definitionId: "tbct-s03",
    title: { ko: "개인 내적 사고 기록", en: "Intrapersonal thought record" },
    technique: "Intra-TR",
    purpose: {
      ko: "나를 힘들게 한 한 장면을 골라, 그때 떠오른 생각을 뒷받침하는 근거와 그렇지 않은 근거를 함께 따져봐요.",
      en: "Pick one moment that was hard, and weigh the evidence for and against the thought that came up in it.",
    },
    steps: {
      ko: ["상황과 그때의 생각·감정 적기", "생각을 뒷받침하는 근거와 반대 근거 살펴보기", "균형 잡힌 결론을 세우고 처음 생각 다시 평가하기"],
      en: ["Write down the situation, thought and feeling", "Look at the evidence for and against the thought", "Reach a balanced conclusion and re-rate the thought"],
    },
    shortSteps: {
      ko: ["상황과 생각", "근거 살펴보기", "균형 잡힌 결론"],
      en: ["Situation & thought", "Weigh the evidence", "Balanced conclusion"],
    },
  },
  {
    number: 4,
    definitionId: "tbct-s04",
    title: { ko: "대인관계 사고 기록", en: "Interpersonal thought record" },
    technique: "Inter-TR",
    purpose: {
      ko: "다른 사람과 있었던 일을 골라, 내 관점과 상대방이 가졌을 법한 관점을 나란히 놓고 살펴봐요.",
      en: "Take something that happened with another person and set your view next to the view they may have had.",
    },
    steps: {
      ko: ["그 사람과 있었던 상황과 내 생각·감정 적기", "상대방 입장에서 가능한 생각 떠올려 보기", "두 관점을 비교하고 해 볼 행동 계획하기"],
      en: ["Write down the situation and your thought and feeling", "Imagine what the other person may have thought", "Compare the two views and plan what to try"],
    },
    shortSteps: {
      ko: ["상황과 내 생각", "상대의 관점", "비교와 계획"],
      en: ["Your view", "Their view", "Compare & plan"],
    },
  },
  {
    number: 5,
    definitionId: "tbct-s05",
    title: { ko: "참여 격자", en: "Participation grid" },
    technique: "PG",
    purpose: {
      ko: "스스로를 탓하게 되는 일이 있을 때, 그 일에 영향을 준 요인들을 함께 나눠 보며 내 몫이 실제로 얼마인지 다시 따져봐요.",
      en: "When you blame yourself for something, share it out among everything that contributed and look again at how much was really yours.",
    },
    steps: {
      ko: ["죄책감이나 수치심이 드는 일과 그 정도 적기", "그 일에 영향을 준 사람·상황 모두 떠올리기", "각각의 몫을 나눈 뒤 처음 느낌 다시 평가하기"],
      en: ["Name the event and how guilty or ashamed you feel", "List every person and circumstance that played a part", "Share out the parts and re-rate the feeling"],
    },
    shortSteps: {
      ko: ["마음이 무거운 일", "영향을 준 요인", "몫 나누기"],
      en: ["The weight you carry", "What contributed", "Share it out"],
    },
  },
  {
    number: 6,
    definitionId: "tbct-s06",
    title: { ko: "색상별 증상 위계", en: "Color-coded symptoms hierarchy" },
    technique: "CCSH",
    purpose: {
      ko: "불편한 증상과 피하게 되는 행동을 목록으로 만들어 0~5점 색깔 척도로 정도를 매기고, 가벼운 것부터 연습할 계획을 세워요.",
      en: "List the symptoms and avoidances that bother you, rate each on a 0–5 color scale, and plan practice starting with the lightest.",
    },
    steps: {
      ko: ["불편한 증상·피하는 행동 목록 만들기", "0~5점 색깔 척도로 하나씩 점수 매기기", "초록색 항목부터 한 주 연습 계획 세우기"],
      en: ["Make a list of symptoms and avoidances", "Rate each on the 0–5 color scale", "Plan the week's practice from the green items"],
    },
    shortSteps: {
      ko: ["목록 만들기", "색깔 점수", "연습 계획"],
      en: ["Make the list", "Color ratings", "Practice plan"],
    },
  },
  {
    number: 7,
    definitionId: "tbct-s07",
    title: { ko: "합의된 역할극", en: "Consensual role-play" },
    technique: "CRP",
    purpose: {
      ko: "하고 싶지만 망설여지는 일을 두고, 마음속 '감정'과 '이성'이 자리를 바꿔 가며 대화하는 역할극으로 서로 합의할 수 있는 길을 찾아봐요.",
      en: "Around something you want to do but hesitate over, let your 'emotion' and 'reason' take turns speaking until they find common ground.",
    },
    steps: {
      ko: ["망설여지는 행동의 장점과 단점 따져 보기", "감정과 이성이 번갈아 말하는 역할극 하기", "합의된 입장에서 다시 평가하고 실천 계획 세우기"],
      en: ["Weigh the pros and cons of the action", "Role-play emotion and reason in turn", "Re-weigh together and make an action plan"],
    },
    shortSteps: {
      ko: ["장점과 단점", "감정과 이성의 대화", "합의와 계획"],
      en: ["Pros & cons", "Emotion and reason", "Agree & plan"],
    },
  },
  {
    number: 8,
    definitionId: "tbct-s08",
    // "Trial One" is the first of TBCT's courtroom techniques (Trial-Based
    // Cognitive Therapy), not a first "attempt"; s08/spec.ts titleKo still
    // reads "첫 번째 시도" for the clinician side.
    title: { ko: "첫 번째 재판", en: "Trial One" },
    technique: "Trial I",
    purpose: {
      ko: "나를 괴롭히는 핵심 믿음을 마음속 법정에 세우고, 검사와 변호인의 입장에서 근거를 살펴본 뒤 스스로 판결을 내려봐요.",
      en: "Put a core belief that troubles you on trial: hear the prosecution and the defense, then reach your own verdict.",
    },
    steps: {
      ko: ["다룰 핵심 믿음과 믿는 정도 정하기", "검사측·변호측 근거를 번갈아 제시하기", "판결을 내리고 믿음의 변화 확인하기"],
      en: ["Choose the core belief and how much you believe it", "Present the prosecution and the defense in turn", "Reach a verdict and see how the belief changed"],
    },
    shortSteps: {
      ko: ["핵심 믿음", "검사와 변호", "판결"],
      en: ["Core belief", "Prosecution & defense", "Verdict"],
    },
  },
];

export function sessionNumberOf(sessionDefinitionId: string): number {
  return Number(sessionDefinitionId.match(/s(\d+)/i)?.[1] ?? 0);
}

export function sessionMetaFor(sessionDefinitionIdOrNumber: string | number): PatientSessionMeta | undefined {
  const number = typeof sessionDefinitionIdOrNumber === "number" ? sessionDefinitionIdOrNumber : sessionNumberOf(sessionDefinitionIdOrNumber);
  return PATIENT_SESSIONS.find((session) => session.number === number);
}

export function sessionLabel(number: number, locale: UiLocale): string {
  return locale === "ko" ? `${number}회기` : `Session ${number}`;
}

/** The unit shown under a session number badge. */
export function sessionUnit(locale: UiLocale): string {
  return locale === "ko" ? "회기" : "Session";
}
