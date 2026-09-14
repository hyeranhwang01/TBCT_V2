import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { editWorksheetField, getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import { updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { s01PromptSlug } from "@/patient/sessions/s01/turn-rules";
import { CORRECTION_TRIGGER, STOP_SIGNAL_TRIGGER } from "@/test/fakes/dialogue-agent.fake";
import type { RuntimeMessage } from "@/types/runtime-session";

// Field corrections (.claude/TASK_SCOPE.json note2026_09_14_field_corrections),
// end to end through the real S01 turn pipeline with the fake relevance check
// and dialogue agent: a typo meaning "nothing more" closes the list without
// being stored, and a wrong item already on the list is removed only after the
// participant agrees -- the live case, where "읎오" stayed a difficulty.

async function current(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error(`Session ${sessionId} not found.`);
  return view;
}

function slugOf(view: NonNullable<Awaited<ReturnType<typeof getRuntimeSession>>>) {
  const id = view.currentPromptItem?.id;
  return id ? s01PromptSlug(id) : null;
}

function last(messages: RuntimeMessage[], role: RuntimeMessage["role"]) {
  const message = [...messages].reverse().find((item) => item.role === role);
  if (!message) throw new Error(`No ${role} message yet.`);
  return message;
}

/** S01 up to "any other difficulty?", with one difficulty recorded. */
async function reachOtherDifficulty() {
  const session = await createCanonicalTestRuntimeSession({ locale: "ko-KR" });
  await startRuntimeSession(session.id);
  const answers: Record<string, string> = { "main-difficulty": "졸리다", "difficulty-example": "아침에 일어날 때 졸려요" };
  for (let turn = 0; turn < 6; turn += 1) {
    const view = await current(session.id);
    const slug = slugOf(view);
    if (slug === "other-difficulty") return session.id;
    const answer = slug ? answers[slug] : undefined;
    if (!answer) throw new Error(`Unexpected S01 prompt ${slug}`);
    await submitPatientInput(session.id, { kind: "text", value: answer });
  }
  throw new Error("Did not reach other-difficulty.");
}

describe("Field corrections: wrong entries are kept off, or taken back with the participant's agreement", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("a typo that means 'nothing more' closes the list without being stored", async () => {
    const sessionId = await reachOtherDifficulty();
    await submitPatientInput(sessionId, { kind: "text", value: `업서요 ${STOP_SIGNAL_TRIGGER}` });
    const view = await current(sessionId);
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["졸리다"]);
    expect(view.session.runtimeContext.fields.s01ProblemsNoMore).toBe(true);
    expect(["other-difficulty", "other-difficulty-more"]).not.toContain(slugOf(view));
    expect(last(view.messages, "patient").metadata?.answerRelevance).toMatchObject({ verdict: "stop" });
  }, 30_000);

  it("a wrong item already on the list is proposed for removal, and removed only after a yes (even 'ㅇㅇ')", async () => {
    const sessionId = await reachOtherDifficulty();
    await submitPatientInput(sessionId, { kind: "text", value: "읎오" });
    let view = await current(sessionId);
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["졸리다", "읎오"]);
    expect(slugOf(view)).toBe("other-difficulty-more");

    await submitPatientInput(sessionId, { kind: "text", value: `아까 읎오는 잘못 쓴 거예요 ${CORRECTION_TRIGGER}` });
    view = await current(sessionId);
    // The request itself is not a difficulty, and nothing has changed yet.
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["졸리다", "읎오"]);
    expect(slugOf(view)).toBe("other-difficulty-more");
    const ask = last(view.messages, "assistant");
    expect(ask.content).toContain("읎오");
    expect(ask.metadata).toMatchObject({ clarificationReason: "correction_request", reflectionCheck: { status: "pending", correction: { field: "s01Problems", action: "remove_item", currentValue: "읎오" } } });

    await submitPatientInput(sessionId, { kind: "text", value: "ㅇㅇ" });
    view = await current(sessionId);
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["졸리다"]);
    expect(view.session.runtimeContext.fields.s01ProblemsCount).toBe(1);
    expect(view.session.runtimeState?.fields.s01Problems).toEqual(["졸리다"]);
    expect(slugOf(view)).toBe("other-difficulty-more");
    expect(last(view.messages, "assistant").metadata?.reflectionCheckResolution).toMatchObject({ outcome: "confirmed", appliedCorrection: { field: "s01Problems", action: "remove_item", before: ["졸리다", "읎오"], after: ["졸리다"] } });
    const worksheet = await getWorksheetView(sessionId, "tbct-s01");
    expect(worksheet?.fields.find((item) => item.definition.canonicalFieldKey === "s01Problems")?.value?.value).toEqual(["졸리다"]);
  }, 30_000);

  it("a 'no' to a proposed correction leaves the record exactly as it was", async () => {
    const sessionId = await reachOtherDifficulty();
    await submitPatientInput(sessionId, { kind: "text", value: "읎오" });
    await submitPatientInput(sessionId, { kind: "text", value: `아까 읎오는 잘못 쓴 거예요 ${CORRECTION_TRIGGER}` });
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
    const view = await current(sessionId);
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["졸리다", "읎오"]);
    const turn = last(view.messages, "assistant");
    expect(turn.metadata?.reflectionCheckResolution).toMatchObject({ outcome: "left_as_participant_words" });
    expect(turn.metadata?.reflectionCheck).toBeUndefined();
  }, 30_000);

  // Participant worksheet edits (note2026_09_14_patient_worksheet_edit).
  it("a box the participant rewrites on the worksheet changes what the conversation goes on with, and later turns keep it", async () => {
    const sessionId = await reachOtherDifficulty();
    await submitPatientInput(sessionId, { kind: "text", value: "읎오" });
    await editWorksheetField(sessionId, "tbct-s01", "s01Problems", ["졸리다", "밤에 잠을 못 자요"]);

    let view = await current(sessionId);
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["졸리다", "밤에 잠을 못 자요"]);
    expect(view.session.runtimeState?.fields.s01Problems).toEqual(["졸리다", "밤에 잠을 못 자요"]);
    expect(view.session.runtimeContext.fields.s01ProblemsCount).toBe(2);
    let worksheet = await getWorksheetView(sessionId, "tbct-s01");
    const problems = () => worksheet?.fields.find((item) => item.definition.canonicalFieldKey === "s01Problems")?.value;
    expect(problems()).toMatchObject({ status: "participant_edited", value: ["졸리다", "밤에 잠을 못 자요"] });

    await submitPatientInput(sessionId, { kind: "text", value: "없어요" });
    view = await current(sessionId);
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["졸리다", "밤에 잠을 못 자요"]);
    expect(view.session.runtimeState?.fields.s01Problems).toEqual(["졸리다", "밤에 잠을 못 자요"]);
    expect(view.session.runtimeContext.fields.s01ProblemsNoMore).toBe(true);
    worksheet = await getWorksheetView(sessionId, "tbct-s01");
    expect(problems()?.value).toEqual(["졸리다", "밤에 잠을 못 자요"]);
  }, 30_000);

  it("a worksheet edit is refused while a reply is being prepared", async () => {
    const sessionId = await reachOtherDifficulty();
    await updateRuntimeSessionRecord(sessionId, { status: "processing" });
    await expect(editWorksheetField(sessionId, "tbct-s01", "s01Problems", ["바뀐 값"])).rejects.toThrow("worksheet_edit:turn_in_progress");
    expect((await current(sessionId)).session.runtimeContext.fields.s01Problems).toEqual(["졸리다"]);
  }, 30_000);
});
