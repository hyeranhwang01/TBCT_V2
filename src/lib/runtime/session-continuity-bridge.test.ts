import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/lib/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/lib/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/lib/api/runtime-execution-api";
import { syntheticPatientInput } from "@/lib/runtime/testing/session-fidelity-fixtures";
import { ensureHomeworkForSession } from "@/lib/api/homework-api";

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
});
