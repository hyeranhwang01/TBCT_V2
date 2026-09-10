import { describe, expect, it } from "vitest";
import { bucketByWeek } from "@/shared/runtime/data-dashboard-metrics";

describe("bucketByWeek", () => {
  it("returns exactly `weeks` buckets, oldest first, including zero-count weeks", () => {
    const buckets = bucketByWeek([], 4);
    expect(buckets).toHaveLength(4);
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("counts an item into the bucket for its own calendar week, not a neighboring one", () => {
    const now = new Date();
    const thisWeekMonday = new Date(now);
    const diffToMonday = (thisWeekMonday.getUTCDay() + 6) % 7;
    thisWeekMonday.setUTCDate(thisWeekMonday.getUTCDate() - diffToMonday);
    thisWeekMonday.setUTCHours(12, 0, 0, 0);

    const lastWeek = new Date(thisWeekMonday);
    lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);

    const buckets = bucketByWeek(
      [{ createdAt: thisWeekMonday.toISOString() }, { createdAt: lastWeek.toISOString() }, { createdAt: lastWeek.toISOString() }],
      3,
    );
    // Oldest-first: [2 weeks ago, last week, this week]
    expect(buckets[0].count).toBe(0);
    expect(buckets[1].count).toBe(2);
    expect(buckets[2].count).toBe(1);
  });

  it("ignores unparseable timestamps instead of throwing", () => {
    expect(() => bucketByWeek([{ createdAt: "not-a-date" }], 2)).not.toThrow();
  });
});
