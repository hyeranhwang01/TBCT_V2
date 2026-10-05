import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession } from "@/shared/api/runtime-session-api";
import { getRuntimeSessionRecord, updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { editWorksheetField, getWorksheetView, projectRuntimeFieldsToWorksheet } from "@/shared/worksheet/worksheet-projection";
import { PROMPT_DISPLAY_FIELD } from "@/shared/runtime/prompt-driven-sessions";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";

// The worksheet shows the tidied text; the recorded words stay the value and
// become participantVerbatim (.claude/TASK_SCOPE.json
// note2026_10_05_worksheet_display_version). Exercised against the real
// write path, as worksheet-projection-history.test.ts does.

const RAW = {
  openingInitialThought: "음 나를 무시하는 거야 그런 것 같아",
  personalBehavior: "혼자 울었어요",
  personalEmotionIntensity: 50,
  s01Problems: ["음 불안이 심해요 그냥", "계획대로 안 되면 힘들어요"],
};
const DISPLAY = { openingInitialThought: "나를 무시하는 거야", s01Problems: ["불안이 심해요", "계획대로 안 되면 힘들어요"] };

async function valueOf(runtimeSessionId: string, key: string) {
  const view = await getWorksheetView(runtimeSessionId, "tbct-s01");
  return view?.fields.find((field) => field.definition.worksheetFieldKey === key)?.value;
}

describe("projectRuntimeFieldsToWorksheet with display text", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("shows the tidied text and keeps the recorded words as value and participantVerbatim", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    await projectRuntimeFieldsToWorksheet({ runtimeSessionId: session.id, sessionDefinitionId: "tbct-s01", fields: RAW, display: DISPLAY });

    expect(await valueOf(session.id, "openingInitialThought")).toMatchObject({ value: RAW.openingInitialThought, displayValue: "나를 무시하는 거야", participantVerbatim: RAW.openingInitialThought, provenance: "participant_verbatim" });
    expect(await valueOf(session.id, "personalBehavior")).toMatchObject({ value: "혼자 울었어요", displayValue: "혼자 울었어요" });
    expect((await valueOf(session.id, "personalBehavior"))?.participantVerbatim).toBeUndefined();
    expect(await valueOf(session.id, "personalEmotionIntensity")).toMatchObject({ value: 50, displayValue: "50" });
    expect(await valueOf(session.id, "s01Problems")).toMatchObject({ value: RAW.s01Problems, displayItems: DISPLAY.s01Problems, displayValue: "불안이 심해요, 계획대로 안 되면 힘들어요" });
  });

  it("goes back to the recorded words once the display map no longer has the field", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    await projectRuntimeFieldsToWorksheet({ runtimeSessionId: session.id, sessionDefinitionId: "tbct-s01", fields: RAW, display: DISPLAY });
    await projectRuntimeFieldsToWorksheet({ runtimeSessionId: session.id, sessionDefinitionId: "tbct-s01", fields: RAW, display: {} });
    expect(await valueOf(session.id, "openingInitialThought")).toMatchObject({ value: RAW.openingInitialThought, displayValue: RAW.openingInitialThought });
    expect(await valueOf(session.id, "s01Problems")).toMatchObject({ displayItems: [], displayValue: RAW.s01Problems.join(", ") });
  });

  it("writes no display fields at all for a caller that passes no map", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    await projectRuntimeFieldsToWorksheet({ runtimeSessionId: session.id, sessionDefinitionId: "tbct-s01", fields: RAW });
    const list = await valueOf(session.id, "s01Problems");
    expect(list?.displayItems).toBeUndefined();
    expect(list?.displayValue).toBe(RAW.s01Problems.join(", "));
  });

  it("a participant edit replaces the recorded words and the tidied text, in the worksheet and in the session", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01" });
    const record = await getRuntimeSessionRecord(session.id);
    await updateRuntimeSessionRecord(session.id, { status: "waiting_for_input", runtimeContext: { ...record!.runtimeContext, fields: { ...RAW, [PROMPT_DISPLAY_FIELD]: DISPLAY } } });
    await projectRuntimeFieldsToWorksheet({ runtimeSessionId: session.id, sessionDefinitionId: "tbct-s01", fields: RAW, display: DISPLAY });

    await editWorksheetField(session.id, "tbct-s01", "openingInitialThought", "그 사람이 나를 무시했어");
    expect(await valueOf(session.id, "openingInitialThought")).toMatchObject({ value: "그 사람이 나를 무시했어", displayValue: "그 사람이 나를 무시했어", status: "participant_edited" });
    let fields = (await getRuntimeSessionRecord(session.id))!.runtimeContext.fields;
    expect(fields.openingInitialThought).toBe("그 사람이 나를 무시했어");
    expect(fields[PROMPT_DISPLAY_FIELD]).toEqual({ s01Problems: DISPLAY.s01Problems });

    await editWorksheetField(session.id, "tbct-s01", "s01Problems", [RAW.s01Problems[0], "새 어려움"]);
    expect(await valueOf(session.id, "s01Problems")).toMatchObject({ value: [RAW.s01Problems[0], "새 어려움"], displayItems: ["불안이 심해요", "새 어려움"] });
    fields = (await getRuntimeSessionRecord(session.id))!.runtimeContext.fields;
    expect(fields[PROMPT_DISPLAY_FIELD]).toEqual({ s01Problems: ["불안이 심해요", "새 어려움"] });
  });
});
