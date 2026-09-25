import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getPatientRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { retryStalledRuntimeNode, startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import { saveWorksheetEdit } from "@/shared/worksheet/worksheet-edit-client";
import { SAFETY_CLARIFICATION_TEXT } from "@/shared/runtime/safety-clarification";
import { checkFieldUpdates } from "@/shared/runtime/prompt-driven-sessions";
import { buildPromptMessages } from "@/shared/dialogue-agent/prompt-session-agent";
import { installScriptedPromptSession, lastParticipantText, type PromptSessionScript, type ScriptedPromptSession } from "@/test/fakes/prompt-session.fake";

// The prompt-driven runtime for S01 and S02 (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02), end to end through the real session
// store with a scripted model: what the program does around the model --
// safety before the model, field checks and arithmetic after it, pacing,
// completion and pause -- is what is pinned here. What the model says is the
// session prompt's business (docs/prompts).

let fake: ScriptedPromptSession | undefined;

function script(fn: PromptSessionScript) {
  fake = installScriptedPromptSession(fn);
  return fake;
}

async function view(sessionId: string) {
  const current = await getRuntimeSession(sessionId);
  if (!current) throw new Error(`Session ${sessionId} not found`);
  return current;
}

function assistantMessages(current: Awaited<ReturnType<typeof view>>) {
  return current.messages.filter((message) => message.role === "assistant");
}

async function started(sessionDefinitionId: "tbct-s01" | "tbct-s02", locale = "ko-KR") {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId, locale });
  await startRuntimeSession(session.id);
  return session.id;
}

beforeEach(async () => {
  const db = getLocalDb();
  await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
});

afterEach(() => {
  fake?.uninstall();
  fake = undefined;
});

describe("starting and pacing", () => {
  it("starts on the conversation node, says it is the first message, and follows a message that asks nothing with the next one", async () => {
    const fake = script((_request, index) => (index < 2 ? { reply: `안내 ${index + 1}`, inputHint: "none" } : { reply: "요즘 도움받고 싶은 어려움이 있으세요?", inputHint: "text", focusField: "s01Problems" }));
    const sessionId = await started("tbct-s01");
    const current = await view(sessionId);

    expect(assistantMessages(current).map((message) => message.content)).toEqual(["안내 1", "안내 2", "요즘 도움받고 싶은 어려움이 있으세요?"]);
    expect(current.session.status).toBe("waiting_for_input");
    expect(current.session.currentNodeId).toBe("tbct-s01-n02-conversation");
    expect(fake.requests[0].continueWithoutParticipant).toBe(true);
    expect(fake.requests[0].programBlock).toContain("This is the first message of the session.");
    // Each message has its own turn id, so the store keeps all three.
    expect(new Set(assistantMessages(current).map((message) => message.metadata?.turnId)).size).toBe(3);
    expect(assistantMessages(current)[2].metadata).toMatchObject({ promptSessionVersion: "test", inputHint: "text", focusField: "s01Problems" });
  });

  it("stops chaining after a few messages and leaves the session for the page's retry to continue", async () => {
    script(() => ({ reply: "계속 안내만 합니다", inputHint: "none" }));
    const sessionId = await started("tbct-s01");
    const current = await view(sessionId);
    expect(assistantMessages(current)).toHaveLength(4);
    expect(current.session.status).toBe("active");

    fake!.uninstall();
    script(() => ({ reply: "이제 질문할게요", inputHint: "text" }));
    await retryStalledRuntimeNode(sessionId);
    const resumed = await view(sessionId);
    expect(resumed.session.status).toBe("waiting_for_input");
    expect(assistantMessages(resumed).at(-1)?.content).toBe("이제 질문할게요");
  });

  it("sends the conversation as alternating turns with the program block on the last user turn", () => {
    const messages = buildPromptMessages({
      sessionDefinitionId: "tbct-s01",
      locale: "ko-KR",
      history: [
        { role: "assistant", content: "안내" },
        { role: "assistant", content: "질문?" },
        { role: "participant", content: "답이에요. 제 번호는 010-1234-5678이에요" },
      ],
      programBlock: "Worksheet now: {}",
      continueWithoutParticipant: false,
    });
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    const lastText = messages.at(-1)!.content[0].text;
    expect(lastText).toContain("<program>");
    expect(lastText).toContain("Worksheet now: {}");
    expect(lastText).toContain("[PHONE]");
    expect(lastText).not.toContain("010-1234-5678");
  });
});

describe("what the model records", () => {
  it("stores listed fields, rejects anything else, and shows the values on the worksheet", async () => {
    script((request) => {
      if (!lastParticipantText(request)) return { reply: "어려움이 있으세요?", inputHint: "text", focusField: "s01Problems" };
      return {
        reply: "그 어려움이 드러났던 예를 하나 들어 주실 수 있을까요?",
        inputHint: "text",
        focusField: "s01ProblemExample",
        fieldUpdates: { s01Problems: ["잠을 잘 못 자요"], diagnosis: "우울증", personalEmotionIntensity: 250 },
      };
    });
    const sessionId = await started("tbct-s01");
    await submitPatientInput(sessionId, { kind: "text", value: "잠을 잘 못 자요" });
    const current = await view(sessionId);

    expect(current.session.runtimeContext.fields.s01Problems).toEqual(["잠을 잘 못 자요"]);
    expect(current.session.runtimeContext.fields.diagnosis).toBeUndefined();
    expect(current.session.runtimeContext.fields.personalEmotionIntensity).toBeUndefined();
    expect(assistantMessages(current).at(-1)?.metadata?.rejectedFieldUpdates).toEqual([
      { name: "diagnosis", reason: "not a field of this session" },
      { name: "personalEmotionIntensity", reason: "expected a number from 0 to 100" },
    ]);
    const worksheet = await getWorksheetView(sessionId, "tbct-s01");
    expect(worksheet?.fields.find((field) => field.definition.canonicalFieldKey === "s01Problems")?.value?.value).toEqual(["잠을 잘 못 자요"]);
  });

  it("checks shapes: lists are sent whole, numbers stay in range, S02 rows stay at fifteen", () => {
    expect(checkFieldUpdates("tbct-s01", { s01Problems: "하나만" }).accepted).toEqual({ s01Problems: ["하나만"] });
    expect(checkFieldUpdates("tbct-s02", { cdQuestFrequency: [1, null, 3] }).accepted).toEqual({ cdQuestFrequency: [1, null, 3] });
    expect(checkFieldUpdates("tbct-s02", { cdQuestFrequency: [4] }).rejected).toHaveLength(1);
    expect(checkFieldUpdates("tbct-s02", { distortionExamples: Array.from({ length: 16 }, () => "—") }).rejected).toHaveLength(1);
    // S02's worked-out values are the program's, never the model's.
    expect(checkFieldUpdates("tbct-s02", { cdQuestScores: [5], cdQuestTotal: 70 }).rejected.map((item) => item.name)).toEqual(["cdQuestScores", "cdQuestTotal"]);
  });

  it("works out S02's scores and total from the grades and tells the model on its next call", async () => {
    const grades = Array.from({ length: 15 }, () => 1);
    const fake = script((request) => {
      if (!lastParticipantText(request)) return { reply: "점수를 매겨 볼게요.", inputHint: "text" };
      if (!request.programBlock.includes("Total:")) return { reply: "총점을 볼게요.", inputHint: "none", fieldUpdates: { cdQuestFrequency: grades, cdQuestIntensity: [...grades.slice(0, 14), null], cdQuestStatedScores: [...Array.from({ length: 14 }, () => null), 4] } };
      return { reply: "이걸 보니 어떤 생각이 드세요?", inputHint: "text" };
    });
    const sessionId = await started("tbct-s02");
    await submitPatientInput(sessionId, { kind: "text", value: "다 1~2일, 약간이었고 마지막은 4점이요" });
    const fields = (await view(sessionId)).session.runtimeContext.fields;

    expect(fields.cdQuestScores).toEqual([...Array.from({ length: 14 }, () => 1), 4]);
    expect(fields.cdQuestTotal).toBe(18);
    expect(fields.cdQuestHighCount).toBe(1);
    expect(fake.requests.at(-1)?.programBlock).toContain("Total: 18 out of 75");
    const worksheet = await getWorksheetView(sessionId, "tbct-s02");
    expect(worksheet?.fields.find((field) => field.definition.canonicalFieldKey === "cdQuestTotal")?.value?.value).toBe(18);
  });

  it("gives the model the worksheet as the participant edited it, and refuses an edit while a reply is being prepared", async () => {
    const fake = script((request) => (lastParticipantText(request) ? { reply: "다음 질문이에요.", inputHint: "text" } : { reply: "어려움이 있으세요?", inputHint: "text", fieldUpdates: {} }));
    const sessionId = await started("tbct-s01");
    await saveWorksheetEdit({ runtimeSessionId: sessionId, sessionDefinitionId: "tbct-s01", worksheetFieldKey: "s01Problems", value: ["밤에 잠을 못 자요"] });
    await submitPatientInput(sessionId, { kind: "text", value: "네, 그게 제일 커요" });
    expect(fake.requests.at(-1)?.programBlock).toContain("밤에 잠을 못 자요");

    await updateRuntimeSessionRecord(sessionId, { status: "processing" });
    await expect(saveWorksheetEdit({ runtimeSessionId: sessionId, sessionDefinitionId: "tbct-s01", worksheetFieldKey: "s01Problems", value: ["바뀐 값"] })).rejects.toThrow("worksheet_edit:turn_in_progress");
  });

  it("drives the patient's input control and worksheet highlight from what the model said about its message", async () => {
    script(() => ({ reply: "0에서 100 중 몇이었어요?", inputHint: "rating_0_100", focusField: "personalEmotionIntensity" }));
    const sessionId = await started("tbct-s01");
    const patientView = await getPatientRuntimeSession(sessionId);
    expect(patientView?.currentPromptInput).toEqual({ type: "rating", validation: { kind: "rating", min: 0, max: 100 }, outputFields: ["personalEmotionIntensity"] });
  });
});

describe("safety stays in code", () => {
  it("answers a current disclosure with the fixed response, escalates, and never asks the model", async () => {
    const fake = script(() => ({ reply: "어려움이 있으세요?", inputHint: "text" }));
    const sessionId = await started("tbct-s01");
    const callsBefore = fake.requests.length;
    const result = await submitPatientInput(sessionId, { kind: "text", value: "요즘은 정말 죽고 싶어요" });
    const current = await view(sessionId);

    expect(fake.requests).toHaveLength(callsBefore);
    expect(result.turnOutcome).toBe("safety_override");
    expect(current.session.status).toBe("escalated");
    expect(assistantMessages(current).at(-1)?.metadata?.turnOutcome).toBe("safety_override");
    expect(current.session.currentNodeId).toBe("tbct-s01-n02-conversation");
  });

  it("asks the fixed clarification on wording that may not be a current disclosure, then hands a 'no' back to the model with a note", async () => {
    const fake = script(() => ({ reply: "계속해 볼게요.", inputHint: "text" }));
    const sessionId = await started("tbct-s02");
    const callsBefore = fake.requests.length;
    await submitPatientInput(sessionId, { kind: "text", value: "죽고 싶은 건 아니에요, 그냥 너무 지쳐요" });
    let current = await view(sessionId);
    expect(fake.requests).toHaveLength(callsBefore);
    expect(assistantMessages(current).at(-1)?.content).toBe(SAFETY_CLARIFICATION_TEXT.ko);
    expect(current.session.runtimeContext.lastClarificationReason).toBe("safety_clarification");

    await submitPatientInput(sessionId, { kind: "text", value: "아니요, 그냥 지친다는 뜻이었어요" });
    current = await view(sessionId);
    expect(fake.requests.at(-1)?.programBlock).toContain("not about harming themselves");
    expect(current.session.runtimeContext.lastClarificationReason).not.toBe("safety_clarification");
    // And the next ordinary answer is read as an answer, not as a reply to the clarification.
    await submitPatientInput(sessionId, { kind: "text", value: "네" });
    expect((await view(sessionId)).session.status).toBe("waiting_for_input");
    expect(assistantMessages(current).at(-1)?.content).toBe("계속해 볼게요.");
  });

  it("goes to the full safety path when the answer to the clarification confirms it", async () => {
    script(() => ({ reply: "계속해 볼게요.", inputHint: "text" }));
    const sessionId = await started("tbct-s02");
    await submitPatientInput(sessionId, { kind: "text", value: "죽고 싶은 건 아니에요, 그냥 너무 지쳐요" });
    const result = await submitPatientInput(sessionId, { kind: "text", value: "네" });
    expect(result.turnOutcome).toBe("safety_override");
    expect((await view(sessionId)).session.status).toBe("escalated");
  });

  it("replaces the model's own message with the fixed clarification when the model is worried", async () => {
    script((request) => (lastParticipantText(request) ? { reply: "모델이 쓴 위기 대응 문장", inputHint: "text", safetyConcern: true } : { reply: "어떠셨어요?", inputHint: "text" }));
    const sessionId = await started("tbct-s01");
    await submitPatientInput(sessionId, { kind: "text", value: "다 그만두고 싶다는 생각이 가끔 들어요" });
    const current = await view(sessionId);
    const contents = assistantMessages(current).map((message) => message.content);
    expect(contents.at(-1)).toBe(SAFETY_CLARIFICATION_TEXT.ko);
    expect(contents).not.toContain("모델이 쓴 위기 대응 문장");
    expect(assistantMessages(current).at(-1)?.metadata?.promptSessionSafetyReason).toBe("model_safety_concern");
  });
});

describe("ending, pausing and failing", () => {
  it("completes the session on the goodbye", async () => {
    script((request) => (lastParticipantText(request) ? { reply: "오늘 이야기 나눠 주셔서 고마워요.", inputHint: "none", sessionComplete: true } : { reply: "할 수 있으시겠어요?", inputHint: "yes_no" }));
    const sessionId = await started("tbct-s01");
    expect((await getPatientRuntimeSession(sessionId))?.currentPromptInput?.validation).toEqual({ kind: "boolean" });
    const result = await submitPatientInput(sessionId, { kind: "boolean", value: true });
    expect(result.sessionStatus).toBe("completed");
    expect((await view(sessionId)).session.status).toBe("completed");
  });

  it("pauses, not completes, when the participant does not want to go on today", async () => {
    script((request) => (lastParticipantText(request) ? { reply: "오늘은 여기서 멈출게요.", inputHint: "none", pauseSession: true } : { reply: "이렇게 진행해도 괜찮으실까요?", inputHint: "yes_no" }));
    const sessionId = await started("tbct-s01");
    await submitPatientInput(sessionId, { kind: "text", value: "아니요, 오늘은 그만할래요" });
    const current = await view(sessionId);
    expect(current.session.status).toBe("paused");
    expect(assistantMessages(current).at(-1)?.content).toBe("오늘은 여기서 멈출게요.");
  });

  it("sends one fixed line and waits when the model call fails twice", async () => {
    const fake = script((request) => (lastParticipantText(request) ? { fail: "timeout" } : { reply: "어려움이 있으세요?", inputHint: "text" }));
    const sessionId = await started("tbct-s01");
    const result = await submitPatientInput(sessionId, { kind: "text", value: "잠을 못 자요" });
    const current = await view(sessionId);
    expect(result.turnOutcome).toBe("fallback");
    expect(fake.requests.filter((request) => request.correction)).toHaveLength(1);
    expect(assistantMessages(current).at(-1)?.content).toContain("잠시 문제가 생겼어요");
    expect(current.session.status).toBe("waiting_for_input");
  });

  it("carries on a session stored under the old S01 graph", async () => {
    script(() => ({ reply: "이어서 해 볼게요.", inputHint: "text" }));
    const sessionId = await started("tbct-s01");
    await updateRuntimeSessionRecord(sessionId, { currentNodeId: "tbct-s01-n05-own-emotions", currentPromptItemId: "tbct-s01-n05-p01-first-emotion" });
    await submitPatientInput(sessionId, { kind: "text", value: "불안했어요" });
    const current = await view(sessionId);
    expect(current.session.currentNodeId).toBe("tbct-s01-n02-conversation");
    expect(assistantMessages(current).at(-1)?.content).toBe("이어서 해 볼게요.");
  });
});
