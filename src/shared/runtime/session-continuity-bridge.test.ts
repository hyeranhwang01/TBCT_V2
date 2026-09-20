import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { syntheticPatientInput } from "@/shared/runtime/testing/session-fidelity-fixtures";
import { appendHomeworkEntry, ensureHomeworkForSession } from "@/patient/lib/api/homework-api";
import { DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData } from "@/patient/sessions/s01/distortion-table";
import { koreanText as s02KoreanText, resolveStaticText as resolveS02StaticText } from "@/patient/sessions/s02/messages";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";

// End-to-end cover for what session-continuity.ts carries from one session into
// the next. These run a real session to completion and then open a second one
// for the same participant, so they fail if the seeding is removed or if what
// reads it stops being reachable.
//
// S02's redesign (note2026_09_21_s02_cognitive_distortions) changed what reads
// the seed. Its opening used to branch on `returningParticipant` between a
// first-session and a returning greeting; the redesigned session has one
// opening, because in the protocol S02 always follows S01. The field is still
// seeded and is now READ BY NOTHING -- recorded here and in
// session-continuity.ts rather than removed, since the seed is cheap and a
// later session may want it. What the seed still drives is the homework
// question's recap, via previousS01HomeworkExampleCount.

const S02_OPENING = "Good to see you again";

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

async function firstAssistantMessage(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  return view?.messages.find((message) => message.role === "assistant")?.content ?? "";
}

describe("returning-participant continuity", () => {
  beforeEach(async () => {
    process.env.AI_PROVIDER = "mock";
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
  });

  it("opens a participant's very first session as a first session", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US" });
    expect(session.runtimeContext.fields.returningParticipant).toBeUndefined();
    expect(session.runtimeContext.homeworkStatus).toBe("not_assigned");

    await startRuntimeSession(session.id);
    expect(await firstAssistantMessage(session.id)).toContain(S02_OPENING);
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

  // S02 no longer branches its greeting on returningParticipant: it opens the
  // same way either way, because it always follows S01 in the protocol. The
  // seed still has to arrive -- previousS01HomeworkExampleCount depends on the
  // same computation -- which is what this checks.
  it("seeds a returning participant without changing S02's greeting", async () => {
    const first = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s05", locale: "en-US" });
    await startRuntimeSession(first.id);
    await runToCompletion(first.id);
    await ensureHomeworkForSession((await getRuntimeSession(first.id))!.session);

    const second = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US" });
    expect(second.runtimeContext.fields.returningParticipant).toBe(true);
    await startRuntimeSession(second.id);
    expect(await firstAssistantMessage(second.id)).toContain(S02_OPENING);
  }, 120_000);

  // S02 recalls the S01 homework -- what the practice was and how much of it
  // they did -- without seeding any S02 field and without naming their answers.
  it("recalls the S01 homework in S02, leaving S02's protected fields empty", async () => {
    const first = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "en-US" });
    await startRuntimeSession(first.id);
    await runToCompletion(first.id);
    const completed = (await getRuntimeSession(first.id))!.session;
    expect(completed.status).toBe("completed");
    const record = await ensureHomeworkForSession(completed);
    await appendHomeworkEntry(record!.id, DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData({ distortionId: "labeling", date: "2026-09-13", text: "I'm hopeless at this" }));
    await appendHomeworkEntry(record!.id, "example", { situation: "old", thought: "old", distortionName: "old" });

    const s01Fields = completed.runtimeContext.fields;
    expect(typeof s01Fields.s01RepresentativeProblem).toBe("string");
    const second = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US" });
    expect(second.runtimeContext.fields).toMatchObject({ previousSessionDefinitionId: "tbct-s01", previousS01HomeworkExampleCount: 1 });
    for (const key of ["problems", "problemRatings", "goals", "goalRatings"]) expect(second.runtimeContext.fields[key]).toBeUndefined();

    await startRuntimeSession(second.id);
    // The opening recalls the ground the last session covered, never the
    // participant's own answers -- same rule as S01's closing recap.
    const opening = await firstAssistantMessage(second.id);
    expect(opening).toContain(S02_OPENING);
    expect(opening).not.toContain(String(s01Fields.s01RepresentativeProblem).trim());

    // The homework question is where the S01 practice and how much of it they
    // did are recalled.
    const assistant = (await getRuntimeSession(second.id))!.messages.filter((message) => message.role === "assistant").map((message) => message.content);
    expect(assistant.some((text) => text.includes("'My examples'") && text.includes("You've written 1 so far."))).toBe(true);
  }, 180_000);
});

describe("S02 wording after S01", () => {
  const homeworkUpdate = CANONICAL_PROMPT_ITEMS.find((item) => item.id === "tbct-s02-n02-p01-homework-update")!;
  const fromS01 = { previousSessionDefinitionId: "tbct-s01", previousS01HomeworkExampleCount: 2 };

  it("recalls what the practice was and how much of it they did, in Korean", () => {
    const text = resolveS02StaticText(homeworkUpdate, fromS01, "ko-KR")!;
    expect(text).toContain("'내 예시' 칸에 적어 보기로 했었죠");
    expect(text).toContain("지금까지 2개 적어 주셨네요");
    // The question itself still follows the recap.
    expect(text).toContain("한 주 동안 과제는 어떠셨어요");
  });

  it("does not mention a count of zero", () => {
    const text = resolveS02StaticText(homeworkUpdate, { ...fromS01, previousS01HomeworkExampleCount: 0 }, "ko-KR")!;
    expect(text).not.toMatch(/0개/);
    expect(text).toContain("'내 예시'");
  });

  it("asks the plain question when the previous session was not S01 or nothing was carried", () => {
    const plain = resolveS02StaticText(homeworkUpdate, {}, "ko-KR")!;
    expect(plain).not.toContain("내 예시");
    expect(plain).toContain("한 주 동안 과제는 어떠셨어요");
    expect(resolveS02StaticText(homeworkUpdate, { previousSessionDefinitionId: "tbct-s05", previousS01HomeworkExampleCount: 3 }, "ko-KR")).toBe(plain);
    expect(resolveS02StaticText(homeworkUpdate, { previousSessionDefinitionId: "tbct-s01" }, "ko-KR")).toBe(plain);
  });

  it("reaches Korean at runtime, which the pre-redesign recap did not", () => {
    // The recap S02 carried before this redesign sat on prompts that also had
    // koreanText entries, and resolvePromptLocaleText prefers those outright --
    // so in Korean the recap only ever appeared in tests that called this
    // function directly. homework-update has no koreanText entry for that reason.
    expect(s02KoreanText[homeworkUpdate.id]).toBeUndefined();
  });
});
