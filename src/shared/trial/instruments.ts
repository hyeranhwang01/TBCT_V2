// Outcome instruments of Protocol V9 (p.16-18) as data: structure, response
// range and scoring (.claude/TASK_SCOPE.json note2026_09_28_rct_backend, M6).
//
// Scoring is computed here only where the rule is standard and unambiguous;
// instruments whose scoring key is licensed or not given in the protocol keep
// their item answers ("items_only") and are scored in analysis. Item wording
// is shipped only for the instruments already in the app (PHQ-9 and GAD-7,
// PHQ-2 being PHQ-9 items 1-2); the others' wording is added to the
// instruments table by the research team where the licence allows.
//
// Flags a response can raise (for review tasks, sql/039):
//  - "phq2_high": PHQ-2 at or above the study threshold (Protocol p.13: >= 5);
//  - "suicidality": the suicidality item above 0 (PHQ-9 item 9, the PHQ-2
//    add-on item);
//  - "cssrs_moderate" / "cssrs_high": C-SSRS screen risk.

import { GAD7, PHQ9 } from "@/shared/standardized-assessments/instruments";

export type Scoring =
  | { kind: "sum"; multiplier?: number; subscales?: Record<string, number[]> }
  | { kind: "phq2_plus_suicidality" }
  | { kind: "cssrs_screen" }
  | { kind: "items_only" };

export type TrialInstrument = {
  code: string;
  version: string;
  name: string;
  mode: "self" | "interview";
  itemCount: number;
  responseMin: number | null;
  responseMax: number | null;
  scoring: Scoring;
  licenseNote: string;
  /** Items (1-based positions) whose value above 0 means suicidality. */
  suicidalityItems?: number[];
  items?: { en: string[]; ko: string[] };
};

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

export const TRIAL_INSTRUMENTS: TrialInstrument[] = [
  {
    code: "DASS21", version: "1", name: "Depression Anxiety Stress Scales-21 (primary outcome)", mode: "self", itemCount: 21, responseMin: 0, responseMax: 3,
    // Subscale scores are doubled to the DASS-42 metric, as is standard;
    // `total` is the raw sum. Which metric the protocol's remission cut-off
    // (<= 10) refers to is an open question for the research team.
    scoring: { kind: "sum", subscales: { depression: [3, 5, 10, 13, 16, 17, 21], anxiety: [2, 4, 7, 9, 15, 19, 20], stress: [1, 6, 8, 11, 12, 14, 18] } },
    licenseNote: "Public domain (Lovibond & Lovibond); wording to be added from the validated local version.",
  },
  {
    code: "PHQ9", version: "1", name: "PHQ-9", mode: "self", itemCount: 9, responseMin: 0, responseMax: 3, scoring: { kind: "sum" },
    licenseNote: "Free to use (Pfizer).", suicidalityItems: [9],
    items: { en: PHQ9.items.map((item) => item.textEn), ko: PHQ9.items.map((item) => item.textKo) },
  },
  {
    code: "GAD7", version: "1", name: "GAD-7", mode: "self", itemCount: 7, responseMin: 0, responseMax: 3, scoring: { kind: "sum" },
    licenseNote: "Free to use (Pfizer).",
    items: { en: GAD7.items.map((item) => item.textEn), ko: GAD7.items.map((item) => item.textKo) },
  },
  {
    code: "PHQ2SI", version: "1", name: "PHQ-2 + suicidality item (weekly, AI-led arm)", mode: "self", itemCount: 3, responseMin: 0, responseMax: 3,
    scoring: { kind: "phq2_plus_suicidality" }, licenseNote: "PHQ items, free to use (Pfizer).", suicidalityItems: [3],
    items: { en: [PHQ9.items[0].textEn, PHQ9.items[1].textEn, PHQ9.items[8].textEn], ko: [PHQ9.items[0].textKo, PHQ9.items[1].textKo, PHQ9.items[8].textKo] },
  },
  { code: "WHODAS12", version: "2.0", name: "WHO-DAS 2.0, 12 items", mode: "self", itemCount: 12, responseMin: 1, responseMax: 5, scoring: { kind: "sum" }, licenseNote: "WHO; free with registration." },
  { code: "NCBI", version: "1", name: "Negative Core Beliefs Inventory (32 items)", mode: "self", itemCount: 32, responseMin: null, responseMax: null, scoring: { kind: "items_only" }, licenseNote: "Scoring key to be supplied by the research team." },
  { code: "NEOFFI_N", version: "1", name: "NEO-FFI neuroticism (12 items)", mode: "self", itemCount: 12, responseMin: 0, responseMax: 4, scoring: { kind: "items_only" }, licenseNote: "PAR licence; reverse-keyed items applied in analysis." },
  { code: "WHOQOL_BREF", version: "1", name: "WHOQOL-BREF", mode: "self", itemCount: 26, responseMin: 1, responseMax: 5, scoring: { kind: "items_only" }, licenseNote: "WHO permission; domain transformation applied in analysis." },
  { code: "CSQ8", version: "1", name: "Client Satisfaction Questionnaire-8", mode: "self", itemCount: 8, responseMin: 1, responseMax: 4, scoring: { kind: "items_only" }, licenseNote: "Tamalpais Matrix Systems licence." },
  { code: "CEQ", version: "1", name: "Credibility/Expectancy Questionnaire", mode: "self", itemCount: 6, responseMin: null, responseMax: null, scoring: { kind: "items_only" }, licenseNote: "Devilly & Borkovec; mixed 1-9 and 0-100% items, scored in analysis." },
  { code: "CALPAS", version: "1", name: "California Psychotherapy Alliance Scales", mode: "self", itemCount: 24, responseMin: 1, responseMax: 7, scoring: { kind: "items_only" }, licenseNote: "Research use; scored in analysis." },
  { code: "WAISR", version: "1", name: "Working Alliance Inventory - Short Revised", mode: "self", itemCount: 12, responseMin: 1, responseMax: 5, scoring: { kind: "sum" }, licenseNote: "Free for research." },
  { code: "LSAS", version: "1", name: "Liebowitz Social Anxiety Scale (fear + avoidance)", mode: "self", itemCount: 48, responseMin: 0, responseMax: 3, scoring: { kind: "sum", subscales: { fear: range(1, 24), avoidance: range(25, 48) } }, licenseNote: "Licence required for wording." },
  { code: "PDSS", version: "1", name: "Panic Disorder Severity Scale", mode: "self", itemCount: 7, responseMin: 0, responseMax: 4, scoring: { kind: "sum" }, licenseNote: "Licence required for wording." },
  { code: "SCID5CV", version: "1", name: "SCID-5-CV (diagnoses, entered by the assessor)", mode: "interview", itemCount: 1, responseMin: null, responseMax: null, scoring: { kind: "items_only" }, licenseNote: "APA licence; only the diagnoses are recorded." },
  { code: "CSSRS", version: "screen", name: "C-SSRS screen (entered by the assessor)", mode: "interview", itemCount: 6, responseMin: 0, responseMax: 1, scoring: { kind: "cssrs_screen" }, licenseNote: "Free for clinical and research use (Columbia)." },
];

export function instrumentByCode(code: string): TrialInstrument | undefined {
  return TRIAL_INSTRUMENTS.find((instrument) => instrument.code === code);
}

export type ScoredResponse = { total: number | null; subscales: Record<string, number>; flags: string[] };

export class InvalidResponseError extends Error {}

/** Validates item answers against the instrument and scores them. */
export function scoreResponse(instrument: TrialInstrument, items: unknown[], options: { phq2Threshold?: number } = {}): ScoredResponse {
  if (instrument.code === "SCID5CV") {
    if (items.length !== 1 || typeof items[0] !== "object" || items[0] === null) throw new InvalidResponseError("SCID-5-CV expects one object of diagnoses");
    return { total: null, subscales: {}, flags: [] };
  }
  if (items.length !== instrument.itemCount) throw new InvalidResponseError(`${instrument.code} expects ${instrument.itemCount} answers, got ${items.length}`);
  const values = items.map((item, index) => {
    if (instrument.scoring.kind === "items_only" && (instrument.responseMin === null || instrument.responseMax === null)) {
      if (typeof item !== "number" || !Number.isFinite(item)) throw new InvalidResponseError(`${instrument.code} item ${index + 1} must be a number`);
      return item;
    }
    if (typeof item !== "number" || !Number.isInteger(item) || item < (instrument.responseMin ?? 0) || item > (instrument.responseMax ?? 0)) {
      throw new InvalidResponseError(`${instrument.code} item ${index + 1} must be an integer from ${instrument.responseMin} to ${instrument.responseMax}`);
    }
    return item;
  });
  const flags = (instrument.suicidalityItems ?? []).some((position) => values[position - 1] > 0) ? ["suicidality"] : [];
  const sumOf = (positions: number[]) => positions.reduce((sum, position) => sum + values[position - 1], 0);
  switch (instrument.scoring.kind) {
    case "sum": {
      const subscales: Record<string, number> = {};
      for (const [name, positions] of Object.entries(instrument.scoring.subscales ?? {})) {
        subscales[name] = sumOf(positions) * (instrument.code === "DASS21" ? 2 : 1);
      }
      const total = values.reduce((sum, value) => sum + value, 0) * (instrument.scoring.multiplier ?? 1);
      return { total, subscales, flags };
    }
    case "phq2_plus_suicidality": {
      const phq2 = values[0] + values[1];
      if (phq2 >= (options.phq2Threshold ?? 5)) flags.push("phq2_high");
      return { total: phq2, subscales: { phq2, suicidality_item: values[2] }, flags };
    }
    case "cssrs_screen": {
      // Screen items 1-6 (yes = 1). Standard triage: 1-2 low, 3 moderate,
      // 4, 5 or 6 (behaviour in the past 3 months) high -- the protocol's
      // exclusion (p.8) is "positive on items 4-5 or behaviour in 3 months".
      const risk = values[3] || values[4] || values[5] ? "high" : values[2] ? "moderate" : values[0] || values[1] ? "low" : "none";
      if (risk === "high") flags.push("cssrs_high");
      if (risk === "moderate") flags.push("cssrs_moderate");
      return { total: null, subscales: { risk: ["none", "low", "moderate", "high"].indexOf(risk) }, flags };
    }
    default:
      return { total: null, subscales: {}, flags };
  }
}
