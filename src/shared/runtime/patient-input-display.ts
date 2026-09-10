import type { PatientInput } from "@/types/runtime-session";

// Single source of truth for "how does this canonical PatientInput.value
// read back as a chat message" -- shared by the composer (button labels,
// patient-input-controls.tsx), the optimistic client-side echo
// (patient-session-page.tsx), and the actual persisted RuntimeMessage.content
// (runtime-execution-api.ts). Before this existed, the composer showed a
// nice label ("네") while both the optimistic bubble and the real stored
// message used a bare String(patientInput.value) -- for kind:"boolean" that
// is literally the word "true"/"false" (confirmed live: a patient's own
// chat bubble read "나: true"), and for a canonical choice value
// ("not_ready", "not_guilty", homework-status codes) it was the untranslated
// internal identifier. The underlying value passed to extractRuntimeState
// for deterministic parsing is completely unaffected -- this only changes
// what text represents the answer in the transcript.

// Choice buttons print the catalog's raw canonical value by default, so the
// two most consequential answers in the programme appeared as "not_ready"
// and "not_guilty" -- untranslated, and visibly not the wording the question
// had just used. The submitted value stays canonical; only the label changes.
const CHOICE_LABELS: Record<string, { en: string; ko: string }> = {
  ready: { en: "Ready", ko: "준비됐어요" },
  not_ready: { en: "Not ready", ko: "아직 준비 안 됐어요" },
  guilty: { en: "Guilty", ko: "유죄" },
  not_guilty: { en: "Not guilty", ko: "무죄" },
  not_started: { en: "Not started", ko: "시작 못 했어요" },
  partial: { en: "Partly done", ko: "일부 했어요" },
  completed: { en: "Completed", ko: "완료했어요" },
  not_assigned: { en: "Not assigned", ko: "부여되지 않음" },
  pending: { en: "In progress", ko: "진행 중" },
};

export function choiceLabel(choice: string, locale?: string) {
  const entry = CHOICE_LABELS[choice];
  if (!entry) return choice.replace(/_/g, " ");
  return locale?.startsWith("ko") ? entry.ko : entry.en;
}

function booleanLabel(value: boolean, locale?: string) {
  const isKorean = locale?.toLowerCase().startsWith("ko") ?? false;
  if (isKorean) return value ? "네" : "아니요";
  return value ? "Yes" : "No";
}

/** The text to show/store as the patient's own message for a given answer --
 * NOT the value extractRuntimeState receives (that stays the raw
 * PatientInput.value, untouched). */
export function describePatientInputForDisplay(patientInput: PatientInput, locale?: string): string {
  if (patientInput.kind === "boolean") return booleanLabel(Boolean(patientInput.value), locale);
  if (patientInput.kind === "single_choice" || patientInput.kind === "activity_completion" || patientInput.kind === "homework_status") {
    return choiceLabel(String(patientInput.value), locale);
  }
  if (patientInput.kind === "multi_choice" && Array.isArray(patientInput.value)) {
    return patientInput.value.map((item) => choiceLabel(String(item), locale)).join(", ");
  }
  return Array.isArray(patientInput.value) ? patientInput.value.join(", ") : String(patientInput.value);
}
