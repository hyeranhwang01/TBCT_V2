// The study setup Protocol V9 describes, as the default a country deployment
// is configured from (scripts/seed-trial.ts -> configureStudy).
// .claude/TASK_SCOPE.json note2026_09_28_rct_backend.
//
// Fixed by the protocol: three arms (p.1), 12 weekly sessions (p.12;
// decision 2026-09-28), completion within 14 weeks, assessments at baseline,
// mid (weeks 6-7), post (weeks 12-14) and 3-month follow-up (p.16-18), weekly
// PHQ-2 + suicidality item in the AI-led arm with PHQ-2 >= 5 (p.13), 5-year
// retention (p.18).
//
// NOT fixed by the protocol -- settings to confirm with the research team
// (listed in the plan): which AI module runs in which week (the app has 8
// modules for 12 weeks; weeks 9-12 have none until decided), the follow-up
// window, the serious-AE reporting deadline (24 h, ICH default), the
// deterioration rule for the DSMB's emergency review (>= 20% of AI-only
// participants, p.19; "deterioration" = DASS-21 up by >= 10 raw points here).

import type { ArmCode, ScheduleTemplateEntry, TimepointCode } from "@/types/trial";
import type { StudyConfigInput } from "@/shared/trial/trial-store-ops";

export const AI_MODULE_BY_WEEK: Record<number, number | null> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: null, 10: null, 11: null, 12: null };
const WEEKS = Array.from({ length: 12 }, (_, index) => index + 1);

export const DEFAULT_SCHEDULES: Record<ArmCode, ScheduleTemplateEntry[]> = {
  CLINICIAN_ONLY: WEEKS.map((week) => ({ visitType: "therapist_session", number: week, week, aiModuleNumber: null })),
  AI_CLINICIAN: [
    ...WEEKS.map((week) => ({ visitType: "therapist_session" as const, number: week, week, aiModuleNumber: null })),
    ...WEEKS.map((week) => ({ visitType: "between_module" as const, number: week, week, aiModuleNumber: AI_MODULE_BY_WEEK[week] })),
  ],
  AI_LED: [
    { visitType: "orientation", number: 0, week: 0, aiModuleNumber: null },
    ...WEEKS.map((week) => ({ visitType: "ai_session" as const, number: week, week, aiModuleNumber: AI_MODULE_BY_WEEK[week] })),
    ...[4, 8, 12].map((week) => ({ visitType: "coordinator_call" as const, number: week, week, aiModuleNumber: null })),
  ],
};

const OUTCOMES = ["DASS21", "PHQ9", "WHODAS12", "NCBI", "NEOFFI_N", "WHOQOL_BREF", "CSQ8", "CSSRS"];

export const DEFAULT_TIMEPOINTS: Array<{ code: TimepointCode; anchor: "enrollment" | "allocation"; startDay: number; endDay: number; repeatEveryDays?: number; repeatCount?: number; instruments: Record<string, string[]> }> = [
  { code: "baseline", anchor: "enrollment", startDay: 0, endDay: 14, instruments: { ALL: [...OUTCOMES, "GAD7", "LSAS", "PDSS", "SCID5CV"] } },
  { code: "after_first_session", anchor: "allocation", startDay: 0, endDay: 14, instruments: { ALL: ["CEQ"] } },
  { code: "mid", anchor: "allocation", startDay: 35, endDay: 48, instruments: { ALL: OUTCOMES, CLINICIAN_ONLY: ["CALPAS"], AI_CLINICIAN: ["CALPAS", "WAISR"], AI_LED: ["WAISR"] } },
  { code: "post", anchor: "allocation", startDay: 77, endDay: 97, instruments: { ALL: OUTCOMES, CLINICIAN_ONLY: ["CALPAS"], AI_CLINICIAN: ["CALPAS", "WAISR"], AI_LED: ["WAISR"] } },
  { code: "fu3m", anchor: "allocation", startDay: 161, endDay: 181, instruments: { ALL: OUTCOMES, CLINICIAN_ONLY: ["CALPAS"], AI_CLINICIAN: ["CALPAS", "WAISR"], AI_LED: ["WAISR"] } },
  { code: "weekly", anchor: "allocation", startDay: 0, endDay: 6, repeatEveryDays: 7, repeatCount: 12, instruments: { AI_LED: ["PHQ2SI"] } },
];

export const DEFAULT_ARMS: Array<{ code: ArmCode; name: string; aiEnabled: boolean; therapistRequired: boolean }> = [
  { code: "CLINICIAN_ONLY", name: "Therapist-only TBCT + structured homework", aiEnabled: false, therapistRequired: true },
  { code: "AI_CLINICIAN", name: "Blended therapist + AI TBCT", aiEnabled: true, therapistRequired: true },
  { code: "AI_LED", name: "AI-only TBCT", aiEnabled: true, therapistRequired: false },
];

export const DEFAULT_STUDY_SETTINGS = { phq2Threshold: 5, seriousReportHours: 24, deteriorationPoints: 10, deteriorationShare: 0.2 };

export const SCREENING_CRITERIA = [
  { code: "age_18_65", label: "Age 18-65" },
  { code: "dsm5_diagnosis", label: "DSM-5-TR MDD, GAD, social anxiety or panic disorder" },
  { code: "language", label: "Fluent in the local language" },
  { code: "internet", label: "Internet >= 1 Mbps (video) / 256 Kbps (AI)" },
  { code: "severity", label: "PHQ-9 >= 10 and/or GAD-7 >= threshold" },
  { code: "medication_stable", label: "Psychotropic dose stable >= 4 weeks (if any)" },
  { code: "consent_capacity", label: "Able to give written consent" },
  { code: "no_psychosis_bipolar_sud", label: "No psychosis, bipolar disorder, moderate-severe substance use" },
  { code: "cssrs_not_high", label: "C-SSRS not moderate/high risk" },
  { code: "no_concurrent_treatment", label: "No concurrent psychological treatment or trial" },
  { code: "no_cognitive_impairment", label: "No interfering cognitive impairment or medical condition" },
];

/** One database per country (decision 2026-09-28): each deployment holds its
 * own sites. Site codes are the stratum prefix in the randomization list. */
export const COUNTRY_SITES: Record<string, Array<{ code: string; name: string; locale: string; timezone: string }>> = {
  KR: [{ code: "KR", name: "Korea", locale: "ko", timezone: "Asia/Seoul" }],
  BR: [{ code: "BR", name: "Brazil", locale: "pt-BR", timezone: "America/Sao_Paulo" }],
  FR: [{ code: "FR", name: "France", locale: "fr", timezone: "Europe/Paris" }],
};

export const PROTOCOL_VERSION = "V9";

export function defaultStudyConfig(country: string, status: "draft" | "active" = "draft"): StudyConfigInput {
  const sites = COUNTRY_SITES[country];
  if (!sites) throw new Error(`No default sites for country ${country} (known: ${Object.keys(COUNTRY_SITES).join(", ")})`);
  return {
    study: { id: `TBCT-RCT-${country}`, code: `TBCT-RCT-${country}`, title: "TBCT three-arm RCT", country, protocolVersion: PROTOCOL_VERSION, status, settings: { ...DEFAULT_STUDY_SETTINGS } },
    arms: DEFAULT_ARMS.map((arm) => ({ ...arm, scheduleTemplate: DEFAULT_SCHEDULES[arm.code] })),
    sites,
    timepoints: DEFAULT_TIMEPOINTS,
  };
}
