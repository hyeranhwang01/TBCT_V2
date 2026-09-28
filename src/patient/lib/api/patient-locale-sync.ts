import { updateParticipantProfile } from "@/shared/api/participant-api";
import { listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import type { RuntimeParticipant } from "@/types/longitudinal-memory";
import { UI_LOCALE_TO_SESSION_LOCALE, type UiLocale } from "@/shared/i18n/locales";

export { UI_LOCALE_TO_SESSION_LOCALE };

const ENDED_STATUSES = new Set(["completed", "terminated", "failed"]);

/**
 * The website's own UI-chrome language (LocaleToggle / useT()) and each
 * patient's actual therapy-session-content language (participant.locale,
 * then copied once into session.locale at session creation) used to be two
 * fully independent settings -- changing the header toggle never touched
 * participant.locale, and nothing ever went back and updated an
 * already-created session's locale either, so "change the language" visibly
 * did nothing to an in-progress conversation. This is the merge point: call
 * it from every surface that lets a patient choose a language (the header
 * LocaleToggle, the profile page's own language field) so a single choice
 * updates the participant record AND every one of that participant's
 * currently open sessions in one step, not just sessions created afterward.
 *
 * Returns the number of open sessions it updated, so a caller can mention it
 * in a confirmation toast.
 */
export async function propagateLocaleToOpenSessions(participant: Pick<RuntimeParticipant, "id">, sessionLocale: string): Promise<number> {
  const sessions = await listRuntimeSessionsForParticipant(participant.id);
  // Ended sessions (completed, terminated, failed) keep the language they
  // were held in; only a session that can still continue takes the new one.
  const staleSessions = sessions.filter((session) => !ENDED_STATUSES.has(session.status) && session.locale !== sessionLocale);
  // Only the locale changes; the status stays as it is. This used to go
  // through setRuntimeSessionStatus(id, sameStatus, { locale }), which the
  // runtime state machine rejects as a self-transition (waiting_for_input ->
  // waiting_for_input is not an allowed move). The rejection was swallowed,
  // so no open session ever switched language, while the toast reported that
  // they had.
  const results = await Promise.allSettled(staleSessions.map((session) => updateRuntimeSessionRecord(session.id, { locale: sessionLocale })));
  return results.filter((result) => result.status === "fulfilled").length;
}

/** Persists the new language onto the participant record, then propagates it
 * to every currently open session. Used by the header LocaleToggle, which
 * only has a participant id/alias/country/status on hand, not a pending
 * profile-form edit -- patientProfilePage's own save flow calls
 * updateParticipantProfile + propagateLocaleToOpenSessions directly instead,
 * since it already has a full pending patch to persist in one mutation. */
export async function applyPatientLocaleChange(participant: Pick<RuntimeParticipant, "id" | "alias" | "country" | "status">, uiLocale: UiLocale): Promise<number> {
  const sessionLocale = UI_LOCALE_TO_SESSION_LOCALE[uiLocale];
  await updateParticipantProfile(participant.id, { alias: participant.alias, locale: sessionLocale, country: participant.country, status: participant.status });
  return propagateLocaleToOpenSessions(participant, sessionLocale);
}
