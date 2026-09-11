import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { syntheticPatientInput } from "@/shared/runtime/testing/session-fidelity-fixtures";
import { appendHomeworkEntry, ensureHomeworkForSession } from "@/patient/lib/api/homework-api";
import { DISTORTION_EXAMPLE_ENTRY_TYPE, buildDistortionExampleData } from "@/patient/sessions/s01/distortion-table";
import { koreanText as s02KoreanText, resolveStaticText as resolveS02StaticText } from "@/patient/sessions/s02/messages";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";

// End-to-end cover for the gap session-continuity.ts closes: S02's
// returning-participant bridge existed in the catalog but could never run,
// because nothing ever set the `returningParticipant` field its activation
// conditions read. These tests run a real first session to completion and then
// open a second one for the same participant, so they fail if the seeding is
// removed OR if the bridge prompts stop being reachable.

const FIRST_SESSION_OPENING = "Hi! I'm here to help you map out";
const RETURNING_OPENING = "Welcome back";

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
    expect(await firstAssistantMessage(session.id)).toContain(FIRST_SESSION_OPENING);
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

  it("greets a returning participant with the bridge instead of the first-session opening", async () => {
    const first = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s05", locale: "en-US" });
    await startRuntimeSession(first.id);
    await runToCompletion(first.id);
    await ensureHomeworkForSession((await getRuntimeSession(first.id))!.session);

    const second = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US" });
    await startRuntimeSession(second.id);

    const opening = await firstAssistantMessage(second.id);
    expect(opening).toContain(RETURNING_OPENING);
    expect(opening).not.toContain(FIRST_SESSION_OPENING);
  }, 120_000);

  // S01 redesign (note2026_09_12_s01_redesign): S02 recalls the S01 answers
  // and homework in the participant's own words, without seeding S02 fields.
  it("recalls the participant's S01 words and homework in S02, leaving S02's problems empty", async () => {
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
    const opening = await firstAssistantMessage(second.id);
    expect(opening.startsWith("Welcome back. Last time you named")).toBe(true);
    expect(opening).toContain(String(s01Fields.s01RepresentativeProblem).trim());

    const view = await getRuntimeSession(second.id);
    await submitPatientInput(second.id, syntheticPatientInput(view!.currentPromptItem!), { clientTurnId: `${second.id}-turn-0`, expectedSessionVersion: view!.session.version ?? 0 });
    const assistant = (await getRuntimeSession(second.id))!.messages.filter((message) => message.role === "assistant").map((message) => message.content);
    expect(assistant.some((text) => text.includes("'My examples'") && text.includes("You've written 1 so far."))).toBe(true);
  }, 180_000);
});

describe("S02 wording after S01", () => {
  const prompt = (id: string) => CANONICAL_PROMPT_ITEMS.find((item) => item.id === id)!;
  const opening = prompt("tbct-s02-n01-p02-returning-opening");
  const bridge = prompt("tbct-s02-n01-p03-between-session-bridge");
  const framing = prompt("tbct-s02-n02-p01-problem-framing");
  const fromS01 = {
    previousSessionDefinitionId: "tbct-s01",
    previousS01Problems: ["불안이 심해요", "계획대로 안 되면 힘들어요", "사람들 의견이 다르면 위축돼요", "잠을 못 자요"],
    previousS01RepresentativeProblem: "불안이 심해요",
    previousS01Goal: "불안해도 할 일을 해내는 것",
    previousS01HomeworkExampleCount: 2,
  };

  it("recalls the participant's own words in Korean, around the unchanged prompt text", () => {
    expect(resolveS02StaticText(opening, fromS01, "ko-KR")).toBe(
      "다시 만나서 반가워요. 지난 시간에는 가장 큰 어려움으로 ‘불안이 심해요’, 상담이 끝났을 때 바라는 모습으로 ‘불안해도 할 일을 해내는 것’ 이야기를 해 주셨어요. " + s02KoreanText[opening.id].replace("다시 만나서 반가워요. ", ""),
    );
    expect(resolveS02StaticText(bridge, fromS01, "ko-KR")).toBe(`지난 시간에 인지 왜곡 목록을 곁에 두고, 그런 생각이 들 때 ‘내 예시’ 칸에 적어 보기로 했었죠. 지금까지 2개 적어 주셨네요. ${s02KoreanText[bridge.id]}`);
    const framingText = resolveS02StaticText(framing, fromS01, "ko-KR")!;
    expect(framingText).toContain("(‘불안이 심해요’, ‘계획대로 안 되면 힘들어요’, ‘사람들 의견이 다르면 위축돼요’)");
    expect(framingText).not.toContain("잠을 못 자요");
    expect(framingText.endsWith(s02KoreanText[framing.id])).toBe(true);
  });

  it("does not mention a count of zero", () => {
    const text = resolveS02StaticText(bridge, { ...fromS01, previousS01HomeworkExampleCount: 0 }, "ko-KR")!;
    expect(text).not.toMatch(/0개/);
    expect(text).toContain("‘내 예시’");
  });

  it("keeps the existing wording when the previous session was not S01 or nothing was carried", () => {
    for (const item of [opening, bridge, framing]) {
      expect(resolveS02StaticText(item, { ...fromS01, previousSessionDefinitionId: "tbct-s03" }, "ko-KR")).toBeUndefined();
      expect(resolveS02StaticText(item, { previousSessionDefinitionId: "tbct-s01" }, "ko-KR")).toBeUndefined();
      expect(resolveS02StaticText(item, {}, "en-US")).toBeUndefined();
    }
  });
});
