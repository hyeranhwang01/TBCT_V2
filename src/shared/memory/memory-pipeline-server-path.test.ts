import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { completeRuntimeSession, startRuntimeSession } from "@/shared/api/runtime-execution-api";
import { getRuntimeSessionSummary } from "@/shared/api/session-summary-api";
import { listLongitudinalMemories } from "@/shared/data/repositories/longitudinal-memory-repository";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";

// The same pipeline driven through the real runtime (session creation ->
// start -> completion) against the offline store fakes. The memory-related
// stores are the ones a patient's SERVER turn hits, so globalThis.indexedDB
// is removed for the memory calls here as well.

let summaryShouldFail = false;
vi.mock("@/shared/api/session-summary-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/session-summary-api")>();
  return {
    ...actual,
    generateSessionSummary: async (sessionId: string) => {
      if (summaryShouldFail) throw new Error("simulated summary failure");
      return actual.generateSessionSummary(sessionId);
    } };
});

let savedIndexedDb: unknown;

beforeEach(async () => {
  summaryShouldFail = false;
  const db = getLocalDb();
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
  savedIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

afterEach(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = savedIndexedDb;
});

describe("memory pipeline through the runtime, without IndexedDB", () => {
  it("completes the session with a stored summary (stage 1 now runs where the turn runs)", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    await startRuntimeSession(session.id);

    await completeRuntimeSession(session.id);

    const summary = await getRuntimeSessionSummary(session.id);
    expect(summary).toMatchObject({ runtimeSessionId: session.id, participantId: session.participantId, summaryStatus: "draft" });
    expect((await getRuntimeSession(session.id))?.session.status).toBe("completed");
    expect(await listLongitudinalMemories(session.participantId)).toEqual([]);
  });

  it("still completes the session when the memory step fails, and says so in the runtime log", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    summaryShouldFail = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(completeRuntimeSession(session.id)).resolves.toBeDefined();

    errorSpy.mockRestore();
    const view = await getRuntimeSession(session.id);
    expect(view?.session.status).toBe("completed");
    expect(await getRuntimeSessionSummary(session.id)).toBeUndefined();
    expect(view?.logs.some((log) => log.stage === "completion" && log.status === "failed" && log.error === "simulated summary failure")).toBe(true);
  });
});
