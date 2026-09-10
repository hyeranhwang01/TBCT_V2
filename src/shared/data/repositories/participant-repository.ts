import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { PARTICIPANT_STORE_ENDPOINT, type ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type { RuntimeParticipant, ParticipantConsentEvent, LongitudinalRecord } from "@/types/longitudinal-memory";

// The participant roster now lives in Neon Postgres (src/lib/server/participant-store.ts),
// not local IndexedDB -- this is what lets a participant created from the
// patient-facing runtime show up in the clinician Patient Monitoring
// screens. Every function below keeps its original name/signature so call
// sites are unaffected. Longitudinal records and consent events are not yet
// part of this migration and remain local-only for now.
async function callStore<T>(op: ParticipantStoreOp): Promise<T> {
  const response = await runtimeFetch(resolveStoreUrl(PARTICIPANT_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Participant store operation failed.");
  return body.result as T;
}

export async function listParticipants(): Promise<RuntimeParticipant[]> {
  return callStore<RuntimeParticipant[]>({ op: "listParticipants" });
}

export async function getParticipant(participantId: string): Promise<RuntimeParticipant | undefined> {
  return callStore<RuntimeParticipant | undefined>({ op: "getParticipant", participantId });
}

export async function getParticipantByAuthUserId(authUserId: string): Promise<RuntimeParticipant | undefined> {
  return callStore<RuntimeParticipant | undefined>({ op: "getParticipantByAuthUserId", authUserId });
}

export async function saveParticipant(participant: RuntimeParticipant) {
  await callStore<RuntimeParticipant>({ op: "saveParticipant", participant });
  return participant;
}

export async function updateParticipant(participantId: string, patch: Partial<RuntimeParticipant>) {
  return callStore<RuntimeParticipant>({ op: "updateParticipant", participantId, patch });
}

export async function appendParticipantSession(participantId: string, runtimeSessionId: string) {
  const participant = await getParticipant(participantId);
  if (!participant) throw new Error("Participant not found");
  return updateParticipant(participantId, {
    runtimeSessionIds: [...new Set([...participant.runtimeSessionIds, runtimeSessionId])],
  });
}

export async function getLongitudinalRecord(participantId: string) {
  return getLocalDb().longitudinalRecords.where("participantId").equals(participantId).first();
}

export async function saveLongitudinalRecord(record: LongitudinalRecord) {
  await getLocalDb().longitudinalRecords.put(record);
  return record;
}

export async function saveParticipantConsentEvent(event: ParticipantConsentEvent) {
  await getLocalDb().participantConsentEvents.put(event);
  return event;
}

export async function listParticipantConsentEvents(participantId: string) {
  return getLocalDb().participantConsentEvents.where("participantId").equals(participantId).sortBy("effectiveAt");
}
