import type { SeverityBand, StandardizedInstrumentId } from "@/types/standardized-assessment";

// PHQ-9 (Patient Health Questionnaire-9) and GAD-7 (Generalized Anxiety
// Disorder-7) -- both public-domain, Pfizer-licensed-for-free-clinical-use
// instruments in wide standard use. Item wording below is the standard
// English instrument plus a commonly-used Korean rendering.
//
// FLAGGED, NOT SILENTLY GLOSSED OVER: the Korean wording here has not been
// checked against an officially validated Korean translation (there are
// several in the published literature, e.g. Ahn et al.) -- it should be
// reviewed by a Korean-speaking clinician before this is relied on for real
// scoring decisions, same "pilot scope" caveat as this codebase's other
// clinical content. The scoring bands themselves (0-3 per item, cutoffs
// below) are the standard, unambiguous instrument definition.

export interface AssessmentItem {
  textEn: string;
  textKo: string;
}

export interface InstrumentDefinition {
  id: StandardizedInstrumentId;
  nameEn: string;
  nameKo: string;
  instructionEn: string;
  instructionKo: string;
  items: AssessmentItem[];
  /** Index of the self-harm ideation item (PHQ-9 item 9), if this
   * instrument has one -- see submitStandardizedAssessment's own doc
   * comment for what a nonzero answer here triggers. */
  selfHarmItemIndex?: number;
}

const RESPONSE_OPTIONS_EN = ["Not at all", "Several days", "More than half the days", "Nearly every day"];
const RESPONSE_OPTIONS_KO = ["전혀 없음", "며칠 동안", "1주일의 절반 이상", "거의 매일"];

export function responseOptionLabel(value: number, locale: "en" | "ko"): string {
  const options = locale === "ko" ? RESPONSE_OPTIONS_KO : RESPONSE_OPTIONS_EN;
  return options[value] ?? String(value);
}

export const PHQ9: InstrumentDefinition = {
  id: "phq9",
  nameEn: "PHQ-9 (Depression screening)",
  nameKo: "PHQ-9 (우울증 선별검사)",
  instructionEn: "Over the last 2 weeks, how often have you been bothered by the following problems?",
  instructionKo: "지난 2주 동안, 다음 문제들로 얼마나 자주 방해를 받으셨습니까?",
  selfHarmItemIndex: 8,
  items: [
    { textEn: "Little interest or pleasure in doing things", textKo: "일을 하는 것에 대한 흥미나 재미가 거의 없음" },
    { textEn: "Feeling down, depressed, or hopeless", textKo: "기분이 가라앉거나, 우울하거나, 절망적인 느낌" },
    { textEn: "Trouble falling or staying asleep, or sleeping too much", textKo: "잠들기 어렵거나 자꾸 깨어남, 혹은 너무 많이 잠" },
    { textEn: "Feeling tired or having little energy", textKo: "피곤하다고 느끼거나 기운이 거의 없음" },
    { textEn: "Poor appetite or overeating", textKo: "식욕이 없거나 과식함" },
    { textEn: "Feeling bad about yourself — or that you are a failure or have let yourself or your family down", textKo: "자신에 대해 부정적으로 느끼거나, 자신을 실패자라고 느끼거나, 자신 또는 가족을 실망시켰다고 느낌" },
    { textEn: "Trouble concentrating on things, such as reading or watching television", textKo: "책을 읽거나 텔레비전을 보는 것과 같은 일에 집중하기 어려움" },
    { textEn: "Moving or speaking so slowly that other people could have noticed, or the opposite — being so fidgety or restless that you have been moving around a lot more than usual", textKo: "다른 사람들이 눈치챌 정도로 너무 느리게 움직이거나 말함, 또는 반대로 평소보다 많이 움직이는 안절부절함" },
    { textEn: "Thoughts that you would be better off dead, or of hurting yourself in some way", textKo: "차라리 죽는 것이 나을 것 같다는 생각, 또는 자해에 대한 생각" },
  ],
};

export const GAD7: InstrumentDefinition = {
  id: "gad7",
  nameEn: "GAD-7 (Anxiety screening)",
  nameKo: "GAD-7 (불안 선별검사)",
  instructionEn: "Over the last 2 weeks, how often have you been bothered by the following problems?",
  instructionKo: "지난 2주 동안, 다음 문제들로 얼마나 자주 방해를 받으셨습니까?",
  items: [
    { textEn: "Feeling nervous, anxious, or on edge", textKo: "초조하거나, 불안하거나, 조마조마한 느낌" },
    { textEn: "Not being able to stop or control worrying", textKo: "걱정하는 것을 멈추거나 조절할 수 없음" },
    { textEn: "Worrying too much about different things", textKo: "여러 가지 것들에 대해 지나치게 걱정함" },
    { textEn: "Trouble relaxing", textKo: "편하게 있기가 어려움" },
    { textEn: "Being so restless that it's hard to sit still", textKo: "너무 안절부절해서 가만히 앉아있기가 힘듦" },
    { textEn: "Becoming easily annoyed or irritable", textKo: "쉽게 짜증이 나거나 화가 남" },
    { textEn: "Feeling afraid as if something awful might happen", textKo: "마치 끔찍한 일이 일어날 것처럼 두려움을 느낌" },
  ],
};

export const INSTRUMENTS: Record<StandardizedInstrumentId, InstrumentDefinition> = { phq9: PHQ9, gad7: GAD7 };

/** Standard PHQ-9 severity bands (0-27 total). */
function phq9Severity(total: number): SeverityBand {
  if (total <= 4) return "minimal";
  if (total <= 9) return "mild";
  if (total <= 14) return "moderate";
  if (total <= 19) return "moderately_severe";
  return "severe";
}

/** Standard GAD-7 severity bands (0-21 total) -- no "moderately_severe"
 * band in the published instrument, unlike PHQ-9. */
function gad7Severity(total: number): SeverityBand {
  if (total <= 4) return "minimal";
  if (total <= 9) return "mild";
  if (total <= 14) return "moderate";
  return "severe";
}

export function scoreInstrument(instrumentId: StandardizedInstrumentId, answers: number[]): { totalScore: number; severity: SeverityBand } {
  const definition = INSTRUMENTS[instrumentId];
  if (answers.length !== definition.items.length) {
    throw new Error(`${instrumentId} expects ${definition.items.length} answers, got ${answers.length}`);
  }
  if (answers.some((value) => !Number.isInteger(value) || value < 0 || value > 3)) {
    throw new Error(`${instrumentId} answers must each be an integer 0-3`);
  }
  const totalScore = answers.reduce((sum, value) => sum + value, 0);
  const severity = instrumentId === "phq9" ? phq9Severity(totalScore) : gad7Severity(totalScore);
  return { totalScore, severity };
}
