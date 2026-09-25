// The fixed, deterministic question the program asks when a message carries
// risk wording that may not be a current disclosure ("I don't want to die, I'm
// just exhausted"). Never written by a model. Shared by the node engine
// (runtime-execution-api.ts deliverClarificationTurn) and the prompt-driven
// sessions (prompt-session-api.ts), so both ask exactly the same thing.
export const SAFETY_CLARIFICATION_TEXT = {
  en: "I want to make sure I understand you correctly. Are you saying that you may be thinking about dying or harming yourself, or do you mean that things feel overwhelming right now?",
  ko: "제가 정확히 이해했는지 확인하고 싶어요. 죽고 싶거나 스스로를 해치고 싶다는 생각이 든다는 뜻인가요, 아니면 지금 상황이 감당하기 힘들게 느껴진다는 뜻인가요?",
} as const;

export function safetyClarificationText(locale: string | undefined): string {
  return (locale ?? "").toLowerCase().startsWith("ko") ? SAFETY_CLARIFICATION_TEXT.ko : SAFETY_CLARIFICATION_TEXT.en;
}
