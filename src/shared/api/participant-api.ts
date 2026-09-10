import { appendParticipantSession, getLongitudinalRecord, getParticipant, getParticipantByAuthUserId, listParticipantConsentEvents, listParticipants, saveLongitudinalRecord, saveParticipant, saveParticipantConsentEvent, updateParticipant } from "@/shared/data/repositories/participant-repository";
import { createMemoryAuditEntry } from "@/shared/memory/memory-helpers";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { UI_LOCALE_TO_SESSION_LOCALE, type UiLocale } from "@/shared/i18n/locales";
import type { ParticipantConsentEvent, RuntimeParticipant } from "@/types/longitudinal-memory";

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") {
    return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function listRuntimeParticipants() {
  return listParticipants();
}

export async function getRuntimeParticipant(participantId: string) {
  return getParticipant(participantId);
}

export async function getOrCreateDemoParticipant() {
  const existing = await getParticipant("PARTICIPANT-BR-01");
  if (existing) return existing;
  const now = new Date().toISOString();
  const participant: RuntimeParticipant = {
    id: "PARTICIPANT-BR-01",
    projectId: "TBCT-BR-001",
    alias: "TBCT-DEMO-001",
    locale: "pt-BR",
    country: "BR",
    status: "active",
    runtimeSessionIds: [],
    longitudinalRecordId: "LREC-DEMO-BR-001",
    consent: {
      memoryStorageAllowed: true,
      crossSessionUseAllowed: true,
      sensitiveMemoryAllowed: false,
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  await saveParticipant(participant);
  await saveLongitudinalRecord({
    id: "LREC-DEMO-BR-001",
    participantId: participant.id,
    projectId: participant.projectId,
    activeMemoryIds: [],
    createdAt: now,
    updatedAt: now,
  });
  return participant;
}

/** Looks up (or creates, on first login) the one participant record owned
 * by a real, logged-in patient -- replaces getOrCreateDemoParticipant() for
 * actual patient traffic now that patients have real accounts (see
 * sql/008_link_participants_to_auth.sql). Each auth user gets their own
 * participant, unlike the single shared demo participant above. */
export async function getOrCreateParticipantForUser(authUserId: string, defaults: { locale?: string } = {}) {
  const existing = await getParticipantByAuthUserId(authUserId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = makeId("PARTICIPANT");
  const longitudinalRecordId = makeId("LREC");
  const participant: RuntimeParticipant = {
    id,
    projectId: "TBCT-BR-001",
    alias: `Patient-${id.slice(-8)}`,
    locale: defaults.locale ?? "en-US",
    status: "active",
    runtimeSessionIds: [],
    longitudinalRecordId,
    authUserId,
    consent: {
      memoryStorageAllowed: true,
      crossSessionUseAllowed: true,
      sensitiveMemoryAllowed: false,
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  await saveParticipant(participant);
  await saveLongitudinalRecord({
    id: longitudinalRecordId,
    participantId: participant.id,
    projectId: participant.projectId,
    activeMemoryIds: [],
    createdAt: now,
    updatedAt: now,
  });
  return participant;
}

/** Every real call site of getOrCreateParticipantForUser wants this, not the
 * bare function -- without a locale default, a first-time login silently
 * created an "en-US" participant (and every session run for them) no matter
 * what language the site's own chrome (LocaleToggle, defaulting to Korean --
 * see DEFAULT_LOCALE) was showing at the time, so a patient who never
 * touched the language toggle still got an all-English therapy session
 * under Korean UI chrome. Passing the site's current UI locale here means a
 * brand-new participant's content locale actually matches what they were
 * looking at when their account was first created. */
export async function getOrCreateParticipantForUiLocale(authUserId: string, uiLocale: UiLocale) {
  return getOrCreateParticipantForUser(authUserId, { locale: UI_LOCALE_TO_SESSION_LOCALE[uiLocale] });
}

export async function attachSessionToParticipant(participantId: string, runtimeSessionId: string) {
  await appendParticipantSession(participantId, runtimeSessionId);
}

export async function updateParticipantConsent(
  participantId: string,
  patch: Pick<ParticipantConsentEvent, "memoryStorageAllowed" | "crossSessionUseAllowed" | "sensitiveMemoryAllowed"> & { reason?: string },
) {
  const participant = await getParticipant(participantId);
  if (!participant) throw new Error("Participant not found");
  const event: ParticipantConsentEvent = {
    id: makeId("CONS"),
    participantId,
    ...patch,
    effectiveAt: new Date().toISOString(),
  };
  const next = await updateParticipant(participantId, {
    consent: {
      memoryStorageAllowed: patch.memoryStorageAllowed,
      crossSessionUseAllowed: patch.crossSessionUseAllowed,
      sensitiveMemoryAllowed: patch.sensitiveMemoryAllowed,
      updatedAt: event.effectiveAt,
    },
  });
  await saveParticipantConsentEvent(event);
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Participant consent updated",
      resource: `Participant ${participantId}`,
      version: "stage3",
      previousValue: JSON.stringify(participant.consent),
      newValue: JSON.stringify(next.consent),
      reason: patch.reason ?? "Consent changed",
    }),
  );
  return next;
}

export async function updateParticipantProfile(
  participantId: string,
  patch: Pick<RuntimeParticipant, "alias" | "locale" | "country" | "status">,
) {
  const participant = await getParticipant(participantId);
  if (!participant) throw new Error("Participant not found");
  const next = await updateParticipant(participantId, {
    alias: patch.alias,
    locale: patch.locale,
    country: patch.country,
    status: patch.status,
  });
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Participant profile updated",
      resource: `Participant ${participantId}`,
      version: "stage3",
      previousValue: JSON.stringify({ alias: participant.alias, locale: participant.locale, country: participant.country, status: participant.status }),
      newValue: JSON.stringify({ alias: next.alias, locale: next.locale, country: next.country, status: next.status }),
      reason: "Patient profile fields updated",
    }),
  );
  return next;
}

/** Patient-controllable reminder-email opt-outs -- see
 * RuntimeParticipant.notificationPreferences's own doc comment for what
 * this does and doesn't cover. */
export async function updateNotificationPreferences(
  participantId: string,
  patch: { sessionReminders?: boolean; homeworkReminders?: boolean; newMessages?: boolean },
) {
  const participant = await getParticipant(participantId);
  if (!participant) throw new Error("Participant not found");
  const next = await updateParticipant(participantId, {
    notificationPreferences: { ...participant.notificationPreferences, ...patch },
  });
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({
      action: "Notification preferences updated",
      resource: `Participant ${participantId}`,
      version: "stage3",
      previousValue: JSON.stringify(participant.notificationPreferences ?? {}),
      newValue: JSON.stringify(next.notificationPreferences ?? {}),
      reason: "Patient notification preferences updated",
    }),
  );
  return next;
}

/** Resolves a clinician's auth user id (RuntimeParticipant.assignedClinician)
 * to their email for display -- see src/app/api/clinicians/resolve-email/route.ts. */
export async function resolveClinicianEmail(userId: string): Promise<string | null> {
  const response = await fetch("/api/clinicians/resolve-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) return null;
  return body.email ?? null;
}

/** Assigns (or reassigns) the calling clinician to a participant, stored as
 * their Supabase Auth user id -- matches the RuntimeParticipant.authUserId
 * convention (an id, not an email; see sql/008), not a display value. Used
 * by the "Assign to me" button; pass `null` to unassign. */
export async function assignClinicianToParticipant(participantId: string, clinicianUserId: string | null) {
  return updateParticipant(participantId, { assignedClinician: clinicianUserId ?? undefined });
}

export async function getParticipantConsentHistory(participantId: string) {
  return listParticipantConsentEvents(participantId);
}

export async function getParticipantRecord(participantId: string) {
  return getLongitudinalRecord(participantId);
}
