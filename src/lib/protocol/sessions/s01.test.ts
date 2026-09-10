import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/lib/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/lib/api/runtime-execution-api";
import { getLocalDb } from "@/lib/db/tbct-local-db";
import { getWorksheetView } from "@/lib/worksheet/worksheet-projection";
import { syntheticPatientInput } from "@/lib/runtime/testing/session-fidelity-fixtures";

type RuntimeSessionView = NonNullable<Awaited<ReturnType<typeof getRuntimeSession>>>;

// S01 Opening redesign (Rapport -> Personal Situation Seed -> Initial
// Thought Probe -> Neutral Example -> Insight -> Return to the SAME
// personal example). See .claude/TASK_SCOPE.json's note2026_08_17b entry
// for the full rationale and s01.ts for the node/prompt structure.

async function currentPrompt(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view?.currentPromptItem) throw new Error(`Session ${sessionId} has no active prompt.`);
  return view;
}

/** Drives generic (synthetic) answers until the active prompt id matches
 * `targetPromptId`, or throws after maxTurns -- used for the parts of the
 * flow (Neutral Example candidates, insight) this file isn't specifically
 * asserting on, so OP-6/OP-7 don't need to hand-write every intervening turn. */
async function advanceTo(sessionId: string, targetPromptId: string, maxTurns = 20): Promise<RuntimeSessionView> {
  for (let i = 0; i < maxTurns; i += 1) {
    const view = await currentPrompt(sessionId);
    if (view.currentPromptItem!.id === targetPromptId) return view;
    await submitPatientInput(sessionId, syntheticPatientInput(view.currentPromptItem!));
  }
  throw new Error(`Did not reach ${targetPromptId} within ${maxTurns} turns.`);
}

describe("S01 Opening redesign", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("OP-1: normal flow reaches the Neutral Example only after situation + initial thought are both captured", async () => {
    const session = await createCanonicalTestRuntimeSession({ locale: "en-US" });
    await startRuntimeSession(session.id);

    const beforeSituation = await currentPrompt(session.id);
    expect(beforeSituation.currentPromptItem!.id).toBe("tbct-s01-n01-p02-telegraphic-situation");

    await submitPatientInput(session.id, { kind: "text", value: "My manager criticized my report in front of the whole team." });
    const afterSituation = await currentPrompt(session.id);
    expect(afterSituation.currentPromptItem!.id).toBe("tbct-s01-n02-p01-situation-or-thought");

    await submitPatientInput(session.id, { kind: "text", value: "I think that's the situation, not a thought." });
    const afterClarification = await currentPrompt(session.id);
    expect(afterClarification.currentPromptItem!.id).toBe("tbct-s01-n02-p02-initial-thought-probe");

    // The remaining prompts before the first Neutral Example question
    // (personal-example-redirect, preview-candidates, set-up-candidates) are
    // all passive (transition/explanation/instruction) and never wait for
    // patient input, so the runtime delivers and auto-completes all three in
    // the same turn as this answer -- landing directly on the first real
    // Neutral Example question.
    await submitPatientInput(session.id, { kind: "text", value: "I immediately thought everyone here thinks I'm incompetent." });
    const afterThought = await currentPrompt(session.id);
    expect(afterThought.currentPromptItem!.id).toBe("tbct-s01-n04-p01-candidate-one-emotion");

    const view = await getWorksheetView(session.id, "tbct-s01");
    expect(view?.fields.find((f) => f.definition.worksheetFieldKey === "situationThoughtDistinction")?.value?.value).toContain("manager criticized");
    expect(view?.fields.find((f) => f.definition.worksheetFieldKey === "openingInitialThought")?.value?.value).toContain("incompetent");
  }, 15_000);

  it("OP-2: after the situation answer, the very next turn does not ask for emotion, behavior, or body", async () => {
    const session = await createCanonicalTestRuntimeSession({ locale: "en-US" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "My manager criticized my report in front of the whole team." });
    const content = result.generatedMessage?.content?.toLowerCase() ?? "";
    expect(content).not.toMatch(/\bemotion\b|\bbehavior\b|\bbody\b|racing heart/);
  }, 15_000);

  it("redirects unmistakable small talk at the opening without storing it as the participant's situation", async () => {
    const session = await createCanonicalTestRuntimeSession({ locale: "ko-KR" });
    await startRuntimeSession(session.id);

    const result = await submitPatientInput(session.id, { kind: "text", value: "오늘 날씨가 어때?" });
    expect(result.turnOutcome).toBe("clarification");

    const afterSmallTalk = await currentPrompt(session.id);
    expect(afterSmallTalk.currentPromptItem!.id).toBe("tbct-s01-n01-p02-telegraphic-situation");
    const worksheetAfterSmallTalk = await getWorksheetView(session.id, "tbct-s01");
    expect(worksheetAfterSmallTalk?.fields.find((f) => f.definition.worksheetFieldKey === "situationThoughtDistinction")?.value).toBeNull();

    await submitPatientInput(session.id, { kind: "text", value: "회의에서 제 의견이 무시돼서 속상했어요." });
    const afterRealSituation = await currentPrompt(session.id);
    expect(afterRealSituation.currentPromptItem!.id).toBe("tbct-s01-n02-p01-situation-or-thought");
  }, 15_000);

  it("OP-5: uncertainty on the Initial Thought Probe is accepted, not treated as invalid, and does not stall the session", async () => {
    const session = await createCanonicalTestRuntimeSession({ locale: "en-US" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "My manager criticized my report in front of the whole team." });
    await submitPatientInput(session.id, { kind: "text", value: "That is the situation." });
    const view = await currentPrompt(session.id);
    expect(view.currentPromptItem!.id).toBe("tbct-s01-n02-p02-initial-thought-probe");

    const result = await submitPatientInput(session.id, { kind: "text", value: "I don't know." });
    expect(result.turnOutcome).toBe("normal");
    const after = await currentPrompt(session.id);
    expect(after.currentPromptItem!.id).not.toBe("tbct-s01-n02-p02-initial-thought-probe");
  }, 15_000);

  it("OP-4: an answer that reads as a feeling rather than a thought is still accepted, never forced into an enum choice", async () => {
    const session = await createCanonicalTestRuntimeSession({ locale: "en-US" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "My manager criticized my report in front of the whole team." });
    await submitPatientInput(session.id, { kind: "text", value: "That is the situation." });

    const result = await submitPatientInput(session.id, { kind: "text", value: "I just felt bad." });
    expect(result.turnOutcome).toBe("normal");
    const content = result.generatedMessage?.content?.toLowerCase() ?? "";
    expect(content).not.toMatch(/\byes or no\b|\bpositive or negative\b|\bchoose one of\b/);
  }, 15_000);

  it("OP-6 / OP-7: returning to the personal example reuses the same situation and thought instead of re-asking either", async () => {
    const session = await createCanonicalTestRuntimeSession({ locale: "en-US" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "My manager criticized my report in front of the whole team." });
    await submitPatientInput(session.id, { kind: "text", value: "That is the situation." });
    await submitPatientInput(session.id, { kind: "text", value: "I immediately thought everyone here thinks I'm incompetent." });

    const beforeView = await getWorksheetView(session.id, "tbct-s01");
    const situationBefore = beforeView?.fields.find((f) => f.definition.worksheetFieldKey === "situationThoughtDistinction")?.value?.value;
    const thoughtBefore = beforeView?.fields.find((f) => f.definition.worksheetFieldKey === "openingInitialThought")?.value?.value;
    expect(situationBefore).toContain("manager criticized");
    expect(thoughtBefore).toContain("incompetent");

    // Drive generically through the redirect + full Neutral Example + insight.
    // return-to-personal-example is passive (type: "transition"), so it is
    // delivered and auto-completed in the same turn as the insight answer,
    // landing directly on personal-emotion -- inspect the message history for
    // its bracket-substituted content rather than currentPromptItem.
    const personalEmotionView = await advanceTo(session.id, "tbct-s01-n08-p01-personal-emotion");
    expect(personalEmotionView.currentPromptItem!.id).toBe("tbct-s01-n08-p01-personal-emotion");
    const bridgeMessage = personalEmotionView.messages.find((message) => message.promptItemId === "tbct-s01-n07-p02-return-to-personal-example");
    const bridgeContent = bridgeMessage?.content ?? "";
    // The bracket-substituted bridge message should carry the SAME situation
    // and thought forward, not a generic unresolved placeholder.
    expect(bridgeContent).toContain("manager criticized");
    expect(bridgeContent).toContain("incompetent");
    expect(bridgeContent).not.toContain("[their situation]");
    expect(bridgeContent).not.toContain("[their initial thought]");

    const emotionQuestion = (personalEmotionView.currentPromptItem!.fallbackPatientText ?? "").toLowerCase();
    expect(emotionQuestion).not.toMatch(/what situation|describe.*situation|what happened/);

    const afterView = await getWorksheetView(session.id, "tbct-s01");
    expect(afterView?.fields.find((f) => f.definition.worksheetFieldKey === "situationThoughtDistinction")?.value?.value).toBe(situationBefore);
    expect(afterView?.fields.find((f) => f.definition.worksheetFieldKey === "openingInitialThought")?.value?.value).toBe(thoughtBefore);
  }, 20_000);

  it("OP-3: asking why the thought question is being asked stays on the same prompt and does not advance to the Neutral Example", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession({ locale: "en-US" });
      await startRuntimeSession(session.id);
      await submitPatientInput(session.id, { kind: "text", value: "My manager criticized my report in front of the whole team." });
      await submitPatientInput(session.id, { kind: "text", value: "That is the situation." });
      const before = await currentPrompt(session.id);
      expect(before.currentPromptItem!.id).toBe("tbct-s01-n02-p02-initial-thought-probe");

      const result = await submitPatientInput(session.id, { kind: "text", value: "Why are you asking this?" });
      const after = await currentPrompt(session.id);
      expect(after.currentPromptItem!.id).toBe("tbct-s01-n02-p02-initial-thought-probe");
      expect(result.generatedMessage?.content).toBeTruthy();
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);
});

// S01 Cognitive Distortions redesign: registry-driven candidates (never
// Claude-invented), no external-list gate. See .claude/TASK_SCOPE.json's
// note2026_08_17d entry and s01-distortion-candidates.test.ts for the
// selector's own unit tests.
describe("S01 Cognitive Distortions redesign", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  const WORKED_EXAMPLE_THOUGHT = "공부할 양이 너무 많아서 다 할 수 있을까? 다 못하면 어떻게 하지?";

  async function driveToIdentifyDistortion(automaticThought: string) {
    const session = await createCanonicalTestRuntimeSession({ locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "다음 주에 큰 시험이 있다." });
    await submitPatientInput(session.id, { kind: "text", value: "그건 상황이에요." });
    await submitPatientInput(session.id, { kind: "text", value: automaticThought });
    const view = await advanceTo(session.id, "tbct-s01-n10-p02-identify-distortion");
    return { session, view };
  }

  it("no longer asks whether the participant has a physical distortions list", async () => {
    const { view } = await driveToIdentifyDistortion(WORKED_EXAMPLE_THOUGHT);
    const allDelivered = view.messages.filter((m) => m.role === "assistant").map((m) => m.content).join(" ");
    expect(allDelivered).not.toMatch(/목록을 가지고 계신가요|Annex|사전 안내문/);
    expect(view.promptItems.some((p) => p.id.includes("confirm-list"))).toBe(false);
    expect(view.promptItems.some((p) => p.id.includes("read-distortions"))).toBe(false);
  });

  it("presents registry-approved candidates including '만약에? 사고' and '미래예측 / 파국화' for the worked example thought", async () => {
    const { view } = await driveToIdentifyDistortion(WORKED_EXAMPLE_THOUGHT);
    const message = view.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    expect(message).toContain("'만약에?' 사고");
    expect(message).toContain("미래예측 / 파국화");
  });

  it("Claude never confirms/diagnoses a single distortion as THE answer -- candidates are framed as options", async () => {
    const { view } = await driveToIdentifyDistortion(WORKED_EXAMPLE_THOUGHT);
    const message = view.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    expect(message).not.toMatch(/당신의\s*인지왜곡은|이것이\s*정답입니다/);
  });

  it("progresses to Closing even when the participant selects none of the candidates", async () => {
    const { session } = await driveToIdentifyDistortion(WORKED_EXAMPLE_THOUGHT);
    const result = await submitPatientInput(session.id, { kind: "text", value: "없는 것 같아요." });
    expect(result.turnOutcome).toBe("normal");
    const meaningView = await currentPrompt(session.id);
    expect(meaningView.currentPromptItem!.id).toBe("tbct-s01-n10-p03-meaning-of-distortion");
    await submitPatientInput(session.id, syntheticPatientInput(meaningView.currentPromptItem!));
    const finalView = await getRuntimeSession(session.id);
    expect(finalView?.session.status).toBe("completed");
  }, 20_000);

  it("uncertainty ('잘 모르겠어요') at identify-distortion is accepted, not treated as invalid", async () => {
    const { session } = await driveToIdentifyDistortion(WORKED_EXAMPLE_THOUGHT);
    const result = await submitPatientInput(session.id, { kind: "text", value: "잘 모르겠어요." });
    expect(result.turnOutcome).toBe("normal");
  });

  it("a meta-question at identify-distortion stays on the same prompt instead of being stored as the selection", async () => {
    const { session, view } = await driveToIdentifyDistortion(WORKED_EXAMPLE_THOUGHT);
    await submitPatientInput(session.id, { kind: "text", value: "그게 무슨 말이에요?" });
    const after = await currentPrompt(session.id);
    expect(after.currentPromptItem!.id).toBe(view.currentPromptItem!.id);
  });
});
