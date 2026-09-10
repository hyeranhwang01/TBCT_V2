import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession } from "@/shared/api/runtime-session-api";
import { getListScoreHistory, projectRuntimeFieldsToWorksheet } from "@/shared/worksheet/worksheet-projection";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";

// getListScoreHistory backs S06's "seeing your progress over time" table
// (s06-worksheet.tsx) -- the cross-run item alignment/totals math is the
// one genuinely risky part of that feature, so it's exercised directly here
// against the real write path (projectRuntimeFieldsToWorksheet) rather than
// only eyeballed in a live session.
describe("getListScoreHistory", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("aligns the same item case-insensitively across runs and computes per-run totals", async () => {
    // createCanonicalTestRuntimeSession never passes an explicit
    // participantId, so both calls resolve to the same get-or-create demo
    // participant (see getOrCreateDemoParticipant) -- exactly the "same
    // participant ran this session twice" case this feature is for.
    const runOne = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s06" });
    await projectRuntimeFieldsToWorksheet({
      runtimeSessionId: runOne.id,
      sessionDefinitionId: "tbct-s06",
      fields: { symptomItems: ["Go to the supermarket", "Touch a door handle"], symptomItemScores: [5, 5] },
    });

    const runTwo = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s06" });
    await projectRuntimeFieldsToWorksheet({
      runtimeSessionId: runTwo.id,
      sessionDefinitionId: "tbct-s06",
      // Re-entered with different case/whitespace and one dropped item, one new one --
      // the exact kind of drift a free-text re-answer produces across runs.
      fields: { symptomItems: [" go to the supermarket ", "Take the escalator"], symptomItemScores: [3, 4] },
    });

    const history = await getListScoreHistory({
      runtimeSessionId: runTwo.id,
      sessionDefinitionId: "tbct-s06",
      itemsWorksheetFieldKey: "symptomItems",
      scoresWorksheetFieldKey: "symptomItemScores",
    });

    expect(history?.runs.map((run) => run.runtimeSessionId)).toEqual([runOne.id, runTwo.id]);
    // First-seen order, original wording from whichever run introduced it.
    expect(history?.rows.map((row) => row.item)).toEqual(["Go to the supermarket", "Touch a door handle", "Take the escalator"]);

    const supermarketRow = history?.rows.find((row) => row.item === "Go to the supermarket");
    expect(supermarketRow?.scoresByRunId[runOne.id]).toBe(5);
    expect(supermarketRow?.scoresByRunId[runTwo.id]).toBe(3);

    const doorHandleRow = history?.rows.find((row) => row.item === "Touch a door handle");
    expect(doorHandleRow?.scoresByRunId[runOne.id]).toBe(5);
    expect(doorHandleRow?.scoresByRunId[runTwo.id]).toBeNull(); // never re-entered in run two

    const escalatorRow = history?.rows.find((row) => row.item === "Take the escalator");
    expect(escalatorRow?.scoresByRunId[runOne.id]).toBeNull(); // didn't exist yet in run one
    expect(escalatorRow?.scoresByRunId[runTwo.id]).toBe(4);

    expect(history?.totalsByRunId[runOne.id]).toBe(10);
    expect(history?.totalsByRunId[runTwo.id]).toBe(7);
  });

  it("returns null for a runtimeSessionId that doesn't exist", async () => {
    const history = await getListScoreHistory({
      runtimeSessionId: "does-not-exist",
      sessionDefinitionId: "tbct-s06",
      itemsWorksheetFieldKey: "symptomItems",
      scoresWorksheetFieldKey: "symptomItemScores",
    });
    expect(history).toBeNull();
  });

  it("returns null when the participant has only run the session once", async () => {
    const runOne = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s06" });
    await projectRuntimeFieldsToWorksheet({
      runtimeSessionId: runOne.id,
      sessionDefinitionId: "tbct-s06",
      fields: { symptomItems: ["Go to the supermarket"], symptomItemScores: [5] },
    });

    const history = await getListScoreHistory({
      runtimeSessionId: runOne.id,
      sessionDefinitionId: "tbct-s06",
      itemsWorksheetFieldKey: "symptomItems",
      scoresWorksheetFieldKey: "symptomItemScores",
    });

    // A single run is a legitimate result from this function (it still
    // returns the one run's own row) -- s06-worksheet.tsx is the one that
    // decides a single-run result isn't worth rendering as "history" yet.
    expect(history?.runs).toHaveLength(1);
    expect(history?.totalsByRunId[runOne.id]).toBe(5);
  });
});
