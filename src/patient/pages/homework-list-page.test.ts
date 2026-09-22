import { describe, expect, it } from "vitest";
import { groupSessionsByDefinition } from "@/patient/pages/homework-list-page";

/**
 * The defect this guards against: repeating a session (e.g. running S01
 * twice) creates a second RuntimeSession row with the same
 * sessionDefinitionId. Before this grouping existed, the homework list
 * showed both under the identical label with nothing but the date to tell
 * them apart (Sheet W1 "세션 반복 시 숙제 누적 구분" request, 2026-09-16).
 * This tests only the pure grouping/round-numbering function, not the page
 * component or any network call.
 */
describe("groupSessionsByDefinition", () => {
  const session = (id: string, sessionDefinitionId: string, createdAt: string) => ({
    id,
    sessionDefinitionId,
    status: "completed",
    createdAt,
    updatedAt: createdAt,
  });

  it("keeps a single round ungrouped and numbered 1", () => {
    const groups = groupSessionsByDefinition([session("a", "tbct-s01", "2026-09-11T00:00:00Z")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rounds).toHaveLength(1);
    expect(groups[0].rounds[0].round).toBe(1);
  });

  it("numbers repeated sessions of the same definition in creation order, independent of display order", () => {
    // Caller passes them newest-first (as the page does after sorting by
    // updatedAt desc) -- round numbers must still reflect createdAt order.
    const newestFirst = [
      session("third", "tbct-s01", "2026-09-20T00:00:00Z"),
      session("second", "tbct-s01", "2026-09-15T00:00:00Z"),
      session("first", "tbct-s01", "2026-09-11T00:00:00Z"),
    ];
    const groups = groupSessionsByDefinition(newestFirst);
    expect(groups).toHaveLength(1);
    const byId = Object.fromEntries(groups[0].rounds.map((r) => [r.id, r.round]));
    expect(byId).toEqual({ third: 3, second: 2, first: 1 });
    // Display order (rounds array) stays newest-first, matching the input.
    expect(groups[0].rounds.map((r) => r.id)).toEqual(["third", "second", "first"]);
  });

  it("keeps different sessionDefinitionIds in separate groups, each numbered independently", () => {
    const mixed = [
      session("s02-b", "tbct-s02", "2026-09-18T00:00:00Z"),
      session("s01-a", "tbct-s01", "2026-09-11T00:00:00Z"),
      session("s02-a", "tbct-s02", "2026-09-16T00:00:00Z"),
    ];
    const groups = groupSessionsByDefinition(mixed);
    // Group order follows first-occurrence order in the input list.
    expect(groups.map((g) => g.sessionDefinitionId)).toEqual(["tbct-s02", "tbct-s01"]);
    const s02 = groups.find((g) => g.sessionDefinitionId === "tbct-s02")!;
    expect(Object.fromEntries(s02.rounds.map((r) => [r.id, r.round]))).toEqual({ "s02-b": 2, "s02-a": 1 });
  });
});
