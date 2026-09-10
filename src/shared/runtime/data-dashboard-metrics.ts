export interface WeeklyCount {
  weekLabel: string;
  count: number;
}

/**
 * Buckets timestamped items into the last `weeks` calendar weeks (Monday-
 * start, UTC), ending with the current week, oldest first. A week with zero
 * items still appears as a 0 -- a genuinely quiet week reads as "quiet" on
 * the chart, not as a gap that looks like missing data.
 */
export function bucketByWeek(items: Array<{ createdAt: string }>, weeks: number): WeeklyCount[] {
  const now = new Date();
  const startOfThisWeek = new Date(now);
  const day = startOfThisWeek.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = (day + 6) % 7;
  startOfThisWeek.setUTCDate(startOfThisWeek.getUTCDate() - diffToMonday);
  startOfThisWeek.setUTCHours(0, 0, 0, 0);

  const timestamps = items.map((item) => new Date(item.createdAt).getTime()).filter((value) => !Number.isNaN(value));

  const buckets: WeeklyCount[] = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekStart = new Date(startOfThisWeek);
    weekStart.setUTCDate(weekStart.getUTCDate() - index * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    const count = timestamps.filter((value) => value >= weekStart.getTime() && value < weekEnd.getTime()).length;
    buckets.push({ weekLabel: `${weekStart.getUTCMonth() + 1}/${weekStart.getUTCDate()}`, count });
  }
  return buckets;
}
