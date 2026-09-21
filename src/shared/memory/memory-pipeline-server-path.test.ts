import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { completeRuntimeSession, startRuntimeSession } from "@/shared/api/runtime-execution-api";
import { getRuntimeSessionSummary } from "@/shared/api/session-summary-api";
import { listLongitudinalMemories, listMemoryRetrievalRuns, listMemoryUsageLogs, saveLongitudinalMemory } from "@/shared/data/repositories/longitudinal-memory-repository";
import { getParticipant } from "@/shared/data/repositories/participant-repository";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import type { LongitudinalMemory } from "@/types/longitudinal-memory";

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
    },
  };
});

function approvedMemory(participantId: string, id: string, content: string): LongitudinalMemory {
  const now = new Date().toISOString();
  return {
    id,
    participantId,
    projectId: "TBCT-BR-001",
    memoryType: "treatment_goal",
    title: "Active treatment goal",
    content,
    status: "approved",
    sensitivity: "standard",
    sourceType: "session_summary",
    sourceSessionId: "RS-earlier",
    sourceMessageIds: [],
    sourceNodeIds: [],
    sourceExecutionLogIds: [],
    isDirectlyReported: true,
    isSystemDerived: false,
    validFrom: now,
    retentionPolicyId: "RET-GOAL",
    createdAt: now,
    updatedAt: now,
    createdBy: "System",
  };
}

// No policy setup here on purpose: cross-session memory is always on
// (memory-policy.ts), so the shipped default config is what these tests
// exercise. If an off switch is ever reintroduced, these fail.
const savedPolicyEnv = process.env.LONGITUDINAL_MEMORY_POLICY;
beforeEach(() => { delete process.env.LONGITUDINAL_MEMORY_POLICY; });
afterEach(() => { if (savedPolicyEnv !== undefined) process.env.LONGITUDINAL_MEMORY_POLICY = savedPolicyEnv; });

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
  it("retrieves an approved memory at session start, carries it (with ids) on the session, and logs the retrieval", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    expect((await getParticipant(session.participantId))?.consent.crossSessionUseAllowed).toBe(true);
    await saveLongitudinalMemory(approvedMemory(session.participantId, "MEM-earlier-goal", "아침에 10분 산책하기"));

    await startRuntimeSession(session.id);

    const view = await getRuntimeSession(session.id);
    expect(view?.session.runtimeContext.longitudinalMemory?.treatmentGoals).toEqual(["아침에 10분 산책하기"]);
    expect(view?.session.runtimeContext.longitudinalMemory?.items).toEqual([{ id: "MEM-earlier-goal", type: "treatment_goal", content: "아침에 10분 산책하기" }]);
    const runs = await listMemoryRetrievalRuns(session.id);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((run) => run.selectedMemoryIds.includes("MEM-earlier-goal"))).toBe(true);
    expect((await listMemoryUsageLogs(session.id)).some((log) => log.memoryId === "MEM-earlier-goal")).toBe(true);
    // Retrieval is no longer silently swallowed: a failed or skipped
    // retrieval writes a runtime log. A successful one writes none.
    expect(view?.logs.filter((log) => log.summary.startsWith("Memory retrieval"))).toEqual([]);
  });

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
