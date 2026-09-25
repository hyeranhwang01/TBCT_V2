import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getPatientRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { latestPatientThemes } from "@/shared/runtime/conversation-steering";
import { EXPLORE_TRIGGER, FAKE_EXPLORATION_QUESTION } from "@/test/fakes/dialogue-agent.fake";
import type { RuntimeMessage } from "@/types/runtime-session";

// Adaptive dialogue (.claude/TASK_SCOPE.json note2026_09_15_olivia_persona),
// end to end through the real node-engine turn pipeline with the fake dialogue
// agent. Run on S06 since S01 became prompt-driven
// (note2026_09_25_prompt_driven_s01_s02) -- the mechanism is the same:
// the counselor follows what the participant brings up -- the tester's own
// sequence of principles, parenting and self-image -- for at most two turns
// before the waiting task, without storing those replies as answers, and keeps
// the participant's own phrases across the session.

async function current(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error(`Session ${sessionId} not found.`);
  return view;
}

function slugOf(view: NonNullable<Awaited<ReturnType<typeof getRuntimeSession>>>) {
  const id = view.currentPromptItem?.id;
  return id ? (/^tbct-s06-n\d+-p\d+-(.+)$/.exec(id)?.[1] ?? null) : null;
}

function lastAssistant(messages: RuntimeMessage[]) {
  const message = [...messages].reverse().find((item) => item.role === "assistant");
  if (!message) throw new Error("No assistant message yet.");
  return message;
}

/** S06, past its warm opening: the next answer goes to the symptom list, and
 * the task after it (concrete-actions) is the one exploration holds back. */
async function startS06() {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s06", locale: "ko-KR" });
  await startRuntimeSession(session.id);
  await submitPatientInput(session.id, { kind: "text", value: "요즘 사람 많은 곳에 가면 긴장돼요" });
  return session.id;
}

describe("Adaptive dialogue: the conversation follows what the participant brings up", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("explores for up to two turns while the next task waits, stores none of those replies, then asks the task", async () => {
    const sessionId = await startS06();
    expect(slugOf(await current(sessionId))).toBe("symptom-list-opening");

    await submitPatientInput(sessionId, { kind: "text", value: `예전에 중요했던 원칙이 지금은 부질없게 느껴져요 ${EXPLORE_TRIGGER}` });
    let view = await current(sessionId);
    // The answer is recorded and the program moves on as always...
    expect(String(view.session.runtimeContext.fields.symptomItems)).toContain("원칙이 지금은 부질없게");
    expect(slugOf(view)).toBe("concrete-actions");
    // ...but this turn follows what they said instead of asking the next task.
    let turn = lastAssistant(view.messages);
    expect(turn.content).toBe(FAKE_EXPLORATION_QUESTION.ko);
    expect(turn.metadata?.pendingExploration).toMatchObject({ status: "pending", turn: 1 });
    // It is answered in their own words, whatever the waiting task's input is.
    expect((await getPatientRuntimeSession(sessionId))?.currentPromptInput).toMatchObject({ type: "question", validation: null });
    const recorded = JSON.stringify(view.session.runtimeContext.fields);

    await submitPatientInput(sessionId, { kind: "text", value: `아이 훈육할 때 제 욕심이 보여요 ${EXPLORE_TRIGGER}` });
    view = await current(sessionId);
    turn = lastAssistant(view.messages);
    expect(turn.metadata).toMatchObject({ turnOutcome: "exploration", pendingExploration: { turn: 2 } });
    expect(JSON.stringify(view.session.runtimeContext.fields)).toBe(recorded);
    expect(slugOf(view)).toBe("concrete-actions");

    // A third follow-up would pass the per-task limit: the waiting task is asked.
    await submitPatientInput(sessionId, { kind: "text", value: `이 나이면 이래야 한다는 모습과 지금의 저 사이에 간극이 커요 ${EXPLORE_TRIGGER}` });
    view = await current(sessionId);
    turn = lastAssistant(view.messages);
    expect(turn.metadata?.pendingExploration).toBeUndefined();
    expect(turn.content).not.toBe(FAKE_EXPLORATION_QUESTION.ko);
    expect(JSON.stringify(view.session.runtimeContext.fields)).toBe(recorded);
    expect(slugOf(view)).toBe("concrete-actions");

    // The next reply answers that task again, and is stored.
    await submitPatientInput(sessionId, { kind: "text", value: "아침에 일어날 때 아무것도 하기 싫어요" });
    view = await current(sessionId);
    expect(String(view.session.runtimeContext.fields.symptomItems)).toContain("아침에 일어날 때");
  }, 30_000);

  it("does not explore without being asked to by the dialogue agent: an ordinary answer moves straight to the task", async () => {
    const sessionId = await startS06();
    await submitPatientInput(sessionId, { kind: "text", value: "요즘 잠을 잘 못 자요" });
    const view = await current(sessionId);
    expect(lastAssistant(view.messages).metadata?.pendingExploration).toBeUndefined();
    expect(slugOf(view)).toBe("concrete-actions");
  }, 30_000);

  it("keeps the participant's own phrases as themes across later turns", async () => {
    const sessionId = await startS06();
    await submitPatientInput(sessionId, { kind: "text", value: "아이 훈육에서의 욕심이 보여요 #주제:훈육에서의 욕심#" });
    let view = await current(sessionId);
    expect(lastAssistant(view.messages).metadata?.patientThemes).toEqual(["훈육에서의 욕심"]);

    await submitPatientInput(sessionId, { kind: "text", value: "아침에 일어날 때 아무것도 하기 싫어요" });
    view = await current(sessionId);
    expect(lastAssistant(view.messages).metadata?.patientThemes).toBeUndefined();
    expect(latestPatientThemes(view.messages)).toEqual(["훈육에서의 욕심"]);
  }, 30_000);
});
