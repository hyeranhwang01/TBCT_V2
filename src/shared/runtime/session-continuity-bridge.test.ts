import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { syntheticPatientInput } from "@/shared/runtime/testing/session-fidelity-fixtures";
import { appendHomeworkEntry, ensureHomeworkForSession } from "@/patient/lib/api/homework-api";
import { DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData } from "@/patient/sessions/s01/distortion-table";
import { installScriptedPromptSession, type ScriptedPromptSession } from "@/test/fakes/prompt-session.fake";

// End-to-end cover for what session-continuity.ts carries from one session into
// the next. These run a real session to completion and then open a second one
// for the same participant, so they fail if the seeding is removed or if what
// reads it stops being reachable.
//
// S01 and S02 are prompt-driven (note2026_09_25_prompt_driven_s01_s02): what
// reads the S01 seed is now the program note in the S02 model call, so that is
// what these check. The S02 wording tests that stood here went with S02's
// static messages.

async function runToCompletion(sessionId: string) {
  for (let turn = 0; turn < 200; turn += 1) {
    const view = await getRuntimeSession(sessionId);
    if (!view || view.session.status === "completed") return;
    if (view.session.status !== "waiting_for_input") return;
    const prompt = view.currentPromptItem;
    if (!prompt) return;
    await submitPatientInput(sessionId, syntheticPatientInput(prompt), {
      clientTurnId: `${sessionId}-turn-${turn}`,
      expectedSessionVersion: view.session.version ?? 0,
    });
  }
}

describe("returning-participant continuity", () => {
  let fake: ScriptedPromptSession | undefined;
  afterEach(() => fake?.uninstall());
  beforeEach(async () => {
    process.env.AI_PROVIDER = "mock";
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
  });

  it("opens a participant's very first session as a first session", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US" });
    expect(session.runtimeContext.fields.returningParticipant).toBeUndefined();
    expect(session.runtimeContext.homeworkStatus).toBe("not_assigned");

  }, 60_000);

  it("carries a completed session and its outstanding homework into the next one", async () => {
    const first = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s05", locale: "en-US" });
    await startRuntimeSession(first.id);
    await runToCompletion(first.id);

    const completed = await getRuntimeSession(first.id);
    expect(completed?.session.status).toBe("completed");
    // The homework record is created when the participant reaches the
    // completion screen, exactly as patient-session-complete-page.tsx does it.
    await ensureHomeworkForSession(completed!.session);

    const second = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US" });
    expect(second.runtimeContext.fields).toMatchObject({
      returningParticipant: true,
      previousSessionDefinitionId: "tbct-s05",
      completedSessionCount: 1,
      previousHomeworkLabel: "Review Grid",
    });
    // S05's follow-up opens in review_available -- assigned, not yet confirmed
    // done -- which the protocol-facing flag reports as pending.
    expect(second.runtimeContext.homeworkStatus).toBe("pending");
  }, 120_000);

  // S02 does not branch on returningParticipant; the seed still has to
  // arrive -- previousS01HomeworkExampleCount depends on the same computation.
  it("seeds a returning participant into S02", async () => {
    const first = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s05", locale: "en-US" });
    await startRuntimeSession(first.id);
    await runToCompletion(first.id);
    await ensureHomeworkForSession((await getRuntimeSession(first.id))!.session);

    const second = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US" });
    expect(second.runtimeContext.fields.returningParticipant).toBe(true);
  }, 120_000);

  // S01 run by a scripted model: it records a difficulty and a goal, then
  // says goodbye. S02 must then carry the S01 answers and homework count to
  // its model as a program note -- and seed none of S02's own fields.
  it("carries S01's answers and homework into S02's program note", async () => {
    let s01Turns = 0;
    fake = installScriptedPromptSession((request) => {
      if (request.sessionDefinitionId === "tbct-s01") {
        s01Turns += 1;
        return s01Turns === 1
          ? { reply: "What difficulties would you like help with?", inputHint: "text" }
          : { reply: "Thank you. See you next time.", fieldUpdates: { s01Problems: ["I can't sleep"], s01RepresentativeProblem: "I can't sleep", s01Goal: "Sleep through the night" }, inputHint: "none", sessionComplete: true };
      }
      return { reply: "Good to see you again.", inputHint: "none" };
    });
    const first = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "en-US" });
    await startRuntimeSession(first.id);
    await submitPatientInput(first.id, { kind: "text", value: "I can't sleep" });
    const completed = (await getRuntimeSession(first.id))!.session;
    expect(completed.status).toBe("completed");
    const record = await ensureHomeworkForSession(completed);
    await appendHomeworkEntry(record!.id, DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData({ distortionId: "labeling", date: "2026-09-13", text: "I'm hopeless at this" }));
    await appendHomeworkEntry(record!.id, "example", { situation: "old", thought: "old", distortionName: "old" });

    const second = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US" });
    expect(second.runtimeContext.fields).toMatchObject({ previousSessionDefinitionId: "tbct-s01", previousS01HomeworkExampleCount: 1, previousS01RepresentativeProblem: "I can't sleep", previousS01Goal: "Sleep through the night" });
    for (const key of ["problems", "problemRatings", "goals", "goalRatings", "distortionExamples", "cdQuestScores"]) expect(second.runtimeContext.fields[key]).toBeUndefined();

    await startRuntimeSession(second.id);
    const s02Call = fake.requests.find((request) => request.sessionDefinitionId === "tbct-s02")!;
    expect(s02Call.programBlock).toContain("From earlier sessions");
    expect(s02Call.programBlock).toContain('"previousS01HomeworkExampleCount":1');
    expect(s02Call.programBlock).toContain("Sleep through the night");
  }, 60_000);
});
