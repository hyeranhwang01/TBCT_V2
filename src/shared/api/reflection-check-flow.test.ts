import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getPatientRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { SUMMARY_CHECK_TRIGGER } from "@/test/fakes/dialogue-agent.fake";
import type { RuntimeMessage } from "@/types/runtime-session";

// Reflect-and-Confirm (.claude/TASK_SCOPE.json note2026_09_11), end to end
// through the real turn pipeline with the fake dialogue agent: an assistant
// summary ends with "did I get that right?" and holds back the next task;
// the participant's reply to it is never stored as a clinical answer.

const CONFIRM_KO = "제가 제대로 이해했나요?";
const THOUGHT = `상사가 저를 무능하다고 생각하는 것 같았어요 ${SUMMARY_CHECK_TRIGGER}`;

async function current(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error(`Session ${sessionId} not found.`);
  return view;
}

function lastAssistant(messages: RuntimeMessage[]) {
  const message = [...messages].reverse().find((item) => item.role === "assistant");
  if (!message) throw new Error("No assistant message yet.");
  return message;
}

/** S03 up to the automatic thought, answered with the fake's summary trigger. */
async function reachSummaryCheck() {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
  await startRuntimeSession(session.id);
  await submitPatientInput(session.id, { kind: "text", value: "괜찮아요, 특별히 급한 건 없어요" }); // safety-check
  await submitPatientInput(session.id, { kind: "text", value: "네" }); // redirection-contract
  await submitPatientInput(session.id, { kind: "text", value: "네" }); // worksheet-readiness-check
  await submitPatientInput(session.id, { kind: "text", value: "상사가 회의에서 보고서 수정이 필요하다고 말했어요" }); // situation
  await submitPatientInput(session.id, { kind: "text", value: THOUGHT }); // automatic thought
  return session.id;
}

describe("Reflect-and-Confirm: an assistant summary is confirmed before the session moves on", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("the summary turn ends with the confirmation question, and a plain yes brings back the held-back task without storing anything", async () => {
    const sessionId = await reachSummaryCheck();
    let view = await current(sessionId);
    const heldBackPromptId = view.currentPromptItem?.id;
    const summaryTurn = lastAssistant(view.messages);
    expect(summaryTurn.content.endsWith(CONFIRM_KO)).toBe(true);
    expect(summaryTurn.content).toContain("상사가 저를 무능하다고 생각하는 것 같았어요");
    expect(summaryTurn.metadata?.reflectionCheck).toMatchObject({ status: "pending", attempt: 1, aboutPromptItemId: "tbct-s03-n04-p01-automatic-thought" });
    expect(view.session.runtimeContext.fields.automaticThought).toBe(THOUGHT);
    const fieldsBefore = { ...view.session.runtimeContext.fields };
    // While the check is open the patient page gets a free-text box, not the
    // held-back prompt's own control (which may be a 0-100 rating input).
    expect((await getPatientRuntimeSession(sessionId))?.currentPromptInput).toMatchObject({ type: "question", validation: null });

    const result = await submitPatientInput(sessionId, { kind: "text", value: "네" });
    expect(result.sessionStatus).toBe("waiting_for_input");
    view = await current(sessionId);
    expect(view.currentPromptItem?.id).toBe(heldBackPromptId);
    expect((await getPatientRuntimeSession(sessionId))?.currentPromptInput?.validation).toEqual(view.currentPromptItem?.validation);
    expect(view.session.runtimeContext.fields).toEqual(fieldsBefore);
    expect(view.session.runtimeContext.clarificationAttemptCount ?? 0).toBe(0);
    const taskTurn = lastAssistant(view.messages);
    expect(taskTurn.metadata?.reflectionCheckResolution).toMatchObject({ outcome: "confirmed", summaries: 1 });
    expect(taskTurn.metadata?.reflectionCheck).toBeUndefined();
    expect(taskTurn.content).not.toContain(CONFIRM_KO);

    // The next reply is an ordinary answer again, not another check reply.
    await submitPatientInput(sessionId, { kind: "text", value: "70" });
    view = await current(sessionId);
    expect(lastAssistant(view.messages).metadata?.turnOutcome).not.toBe("reflection_check");
  }, 20_000);

  it("a bare no gets one 'which part felt different?', a correction gets one revised summary, and after that the participant's words stand", async () => {
    const sessionId = await reachSummaryCheck();
    let view = await current(sessionId);
    const heldBackPromptId = view.currentPromptItem?.id;

    await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
    view = await current(sessionId);
    let turn = lastAssistant(view.messages);
    expect(turn.content).toBe("어떤 부분이 다르게 느껴지셨는지 말씀해 주시겠어요?");
    expect(turn.metadata?.reflectionCheck).toMatchObject({ status: "pending", attempt: 1, askedWhatDiffers: true });

    await submitPatientInput(sessionId, { kind: "text", value: "사실은 상사가 저한테 실망했다고 생각했어요" });
    view = await current(sessionId);
    turn = lastAssistant(view.messages);
    expect(turn.content.endsWith(CONFIRM_KO)).toBe(true);
    expect(turn.content).toContain("상사가 저한테 실망했다고 생각했어요");
    expect(turn.metadata?.reflectionCheck).toMatchObject({ status: "pending", attempt: 2 });

    await submitPatientInput(sessionId, { kind: "text", value: "아니에요 그게 아니라 저를 못 믿는다고 느꼈어요" });
    view = await current(sessionId);
    turn = lastAssistant(view.messages);
    expect(turn.content.startsWith("알겠습니다. 말씀해 주신 그대로 두고 다음으로 넘어갈게요.")).toBe(true);
    expect(turn.metadata?.reflectionCheckResolution).toMatchObject({ outcome: "left_as_participant_words", summaries: 2 });
    expect(turn.metadata?.reflectionCheck).toBeUndefined();

    // None of the three replies touched the record or the protocol position.
    expect(view.session.runtimeContext.fields.automaticThought).toBe(THOUGHT);
    expect(Object.values(view.session.runtimeContext.fields)).not.toContain("아니요");
    expect(view.currentPromptItem?.id).toBe(heldBackPromptId);
    expect(view.session.runtimeContext.clarificationAttemptCount ?? 0).toBe(0);
  }, 20_000);

  it("a structured answer to the held-back prompt (a rating) is processed as that prompt's answer, not as a reply to the check", async () => {
    const sessionId = await reachSummaryCheck();
    let view = await current(sessionId);
    const heldBack = view.currentPromptItem;
    expect((heldBack?.validation as { kind?: string } | null)?.kind).toBe("rating");
    const field = heldBack!.outputFields[0];
    await submitPatientInput(sessionId, { kind: "rating", value: 70 });
    view = await current(sessionId);
    expect(view.session.runtimeContext.fields[field]).toBe(70);
    expect(lastAssistant(view.messages).metadata?.turnOutcome).not.toBe("reflection_check");
  }, 20_000);

  it("a genuine risk disclosure while a check is open still takes the immediate safety route", async () => {
    const sessionId = await reachSummaryCheck();
    const result = await submitPatientInput(sessionId, { kind: "text", value: "지금 너무 힘들어서 죽고 싶어요" });
    expect(result.safetyResult.triggered).toBe(true);
    expect(result.stateExtraction?.riskLevel).toBe("high");
    expect(result.sessionStatus).toBe("escalated");
  }, 20_000);

  it("without a summary, the turn after an answer is an ordinary task turn with no check opened", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "괜찮아요, 특별히 급한 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "네" });
    await submitPatientInput(session.id, { kind: "text", value: "네" });
    await submitPatientInput(session.id, { kind: "text", value: "상사가 회의에서 보고서 수정이 필요하다고 말했어요" });
    const view = await current(session.id);
    const turn = lastAssistant(view.messages);
    expect(turn.metadata?.reflectionCheck).toBeUndefined();
    expect(turn.content).not.toContain(CONFIRM_KO);
  }, 20_000);
});
