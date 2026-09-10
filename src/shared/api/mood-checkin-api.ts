import { upsertMoodCheckin, listMoodCheckinsByParticipant } from "@/shared/data/repositories/mood-checkin-repository";
import type { MoodCheckin } from "@/types/mood-checkin";

export async function submitMoodCheckin(participantId: string, mood: 1 | 2 | 3 | 4 | 5): Promise<MoodCheckin> {
  return upsertMoodCheckin(participantId, mood);
}

export async function listMoodCheckins(participantId: string): Promise<MoodCheckin[]> {
  return listMoodCheckinsByParticipant(participantId);
}
