// The participant's memory consent (.claude/TASK_SCOPE.json
// note2026_09_27_memory_rag_m1_consent). One question, asked in a popup the
// first time a participant arrives and changeable in their profile: may the
// program show the model what they said in earlier sessions? Every use of
// past-session memory goes through memoryUseAllowed; nothing else decides it.
//
// Not covered by this consent, and used for everyone: the basic bridge from
// one session to the next (the difficulties and goal from Session 1, whether
// the homework was done -- the previous* fields of session-continuity.ts).
// The popup says so.

import type { MemoryConsentDecision, RuntimeParticipant } from "@/types/longitudinal-memory";

/** Version of the popup wording (i18n memoryConsent.*). Bump it when the
 * wording changes in substance: every participant is then asked again, and
 * until they answer the runtime treats them as not having agreed. */
export const MEMORY_CONSENT_TEXT_VERSION = "1.0.0";

export type MemoryConsentStatus = MemoryConsentDecision | "undecided";

export function memoryConsentStatus(participant: Pick<RuntimeParticipant, "memoryConsent"> | undefined | null): MemoryConsentStatus {
  const consent = participant?.memoryConsent;
  if (!consent || consent.textVersion !== MEMORY_CONSENT_TEXT_VERSION) return "undecided";
  return consent.decision;
}

/** True only for a participant who agreed to the current wording. */
export function memoryUseAllowed(participant: Pick<RuntimeParticipant, "memoryConsent"> | undefined | null): boolean {
  return memoryConsentStatus(participant) === "granted";
}

export function memoryConsentNeedsDecision(participant: Pick<RuntimeParticipant, "memoryConsent"> | undefined | null): boolean {
  return memoryConsentStatus(participant) === "undecided";
}
