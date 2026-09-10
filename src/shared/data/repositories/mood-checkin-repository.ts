import { MOOD_CHECKIN_STORE_ENDPOINT } from "@/shared/runtime/mood-checkin-store-ops";
import type { MoodCheckinStoreOp } from "@/shared/runtime/mood-checkin-store-ops";
import { resolveStoreUrl } from "@/shared/runtime/resolve-store-url";
import type { MoodCheckin } from "@/types/mood-checkin";

// Thin fetch client over src/app/api/mood-checkins/store/route.ts,
// matching the pattern of homework-repository.ts / worksheet-repository.ts.
async function callStore<T>(op: MoodCheckinStoreOp): Promise<T> {
  const response = await fetch(resolveStoreUrl(MOOD_CHECKIN_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Mood check-in store operation failed.");
  return body.result as T;
}

export async function upsertMoodCheckin(participantId: string, mood: 1 | 2 | 3 | 4 | 5, note?: string): Promise<MoodCheckin> {
  return callStore<MoodCheckin>({ op: "upsert", participantId, mood, note });
}

export async function listMoodCheckinsByParticipant(participantId: string): Promise<MoodCheckin[]> {
  return callStore<MoodCheckin[]>({ op: "listByParticipant", participantId });
}
