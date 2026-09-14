import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getPatientRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import { ADDED_MEANING_TRIGGER, SUMMARY_CHECK_TRIGGER, TENTATIVE_TRIGGER, fakeSummaryText } from "@/test/fakes/dialogue-agent.fake";
import type { RuntimeMessage } from "@/types/runtime-session";

// Confirmation re-asks end to end through the real turn pipeline with the
// fake dialogue agent (Reflect-and-Confirm, note2026_09_11, as changed by open
// dialogue v1, note2026_09_14): a summary turn ends in a question and holds
// back the next task; "no" is answered with "could you tell me again?" and the
// check repeats until the participant confirms or asks to move on; a
// confirmed summary of a long answer replaces it on the record and the
// worksheet, with the original kept.

const FAKE_QUESTION_KO = "이렇게 이해하면 될까요?";
const ASK_AGAIN_KO = "그럼 다시 말씀해 주시겠어요?";
const THOUGHT = `상사가 저를 무능하다고 생각하는 것 같았어요 ${SUMMARY_CHECK_TRIGGER}`;
const LONG_THOUGHT = `상사가 회의에서 제 보고서를 보고 한숨을 쉬었는데, 그때 저를 무능하다고 생각하는 것 같았어요 ${SUMMARY_CHECK_TRIGGER}`;

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
async function reachSummaryCheck(thought = THOUGHT) {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
  await startRuntimeSession(session.id);
  await submitPatientInput(session.id, { kind: "text", value: "괜찮아요, 특별히 급한 건 없어요" }); // safety-check
  await submitPatientInput(session.id, { kind: "text", value: "네" }); // redirection-contract
  await submitPatientInput(session.id, { kind: "text", value: "네" }); // worksheet-readiness-check
  await submitPatientInput(session.id, { kind: "text", value: "상사가 회의에서 보고서 수정이 필요하다고 말했어요" }); // situation
  await submitPatientInput(session.id, { kind: "text", value: thought }); // automatic thought
  return session.id;
}

describe("Confirmation re-asks: an assistant summary is confirmed before the session moves on", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("the summary turn ends in a question, and a plain yes brings back the held-back task; a short answer stays as given", async () => {
    const sessionId = await reachSummaryCheck();
    let view = await current(sessionId);
    const heldBackPromptId = view.currentPromptItem?.id;
    const summaryTurn = lastAssistant(view.messages);
    expect(summaryTurn.content.endsWith(FAKE_QUESTION_KO)).toBe(true);
    expect(summaryTurn.content).toContain("상사가 저를 무능하다고 생각하는 것 같았어요");
    expect(summaryTurn.metadata?.reflectionCheck).toMatchObject({ status: "pending", attempt: 1, aboutPromptItemId: "tbct-s03-n04-p01-automatic-thought" });
    expect((summaryTurn.metadata?.reflectionCheck as { summaryTarget?: unknown }).summaryTarget).toBeUndefined();
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
    expect((taskTurn.metadata?.reflectionCheckResolution as { recordedSummary?: unknown }).recordedSummary).toBeUndefined();
    expect(taskTurn.metadata?.reflectionCheck).toBeUndefined();
    expect(taskTurn.content).not.toContain(FAKE_QUESTION_KO);

    // The next reply is an ordinary answer again, not another check reply.
    await submitPatientInput(sessionId, { kind: "text", value: "70" });
    view = await current(sessionId);
    expect(lastAssistant(view.messages).metadata?.turnOutcome).not.toBe("reflection_check");
  }, 20_000);

  it("a bare no gets 'could you tell me again?', and corrections are re-summarized as many times as it takes, until a yes", async () => {
    const sessionId = await reachSummaryCheck();
    let view = await current(sessionId);
    const heldBackPromptId = view.currentPromptItem?.id;

    await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
    view = await current(sessionId);
    let turn = lastAssistant(view.messages);
    expect(turn.content).toBe(ASK_AGAIN_KO);
    expect(turn.metadata?.reflectionCheck).toMatchObject({ status: "pending", attempt: 1, askedAgain: true });

    const corrections = ["사실은 상사가 저한테 실망했다고 생각했어요", "아니에요 그게 아니라 저를 못 믿는다고 느꼈어요", "그보다는 제가 일을 못 한다고 본다고 느꼈어요"];
    for (const [index, correction] of corrections.entries()) {
      await submitPatientInput(sessionId, { kind: "text", value: correction });
      view = await current(sessionId);
      turn = lastAssistant(view.messages);
      expect(turn.content.endsWith(FAKE_QUESTION_KO)).toBe(true);
      expect(turn.content).toContain(correction);
      expect(turn.metadata?.reflectionCheck).toMatchObject({ status: "pending", attempt: index + 2 });
    }

    await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
    view = await current(sessionId);
    expect(lastAssistant(view.messages).content).toBe(ASK_AGAIN_KO);

    await submitPatientInput(sessionId, { kind: "text", value: "네 맞아요" });
    view = await current(sessionId);
    turn = lastAssistant(view.messages);
    expect(turn.metadata?.reflectionCheckResolution).toMatchObject({ outcome: "confirmed", summaries: 4 });
    expect(turn.metadata?.reflectionCheck).toBeUndefined();

    // None of the replies moved the protocol position or counted as a clarification.
    expect(view.session.runtimeContext.fields.automaticThought).toBe(THOUGHT);
    expect(Object.values(view.session.runtimeContext.fields)).not.toContain("아니요");
    expect(view.currentPromptItem?.id).toBe(heldBackPromptId);
    expect(view.session.runtimeContext.clarificationAttemptCount ?? 0).toBe(0);
  }, 30_000);

  it("asking to move on ends the check with the participant's own words standing", async () => {
    const sessionId = await reachSummaryCheck();
    await submitPatientInput(sessionId, { kind: "text", value: "그냥 넘어가요" });
    const view = await current(sessionId);
    const turn = lastAssistant(view.messages);
    expect(turn.content.startsWith("알겠습니다. 말씀해 주신 그대로 두고 다음으로 넘어갈게요.")).toBe(true);
    expect(turn.metadata?.reflectionCheckResolution).toMatchObject({ outcome: "left_as_participant_words", summaries: 1 });
    expect(turn.metadata?.reflectionCheck).toBeUndefined();
    expect(view.session.runtimeContext.fields.automaticThought).toBe(THOUGHT);
  }, 20_000);

  it("a long answer is summarized, and the summary the participant confirms replaces it on the record and the worksheet, with the original kept", async () => {
    const sessionId = await reachSummaryCheck(LONG_THOUGHT);
    let view = await current(sessionId);
    const answer = [...view.messages].reverse().find((message) => message.role === "patient");
    expect(answer?.metadata?.longAnswerSummaryTarget).toMatchObject({ field: "automaticThought", writeField: "automaticThought", originalValue: LONG_THOUGHT });
    const summaryTurn = lastAssistant(view.messages);
    expect(summaryTurn.metadata?.reflectionCheck).toMatchObject({ status: "pending", summaryTarget: { field: "automaticThought" } });
    expect(view.session.runtimeContext.fields.automaticThought).toBe(LONG_THOUGHT);

    await submitPatientInput(sessionId, { kind: "text", value: "네" });
    view = await current(sessionId);
    const summary = fakeSummaryText("ko-KR", LONG_THOUGHT.replace(SUMMARY_CHECK_TRIGGER, "").trim());
    expect(view.session.runtimeContext.fields.automaticThought).toBe(summary);
    expect(view.session.runtimeState?.fields.automaticThought).toBe(summary);
    expect(view.session.runtimeContext.confirmedSummaries?.automaticThought).toMatchObject({ sourceField: "automaticThought", writeField: "automaticThought", original: LONG_THOUGHT, summary, patientMessageId: expect.any(String) });
    expect(lastAssistant(view.messages).metadata?.reflectionCheckResolution).toMatchObject({ outcome: "confirmed", recordedSummary: { key: "automaticThought", writeField: "automaticThought" } });

    const worksheet = await getWorksheetView(sessionId, "tbct-s03");
    const field = worksheet?.fields.find((item) => item.definition.canonicalFieldKey === "automaticThought");
    expect(field?.value).toMatchObject({ value: summary, status: "participant_confirmed", provenance: "participant_confirmed_summary", participantVerbatim: LONG_THOUGHT });
  }, 20_000);

  // Summary fidelity (note2026_09_15_olivia_persona).
  it("a summary that adds meaning the participant did not express is never shown: the approved task is asked instead", async () => {
    const sessionId = await reachSummaryCheck(`${THOUGHT} ${ADDED_MEANING_TRIGGER}`);
    const turn = lastAssistant((await current(sessionId)).messages);
    expect(turn.metadata?.reflectionCheck).toBeUndefined();
    expect(turn.content).not.toContain("정리하면");
  }, 20_000);

  it("a summary holding a tentative interpretation can be confirmed, but is never written to the record", async () => {
    const tentative = `${LONG_THOUGHT} ${TENTATIVE_TRIGGER}`;
    const sessionId = await reachSummaryCheck(tentative);
    let view = await current(sessionId);
    const check = lastAssistant(view.messages).metadata?.reflectionCheck as Record<string, unknown> | undefined;
    expect(check).toMatchObject({ status: "pending" });
    expect(check?.summaryTarget).toBeUndefined();

    await submitPatientInput(sessionId, { kind: "text", value: "네" });
    view = await current(sessionId);
    expect(view.session.runtimeContext.fields.automaticThought).toBe(tentative);
    expect(lastAssistant(view.messages).metadata?.reflectionCheckResolution).toMatchObject({ outcome: "confirmed" });
    expect((lastAssistant(view.messages).metadata?.reflectionCheckResolution as Record<string, unknown>).recordedSummary).toBeUndefined();
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
    expect(turn.content).not.toContain(FAKE_QUESTION_KO);
  }, 20_000);
});
