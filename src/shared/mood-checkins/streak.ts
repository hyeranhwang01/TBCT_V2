import type { MoodCheckin } from "@/types/mood-checkin";

/** Today's date as "YYYY-MM-DD" in Asia/Seoul -- same timezone convention
 * as src/lib/server/mood-checkin-store.ts's todayInSeoul(), duplicated
 * here (not imported) since that one lives in a server-only module and
 * this needs to run in the browser too, for immediate UI feedback before
 * a round trip. */
export function todayInSeoul(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function addDays(iso: string, delta: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Consecutive-day streak ending today, counting backward. If today
 * hasn't been checked in yet, counts backward from yesterday instead --
 * a streak shouldn't look broken just because the patient hasn't opened
 * the app yet today. Pure function (takes "today" as a parameter) so it's
 * testable without mocking the clock. */
export function computeStreak(checkins: MoodCheckin[], today: string): number {
  const dates = new Set(checkins.map((checkin) => checkin.checkinDate));
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
