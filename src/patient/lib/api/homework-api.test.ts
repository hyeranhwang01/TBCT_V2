import { describe, expect, it } from "vitest";
import { ensureHomeworkRecord, getHomeworkRecord, updateHomeworkRecord, appendHomeworkEntry, listHomeworkEntries } from "@/shared/data/repositories/homework-repository";
import { HOMEWORK_CATEGORY_BY_SESSION, HOMEWORK_LABEL_BY_SESSION, hasHomeworkActivity } from "@/types/homework";

describe("homework labels/categories", () => {
  it("covers exactly the eight canonical sessions", () => {
    for (let n = 1; n <= 8; n += 1) {
      const id = `tbct-s${String(n).padStart(2, "0")}`;
      expect(hasHomeworkActivity(id)).toBe(true);
      expect(HOMEWORK_LABEL_BY_SESSION[id]).toBeTruthy();
      expect(["ongoing", "action_plan", "review"]).toContain(HOMEWORK_CATEGORY_BY_SESSION[id]);
    }
    expect(hasHomeworkActivity("tbct-s09")).toBe(false);
  });
});

describe("homework store: record + entry lifecycle", () => {
  it("creates a record once (idempotent ensure), updates it, and accumulates ongoing entries", async () => {
    const first = await ensureHomeworkRecord({ runtimeSessionId: "RTS-test-1", sessionDefinitionId: "tbct-s06", participantId: "participant-1", initialStatus: "in_progress" });
    const second = await ensureHomeworkRecord({ runtimeSessionId: "RTS-test-1", sessionDefinitionId: "tbct-s06", participantId: "participant-1", initialStatus: "in_progress" });
    expect(second.id).toBe(first.id);

    const fetched = await getHomeworkRecord("RTS-test-1");
    expect(fetched?.id).toBe(first.id);

    const updated = await updateHomeworkRecord(first.id, { data: { note: "hello" } });
    expect(updated.data.note).toBe("hello");

    await appendHomeworkEntry(first.id, "try", { itemLabel: "Ask a question in a meeting", before: 3, after: 2 });
    await appendHomeworkEntry(first.id, "try", { itemLabel: "Ask a question in a meeting", before: 2, after: 1 });
    const tries = await listHomeworkEntries(first.id, "try");
    expect(tries).toHaveLength(2);
    expect(tries[0].data.before).toBe(3);
  });

  it("keeps entries scoped to their own record", async () => {
    const recordA = await ensureHomeworkRecord({ runtimeSessionId: "RTS-test-a", sessionDefinitionId: "tbct-s08", participantId: "participant-2", initialStatus: "in_progress" });
    const recordB = await ensureHomeworkRecord({ runtimeSessionId: "RTS-test-b", sessionDefinitionId: "tbct-s08", participantId: "participant-2", initialStatus: "in_progress" });
    await appendHomeworkEntry(recordA.id, "appeal", { beliefBefore: 40, beliefAfter: 25 });
    await appendHomeworkEntry(recordB.id, "appeal", { beliefBefore: 60, beliefAfter: 55 });
    expect(await listHomeworkEntries(recordA.id, "appeal")).toHaveLength(1);
    expect(await listHomeworkEntries(recordB.id, "appeal")).toHaveLength(1);
    expect((await listHomeworkEntries(recordA.id, "appeal"))[0].data.beliefBefore).toBe(40);
  });
});
