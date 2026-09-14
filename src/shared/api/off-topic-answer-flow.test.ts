import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import { OFF_TOPIC_TRIGGER } from "@/test/fakes/dialogue-agent.fake";
import type { RuntimeMessage } from "@/types/runtime-session";

// Off-topic answers (.claude/TASK_SCOPE.json note2026_09_14_off_topic_answers),
// end to end through the real turn pipeline with the fake relevance check: a
// message that does not respond to a free-text question is not stored, the
// question stays, and it is asked again -- as often as it happens, without
// ever pausing the session.

const SITUATION = "상사가 회의에서 보고서 수정이 필요하다고 말했어요";

async function current(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error(`Session ${sessionId} not found.`);
  return view;
}

function last(messages: RuntimeMessage[], role: RuntimeMessage["role"]) {
  const message = [...messages].reverse().find((item) => item.role === role);
  if (!message) throw new Error(`No ${role} message yet.`);
  return message;
}

/** S03 up to its first free-text question, the situation. */
async function reachSituation() {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
  await startRuntimeSession(session.id);
  await submitPatientInput(session.id, { kind: "text", value: "괜찮아요, 특별히 급한 건 없어요" }); // safety-check
  await submitPatientInput(session.id, { kind: "text", value: "네" }); // redirection-contract
  await submitPatientInput(session.id, { kind: "text", value: "네" }); // worksheet-readiness-check
  return session.id;
}

describe("Off-topic answers are not stored", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("an off-topic message is not stored, the question stays and is asked again, and it never counts as a clarification attempt", async () => {
    const sessionId = await reachSituation();
    let view = await current(sessionId);
    const questionId = view.currentPromptItem?.id;
    const field = view.currentPromptItem!.outputFields[0];
    expect(field).toBe("situation");

    // More off-topic messages than MAX_CLARIFICATION_ATTEMPTS (3): the session must not pause.
    for (let turn = 0; turn < 4; turn += 1) {
      const result = await submitPatientInput(sessionId, { kind: "text", value: `오늘 점심에 초밥을 먹었는데 정말 맛있었어요 ${OFF_TOPIC_TRIGGER}` });
      expect(result.turnOutcome).toBe("clarification");
      expect(result.sessionStatus).toBe("waiting_for_input");
    }
    view = await current(sessionId);
    expect(view.currentPromptItem?.id).toBe(questionId);
    expect(view.session.runtimeContext.fields[field]).toBeUndefined();
    expect(view.session.runtimeContext.clarificationAttemptCount ?? 0).toBe(0);
    expect(last(view.messages, "assistant").metadata).toMatchObject({ turnOutcome: "clarification", clarificationReason: "off_topic" });
    expect(last(view.messages, "patient").metadata?.answerRelevance).toMatchObject({ isAnswer: false });
    const worksheet = await getWorksheetView(sessionId, "tbct-s03");
    expect(worksheet?.fields.find((item) => item.definition.canonicalFieldKey === field)?.value ?? null).toBeNull();

    // A real answer afterwards is stored and moves the session on as usual.
    await submitPatientInput(sessionId, { kind: "text", value: SITUATION });
    view = await current(sessionId);
    expect(view.session.runtimeContext.fields[field]).toBe(SITUATION);
    expect(view.currentPromptItem?.id).not.toBe(questionId);
    expect(last(view.messages, "patient").metadata?.answerRelevance).toMatchObject({ isAnswer: true });
  }, 30_000);
});
