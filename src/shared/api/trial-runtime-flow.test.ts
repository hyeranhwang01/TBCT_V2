import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput, terminateRuntimeSession } from "@/shared/api/runtime-execution-api";
import { listMemoryChunks, saveMemoryChunks } from "@/shared/data/repositories/memory-chunk-repository";
import { SessionUnavailableError } from "@/shared/trial/runtime-trial";
import { fakeSessionRecords, fakeSetSessionGate, fakeTrialEvents } from "@/test/fakes/trial-store.fake";
import { installScriptedPromptSession, lastParticipantText, type PromptSessionScript, type ScriptedPromptSession } from "@/test/fakes/prompt-session.fake";

// What the session runtime does for the trial (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend), end to end through the fake stores: the gate
// before a session starts, the frozen release's model, the step on each
// message, the sealed record when a session ends (first completed attempt
// official), events, and memory from official attempts only. The trial
// store's own rules are tested on Postgres (src/test/pglite/trial-store.test.ts).

let fake: ScriptedPromptSession | undefined;
function script(fn: PromptSessionScript) {
  fake = installScriptedPromptSession(fn);
  return fake;
}

const completing: PromptSessionScript = (request) => (lastParticipantText(request)
  ? { reply: "오늘 고마웠어요.", inputHint: "none", sessionComplete: true, currentStep: 11 }
  : { reply: "오늘 이렇게 해 볼까요?", inputHint: "yes_no", currentStep: 1 });

/** A participant is created with their first session; pass it on for more. */
async function newSession(participantId?: string) {
  return createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", participantId });
}

async function completedSession(participantId?: string) {
  const session = await newSession(participantId);
  await startRuntimeSession(session.id);
  await submitPatientInput(session.id, { kind: "boolean", value: true });
  return session;
}

beforeEach(async () => {
  const db = getLocalDb();
  await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
});

afterEach(() => {
  fake?.uninstall();
  fake = undefined;
});

describe("trial wiring in the session runtime", () => {
  it("seals a completed session once, official, with the steps the model reported and its model-call events", async () => {
    script(completing);
    const sessionId = (await completedSession()).id;
    const records = fakeSessionRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ runtimeSessionId: sessionId, endStatus: "completed", isOfficialAtWrite: true, moduleNumber: 1, attemptNumber: 1 });
    const snapshot = records[0].snapshot as { fidelity: { highestReportedStep: number; totalSteps: number }; conversation: Array<{ role: string; metadata: { step?: number } }> };
    expect(snapshot.fidelity).toMatchObject({ totalSteps: 11, highestReportedStep: 11 });
    expect(snapshot.conversation.filter((message) => message.role === "assistant").map((message) => message.metadata.step)).toEqual([1, 11]);
    const codes = fakeTrialEvents().map((event) => event.code);
    expect(codes.filter((code) => code === "MODEL_CALL")).toHaveLength(2);
  });

  it("keeps a second completed attempt of the same session, not official", async () => {
    script(completing);
    const first = await completedSession();
    await completedSession(first.participantId);
    expect(fakeSessionRecords().map((record) => [record.attemptNumber, record.isOfficialAtWrite])).toEqual([[1, true], [2, false]]);
  });

  it("seals a terminated session as not official", async () => {
    script(() => ({ reply: "시작할게요", inputHint: "text", currentStep: 1 }));
    const session = await newSession();
    await startRuntimeSession(session.id);
    await terminateRuntimeSession(session.id, "test");
    expect(fakeSessionRecords()).toEqual([expect.objectContaining({ runtimeSessionId: session.id, endStatus: "terminated", isOfficialAtWrite: false })]);
  });

  it("does not start a session the gate refuses, and uses the frozen release's model when it allows", async () => {
    const scripted = script(completing);
    fakeSetSessionGate({ allowed: false, enforced: true, reason: "ai_consent_missing" });
    const refused = await newSession();
    await expect(startRuntimeSession(refused.id)).rejects.toBeInstanceOf(SessionUnavailableError);
    expect((await getRuntimeSession(refused.id))!.messages).toEqual([]);

    fakeSetSessionGate({ allowed: true, enforced: true, studyParticipantId: "SP-5", armCode: "AI_LED", aiReleaseId: "REL-1", modelId: "claude-frozen-1", warnings: [] });
    await completedSession();
    expect(scripted.requests.every((request) => request.model === "claude-frozen-1")).toBe(true);
  });

  it("refuses a participant message once the gate closes mid-session", async () => {
    script(completing);
    const session = await newSession();
    await startRuntimeSession(session.id);
    fakeSetSessionGate({ allowed: false, enforced: true, reason: "withdrawn" });
    await expect(submitPatientInput(session.id, { kind: "boolean", value: true })).rejects.toBeInstanceOf(SessionUnavailableError);
    expect(fakeTrialEvents().map((event) => event.code)).toContain("SESSION_GATE_DENIED");
  });

  it("records rejected values by name only", async () => {
    script((request) => (lastParticipantText(request) ? { reply: "네", inputHint: "text", fieldUpdates: { notAField: "참가자의 말" } } : { reply: "어떠세요?", inputHint: "text" }));
    const session = await newSession();
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "괜찮아요" });
    const rejected = fakeTrialEvents().find((event) => event.code === "FIELD_REJECTED");
    expect(rejected?.detail).toEqual({ fields: [{ name: "notAField", reason: "not a field of this session" }] });
    expect(JSON.stringify(rejected)).not.toContain("참가자의 말");
  });

  it("offers memory from the official attempt of a repeated session only (homework always)", async () => {
    script(completing);
    const first = (await completedSession()).id;
    const second = (await completedSession((await getRuntimeSession(first))!.session.participantId)).id;
    const participantId = (await getRuntimeSession(first))!.session.participantId;
    const chunk = (id: string, runtimeSessionId: string, chunkKind: string) => ({
      id, participantId, runtimeSessionId, sessionDefinitionId: "tbct-s01", sessionIndex: 1, chunkKind, elementKind: "problem", fieldNames: [], sourceMessageIds: [], sourceRef: id,
      content: id, locale: "ko-KR", indexVersion: "test", sourceCreatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    });
    await saveMemoryChunks([chunk("C-first", first, "worksheet"), chunk("C-second", second, "worksheet"), chunk("C-homework", second, "homework")] as never);
    const offered = (await listMemoryChunks(participantId, { officialAttemptsOnly: true })).map((item) => item.id).filter((id) => id.startsWith("C-"));
    expect(offered.sort()).toEqual(["C-first", "C-homework"]);
    const all = (await listMemoryChunks(participantId)).map((item) => item.id).filter((id) => id.startsWith("C-"));
    expect(all).toHaveLength(3);
  });
});
