import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getRuntimeSessionRecord, updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import { PROMPT_DISPLAY_FIELD } from "@/shared/runtime/prompt-driven-sessions";
import { installScriptedPromptSession, type ScriptedPromptSession } from "@/test/fakes/prompt-session.fake";
import { setWorksheetTidierForTests, type TidyItem } from "@/shared/worksheet/worksheet-tidy";

// A prompt-driven turn with worksheet display text (.claude/TASK_SCOPE.json
// note2026_10_05_worksheet_display_version): the recorded words stay exactly
// as the model recorded them, and the tidy text of words that changed is
// dropped rather than shown over the new words.

const THOUGHT = "음 나를 무시하는 거야 그런 것 같아";
const PROBLEMS = ["음 불안이 심해요 그냥", "계획대로 안 되면 힘들어요"];

async function shown(sessionId: string, key: string) {
  const view = await getWorksheetView(sessionId, "tbct-s01");
  return view?.fields.find((field) => field.definition.worksheetFieldKey === key)?.value;
}

describe("prompt-session turn with worksheet display text", () => {
  let fake: ScriptedPromptSession | undefined;
  afterEach(() => {
    fake?.uninstall();
    setWorksheetTidierForTests(undefined);
    delete process.env.WORKSHEET_TIDY;
  });
  beforeEach(async () => {
    process.env.AI_PROVIDER = "mock";
    // These tests cover the feature as it works when switched on.
    process.env.WORKSHEET_TIDY = "on";
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
  });

  it("keeps the recorded words verbatim and drops the tidy text of a changed field only", async () => {
    fake = installScriptedPromptSession((_request, index) => (index === 0
      ? { reply: "어떤 생각이 들었나요?", fieldUpdates: { openingInitialThought: THOUGHT, s01Problems: PROBLEMS } }
      : { reply: "그렇군요.", fieldUpdates: { openingInitialThought: "그 사람이 나를 무시했어 같아요" } }));
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    await startRuntimeSession(session.id);

    let record = await getRuntimeSessionRecord(session.id);
    expect(record!.runtimeContext.fields).toMatchObject({ openingInitialThought: THOUGHT, s01Problems: PROBLEMS, [PROMPT_DISPLAY_FIELD]: {} });

    // Tidy text as it would be held for these words.
    const display = { openingInitialThought: "나를 무시하는 거야", s01Problems: ["불안이 심해요", PROBLEMS[1]] };
    await updateRuntimeSessionRecord(session.id, { runtimeContext: { ...record!.runtimeContext, fields: { ...record!.runtimeContext.fields, [PROMPT_DISPLAY_FIELD]: display } } });

    const view = await getRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "그 사람이 나를 무시했어 같아요" }, { clientTurnId: "turn-1", expectedSessionVersion: view!.session.version ?? 0 });

    record = await getRuntimeSessionRecord(session.id);
    const fields = record!.runtimeContext.fields;
    expect(fields.openingInitialThought).toBe("그 사람이 나를 무시했어 같아요");
    expect(fields.s01Problems).toEqual(PROBLEMS);
    expect(fields[PROMPT_DISPLAY_FIELD]).toEqual({ s01Problems: display.s01Problems });
    expect(record!.runtimeState?.fields?.[PROMPT_DISPLAY_FIELD]).toEqual({ s01Problems: display.s01Problems });

    expect(await shown(session.id, "openingInitialThought")).toMatchObject({ value: "그 사람이 나를 무시했어 같아요", displayValue: "그 사람이 나를 무시했어 같아요" });
    expect(await shown(session.id, "s01Problems")).toMatchObject({ value: PROBLEMS, displayItems: display.s01Problems });
  }, 60_000);

  it("never shows the display map to the model as a worksheet value", async () => {
    fake = installScriptedPromptSession(() => ({ reply: "어떤 생각이 들었나요?", fieldUpdates: { openingInitialThought: THOUGHT } }));
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    await startRuntimeSession(session.id);
    const view = await getRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "네" }, { clientTurnId: "turn-1", expectedSessionVersion: view!.session.version ?? 0 });
    const worksheetLine = fake.requests.at(-1)!.programBlock.split("\n").find((line) => line.startsWith("Worksheet now:"));
    expect(worksheetLine).toContain(THOUGHT);
    expect(worksheetLine).not.toContain(PROMPT_DISPLAY_FIELD);
  }, 60_000);

  it("shows the tidy text of newly recorded words, only where it is drawn from them", async () => {
    const asked: TidyItem[][] = [];
    setWorksheetTidierForTests(async (items) => {
      asked.push(items);
      // One honest tidy, one invented line, and one list entry tidied.
      return { openingInitialThought: "나를 무시하는 거야", s01Goal: "회사를 그만두고 여행을 간다", s01Problems: ["불안이 심해요", PROBLEMS[1]] };
    });
    fake = installScriptedPromptSession(() => ({ reply: "어떤 생각이 들었나요?", fieldUpdates: { openingInitialThought: THOUGHT, s01Goal: "음 회의에서 의견을 말하고 싶어요", s01Problems: PROBLEMS } }));
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    await startRuntimeSession(session.id);

    // Only the words recorded this turn went out, with their labels.
    expect(asked[0].map((item) => item.name).sort()).toEqual(["openingInitialThought", "s01Goal", "s01Problems"]);
    const record = await getRuntimeSessionRecord(session.id);
    const fields = record!.runtimeContext.fields;
    // The recorded words never change.
    expect(fields.openingInitialThought).toBe(THOUGHT);
    expect(fields[PROMPT_DISPLAY_FIELD]).toEqual({ openingInitialThought: "나를 무시하는 거야", s01Problems: ["불안이 심해요", PROBLEMS[1]] });
    expect(await shown(session.id, "openingInitialThought")).toMatchObject({ value: THOUGHT, displayValue: "나를 무시하는 거야", participantVerbatim: THOUGHT });
  }, 60_000);

  it("shows the recorded words when the tidy call gives nothing back", async () => {
    setWorksheetTidierForTests(async () => {
      throw new Error("down");
    });
    fake = installScriptedPromptSession(() => ({ reply: "어떤 생각이 들었나요?", fieldUpdates: { openingInitialThought: THOUGHT } }));
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    await startRuntimeSession(session.id);
    expect(await shown(session.id, "openingInitialThought")).toMatchObject({ value: THOUGHT, displayValue: THOUGHT });
  }, 60_000);

  it("is off by default: no tidy call, and tidy text stored earlier stops showing", async () => {
    delete process.env.WORKSHEET_TIDY;
    let called = false;
    setWorksheetTidierForTests(async () => {
      called = true;
      return { openingInitialThought: "나를 무시하는 거야" };
    });
    fake = installScriptedPromptSession((_request, index) => (index === 0
      ? { reply: "어떤 생각이 들었나요?", fieldUpdates: { openingInitialThought: THOUGHT } }
      : { reply: "그렇군요.", fieldUpdates: {} }));
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    await startRuntimeSession(session.id);
    const record = await getRuntimeSessionRecord(session.id);
    await updateRuntimeSessionRecord(session.id, { runtimeContext: { ...record!.runtimeContext, fields: { ...record!.runtimeContext.fields, [PROMPT_DISPLAY_FIELD]: { openingInitialThought: "나를 무시하는 거야" } } } });
    const view = await getRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "네" }, { clientTurnId: "turn-1", expectedSessionVersion: view!.session.version ?? 0 });

    expect(called).toBe(false);
    expect((await getRuntimeSessionRecord(session.id))!.runtimeContext.fields[PROMPT_DISPLAY_FIELD]).toEqual({});
    expect(await shown(session.id, "openingInitialThought")).toMatchObject({ value: THOUGHT, displayValue: THOUGHT });
  }, 60_000);
});
