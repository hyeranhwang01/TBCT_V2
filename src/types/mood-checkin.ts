// Daily mood check-ins -- see sql/013_mood_checkins.sql for the schema and
// src/shared/mood-checkins/streak.ts for the streak calculation.

export interface MoodCheckin {
  id: string;
  participantId: string;
  /** "YYYY-MM-DD", always in Asia/Seoul -- see
   * src/shared/data/server/mood-checkin-store.ts's todayInSeoul(). One row per
   * participant per day; a same-day resubmission updates this row rather
   * than creating a new one (sql/013's UNIQUE constraint). */
  checkinDate: string;
  mood: 1 | 2 | 3 | 4 | 5;
  note?: string;
  createdAt: string;
  updatedAt: string;
}
