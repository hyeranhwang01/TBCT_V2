import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { appendHomeworkEntry, ensureHomeworkForSession } from "@/patient/lib/api/homework-api";
import { DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData } from "@/patient/sessions/s01/distortion-table";
import { listMemoryChunks, listMemoryChunksBySession, setMemoryChunkValidity, suppressMemoryChunk } from "@/shared/data/repositories/memory-chunk-repository";
import { indexAtCompletion } from "@/shared/memory/memory-indexer";
import { installScriptedPromptSession, lastParticipantText, type ScriptedPromptSession } from "@/test/fakes/prompt-session.fake";

// Chunks are written where they happen in a real run: a prompt-driven S01 goes
// to completion through the program (scripted model), its homework is written,
// and S02 starts -- nothing here calls the builder directly.

async function say(sessionId: string, text: string, turn: number) {
  const view = await getRuntimeSession(sessionId);
  await submitPatientInput(sessionId, { kind: "text", value: text }, { clientTurnId: `${sessionId}-${turn}`, expectedSessionVersion: view!.session.version ?? 0 });
}

describe("memory chunks through the runtime", () => {
  let fake: ScriptedPromptSession | undefined;
  afterEach(() => fake?.uninstall());
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
  });

  it("stores a completed S01, then its homework when S02 starts, and only once", async () => {
    fake = installScriptedPromptSession((request) => {
      const said = lastParticipantText(request);
      if (!said) return { reply: "어떤 일이 가장 힘드세요?", focusField: "s01Problems" };
      if (said.includes("회의")) return { reply: "그때 어떤 생각이 스쳤나요?", focusField: "thoughtLine", fieldUpdates: { s01Problems: ["회의에서 말을 못 해요"], situationLine: "팀 회의에서 보고서가 넘어갔다" } };
      if (said.includes("무시")) return { reply: "오늘은 여기까지 할게요.", inputHint: "none", sessionComplete: true, fieldUpdates: { thoughtLine: "팀장님이 나를 무시한다" } };
      return { reply: "어떤 일이 가장 힘드세요?", focusField: "s01Problems" };
    });
    const s01 = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    await startRuntimeSession(s01.id);
    await say(s01.id, "회의에서 말을 하려고 하면 얼어붙어요", 1);
    await say(s01.id, "팀장님이 나를 무시한다는 생각이요", 2);
    const completed = await getRuntimeSession(s01.id);
    expect(completed?.session.status).toBe("completed");

    const stored = await listMemoryChunksBySession(s01.id);
    expect(stored.find((chunk) => chunk.elementKind === "own_case")?.content).toBe("상황: 팀 회의에서 보고서가 넘어갔다\n자동적 사고: 팀장님이 나를 무시한다");
    const episodes = stored.filter((chunk) => chunk.chunkKind === "episode").map((chunk) => chunk.content);
    expect(episodes.join("\n")).toContain("A: 회의에서 말을 하려고 하면 얼어붙어요");
    expect(episodes.join("\n")).toContain("A: 팀장님이 나를 무시한다는 생각이요");
    expect(stored.every((chunk) => chunk.sessionIndex === 1 && chunk.participantId === s01.participantId)).toBe(true);
    expect(completed?.logs.some((log) => log.summary === "Memory chunks stored")).toBe(true);

    // Running it again adds nothing.
    expect((await indexAtCompletion(s01.id)).session.inserted).toBe(0);

    const homework = (await ensureHomeworkForSession(completed!.session))!;
    await appendHomeworkEntry(homework.id, DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData({ distortionId: "mind-reading", date: "2026-09-22", text: "동료가 나를 싫어한다고 생각했다" }));

    const s02 = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR", participantId: s01.participantId });
    await startRuntimeSession(s02.id);
    const earlier = await listMemoryChunks(s01.participantId, { beforeSessionIndex: 2 });
    expect(earlier.filter((chunk) => chunk.chunkKind === "homework").map((chunk) => chunk.content)).toEqual(["과제 (2026-09-22) — 마음읽기 예시: 동료가 나를 싫어한다고 생각했다"]);
    expect(await listMemoryChunks(s01.participantId, { beforeSessionIndex: 1 })).toEqual([]);
  }, 60_000);

  it("keeps a suppressed chunk out of the participant's list, with who and why", async () => {
    fake = installScriptedPromptSession((request) => (lastParticipantText(request) ? { reply: "마칠게요.", inputHint: "none", sessionComplete: true, fieldUpdates: { s01Goal: "회의에서 한 번은 말하기" } } : { reply: "목표가 뭔가요?", focusField: "s01Goal" }));
    const s01 = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    await startRuntimeSession(s01.id);
    await say(s01.id, "회의에서 한 번은 말해 보고 싶어요", 1);
    const goal = (await listMemoryChunksBySession(s01.id)).find((chunk) => chunk.elementKind === "goal");
    expect(goal).toBeTruthy();

    const suppressed = await suppressMemoryChunk(goal!.id, "참가자가 수정 요청");
    expect(suppressed).toMatchObject({ suppressed: true, suppressedReason: "참가자가 수정 요청" });
    expect((await listMemoryChunks(s01.participantId)).some((chunk) => chunk.id === goal!.id)).toBe(false);
    expect((await listMemoryChunks(s01.participantId, { includeSuppressed: true })).some((chunk) => chunk.id === goal!.id)).toBe(true);
  }, 60_000);

  it("leaves a chunk marked invalid out until it is marked valid again, keeping the chunk as it was", async () => {
    fake = installScriptedPromptSession((request) => (lastParticipantText(request) ? { reply: "마칠게요.", inputHint: "none", sessionComplete: true, fieldUpdates: { s01Goal: "회의에서 한 번은 말하기" } } : { reply: "목표가 뭔가요?", focusField: "s01Goal" }));
    const s01 = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    await startRuntimeSession(s01.id);
    await say(s01.id, "회의에서 한 번은 말해 보고 싶어요", 1);
    const goal = (await listMemoryChunksBySession(s01.id)).find((chunk) => chunk.elementKind === "goal")!;
    expect(goal).toMatchObject({ author: "participant", layer: "record", sensitivityFlags: [] });
    expect(goal.validity).toBeUndefined();
    const listed = async (options = {}) => (await listMemoryChunks(s01.participantId, options)).some((chunk) => chunk.id === goal.id);

    await expect(setMemoryChunkValidity(goal.id, "invalid", " ")).rejects.toThrow(/reason/);
    expect(await setMemoryChunkValidity(goal.id, "invalid", "참가자가 목표를 바꿈")).toMatchObject({ content: goal.content, validity: { state: "invalid", reason: "참가자가 목표를 바꿈" } });
    expect(await listed()).toBe(false);
    expect(await listed({ includeInvalid: true })).toBe(true);
    expect(await setMemoryChunkValidity(goal.id, "valid", "다시 같은 목표를 말함")).toMatchObject({ validity: { state: "valid" } });
    expect(await listed()).toBe(true);
  }, 60_000);
});
