// Shared client/server contract for the mood check-in store (Postgres,
// sql/013_mood_checkins.sql). Mirrors the pattern in
// homework-store-ops.ts: no server-only imports, safe from both the
// repository client and the server-side store implementation.
export type MoodCheckinStoreOp =
  | { op: "upsert"; participantId: string; mood: 1 | 2 | 3 | 4 | 5; note?: string }
  | { op: "listByParticipant"; participantId: string };

export const MOOD_CHECKIN_STORE_ENDPOINT = "/api/mood-checkins/store";
