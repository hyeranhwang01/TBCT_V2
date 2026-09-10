import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/lib/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/lib/api/runtime-execution-api";
import { getLocalDb } from "@/lib/db/tbct-local-db";
import { parsePrivatePlaceholderLabelsInput } from "@/lib/runtime/runtime-deterministic-input";

// TBCT S01-S03 정상 발화 오인 수정 (2026-08-17 fidelity pass), S02 section.
// Regression coverage for P0-1 (refusal false positive), P0-2 (noMore false
// positive), P0-3 (opening no longer forces/rejects patient input), P0-4
// (yes/no prompts accept 네/아니요), and P1-1 (color/uncertain rating).

async function current(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error(`Session ${sessionId} not found.`);
  return view;
}

describe("S02 Problems and Goals -- 정상 발화 오인 수정", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("P0-3: opening never waits for/rejects a patient answer -- the session starts already on problem-framing", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    const started = await startRuntimeSession(session.id);
    // null would mean claimRuntimeSessionStart lost a race to a concurrent
    // caller (see runtime-execution-api.ts) -- can't happen here, a fresh
    // session with exactly one sequential start call.
    if (!started) throw new Error("startRuntimeSession returned null");
    // Before the fix, the opening prompt's outputFields: ["openingMode"] made
    // it wait for a patient answer with no validation.kind to accept one,
    // so a real "네" was rejected as filler and the session stalled here.
    expect(started.currentPromptItemId).toBe("tbct-s02-n02-p01-problem-framing");
  }, 15_000);

  it("P0-1/P0-2: a habit-refusal-shaped sentence and an unrelated '없어요' sentence are both stored as real problems, not misclassified", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);

    // "이 행동을 그만하고 싶어요" names a HABIT as the thing to stop, not the
    // session itself -- must not be classified as session refusal.
    const first = await submitPatientInput(session.id, { kind: "text", value: "초조하면 머리카락을 만지작거리는데 이 행동을 그만하고 싶어요" });
    expect(first.turnOutcome).toBe("normal");
    let view = await current(session.id);
    expect(view.session.runtimeContext.fields.problems).toContain("초조하면 머리카락을 만지작거리는데 이 행동을 그만하고 싶어요");

    // "의욕이 없어요" is real clinical content ("I have no motivation"), not
    // the literal "no more items" termination phrase -- must be stored, not
    // treated as ending the problems list.
    const second = await submitPatientInput(session.id, { kind: "text", value: "의욕이 없어요" });
    expect(second.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problems).toContain("의욕이 없어요");
    expect(view.session.runtimeContext.fields.problemsNoMore).not.toBe(true);
  }, 15_000);

  it("P0-5: a process clarification request ('뭐를 말하면 되나요?') is explained, not stored as a problem, and does not burn a clarification attempt", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);

    const before = await current(session.id);
    expect(before.session.runtimeContext.clarificationAttemptCount ?? 0).toBe(0);

    const result = await submitPatientInput(session.id, { kind: "text", value: "뭐를 말하면 되나요?" });
    expect(result.turnOutcome).toBe("clarification");
    expect(result.generatedMessage?.content).toContain("어려움");

    const after = await current(session.id);
    // Not stored as a clinical answer.
    expect(after.session.runtimeContext.fields.problems).toBeUndefined();
    // The active prompt is unchanged, and the request did not count toward
    // MAX_CLARIFICATION_ATTEMPTS.
    expect(after.currentPromptItem?.id).toBe("tbct-s02-n02-p01-problem-framing");
    expect(after.session.runtimeContext.clarificationAttemptCount ?? 0).toBe(0);

    // The participant can now answer normally, with the attempt count still
    // untouched by the earlier clarification request.
    const answer = await submitPatientInput(session.id, { kind: "text", value: "일이 너무 많아요" });
    expect(answer.turnOutcome).toBe("normal");
  }, 15_000);

  /** Drives generic filler answers through the seven elicit-problems prompts
   * and the private-placeholder step, landing on the boolean rating-card
   * check -- the parts of the flow this file isn't specifically asserting
   * on, so the rating-section tests below don't need to hand-write every
   * intervening turn. */
  async function reachRatingCardCheck(sessionId: string, maxTurns = 20) {
    for (let i = 0; i < maxTurns; i += 1) {
      const view = await current(sessionId);
      if (view.currentPromptItem?.id === "tbct-s02-n04-p01-rating-card-check") return;
      // offer-private-placeholders is a closed-form X/Y/Z-or-decline answer
      // (Phase 1, runtime orchestration simplification) -- generic filler
      // text is neither a nameable letter nor an explicit decline, so it no
      // longer silently succeeds here (that used to be exactly the "parse
      // failure treated as decline" bug this phase fixes). An explicit
      // decline reaches rating-card-check the same way a real participant
      // who doesn't have a private problem would.
      const value = view.currentPromptItem?.id === "tbct-s02-n03-p01-offer-private-placeholders" ? "아니요" : `필러 문제 ${i}`;
      await submitPatientInput(sessionId, { kind: "text", value });
    }
    const view = await current(sessionId);
    throw new Error(`Did not reach rating-card-check within ${maxTurns} turns; stopped at ${view.currentPromptItem?.id}`);
  }

  it("P0-4: real yes/no prompts (rating card check, comprehension check) accept 네 instead of looping", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachRatingCardCheck(session.id);

    const cardCheck = await submitPatientInput(session.id, { kind: "text", value: "네" });
    expect(cardCheck.turnOutcome).toBe("normal");

    const view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n04-p03-discomfort-distress-distinction");
    const comprehensionCheck = await submitPatientInput(session.id, { kind: "text", value: "네" });
    expect(comprehensionCheck.turnOutcome).toBe("normal");
  }, 15_000);

  it("P1-1: rating accepts a color word, and 'X와 Y 사이' asks for clarification instead of silently recording the first number", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachRatingCardCheck(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "네" }); // rating-card-check
    await submitPatientInput(session.id, { kind: "text", value: "네" }); // discomfort-distress-distinction

    const colorAnswer = await submitPatientInput(session.id, { kind: "text", value: "노란색이요" });
    expect(colorAnswer.turnOutcome).toBe("normal");
    let view = await current(session.id);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([4]);

    const uncertainAnswer = await submitPatientInput(session.id, { kind: "text", value: "2와 3 사이 같아요" });
    expect(uncertainAnswer.turnOutcome).toBe("normal");
    view = await current(session.id);
    // Not silently recorded as 2 (or any value) -- the rating for this item
    // is still pending.
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([4]);
    expect(view.session.runtimeContext.fields.currentProblemScoreUncertain).toBe(true);
    const lastMessage = view.messages[view.messages.length - 1];
    expect(lastMessage.content).toMatch(/2점|3점/);

    const resolved = await submitPatientInput(session.id, { kind: "text", value: "3이요" });
    expect(resolved.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([4, 3]);
    expect(view.session.runtimeContext.fields.currentProblemScoreUncertain).toBe(false);
  }, 15_000);
});

// Real-runtime reproduction of the exact bug reported against
// `npx tsx scripts/run-local-session.ts tbct-s02 --interactive`: unit-level
// assertions on isExplicitPatientRefusal alone (as in the describe block
// above) missed the fact that a naturally-phrased sentence -- where the
// target being stopped is named in an EARLIER clause, not immediately
// adjacent to "그만" -- still slipped through the previous fix and paused
// the session. This block drives the exact reported sentence through
// submitPatientInput (the same function the interactive script and the
// production API call), not just the detector function in isolation. See
// .claude/TASK_SCOPE.json's note2026_08_17f entry.
describe("S02 -- real interactive-runtime refusal reproduction (P0 re-fix)", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it.each([
    "머리카락 만지는 습관이 있는데 그만하고싶어요",
    "머리카락 만지는 습관이 있는데 그만하고 싶어요",
    "머리카락을 만지는 행동을 그만하고싶어요",
    "머리카락을 만지는 행동을 그만하고 싶어요",
  ])("%s -> not a refusal, not paused, stored as the problem, session continues", async (answer) => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);

    const result = await submitPatientInput(session.id, { kind: "text", value: answer });
    expect(result.turnOutcome).toBe("normal");
    expect(result.sessionStatus).not.toBe("paused");
    expect(result.stateExtraction?.riskSignals ?? []).not.toContain("patient_refusal_semantic");
    expect(result.generatedMessage?.metadata?.clarificationReason).not.toBe("patient_refusal");

    const view = await current(session.id);
    expect(view.session.status).not.toBe("paused");
    expect(view.session.runtimeContext.fields.problems).toContain(answer);
    // The session actually continues to the next problem-collection prompt,
    // not stuck re-asking the same one.
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n02-p02-problem-home-work-relationships");
  }, 15_000);
});

// Section 14's required end-to-end scenario: full S02 walkthrough covering
// P0 (refusal/noMore), the problems-collection early-exit fix, the
// known-blocker private-placeholder fix, and the CCPH/CCGH scale UX pass
// (card-optional, readable per-anchor explanation, discomfort/distress
// split, comprehension check, color-or-number answers, and the CCGH
// same-color-different-meaning framing).
describe("S02 -- full required E2E scenario (refusal fix + CCPH/CCGH scale UX)", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("runs the complete S02 flow end to end with no pause", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);

    // -- Problem collection: refusal-shaped habit statement, then "no more". --
    const problemAnswer = await submitPatientInput(session.id, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    expect(problemAnswer.turnOutcome).toBe("normal");
    expect(problemAnswer.sessionStatus).not.toBe("paused");

    const noMore = await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    expect(noMore.turnOutcome).toBe("normal");
    let view = await current(session.id);
    expect(view.session.runtimeContext.fields.problems).toEqual(["머리카락 만지는 습관이 있는데 그만하고싶어요"]);
    // The remaining follow-up problem prompts (p03-p06) are skipped once
    // "no more" is said -- collection moves straight to the private-
    // placeholder step, not four more "anything else?" questions.
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n03-p01-offer-private-placeholders");

    // -- Known blocker: declining a private placeholder must not block. --
    const declinePlaceholder = await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    expect(declinePlaceholder.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n04-p01-rating-card-check");

    // -- Problem scale: no card, scale explained verbally, comprehension check. --
    const noCard = await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    expect(noCard.turnOutcome).toBe("normal");
    view = await current(session.id);
    const scaleMessage = view.messages.find((m) => m.promptItemId === "tbct-s02-n04-p02-six-anchor-problem-scale");
    expect(scaleMessage).toBeDefined();
    const scaleText = scaleMessage!.content;
    // Card absence acknowledged, not a blocker.
    expect(scaleText).toMatch(/카드가 없어도/);
    // 0-5 meanings present and readable (not just a compressed anchor dump).
    expect(scaleText).toMatch(/0점,\s*연한\s*파란색/);
    expect(scaleText).toMatch(/5점,\s*빨간색/);
    // Numeric-or-color framing, and "not a grade" framing.
    expect(scaleText).toMatch(/숫자로.*색상으로/);
    expect(scaleText).toMatch(/잘하고\s*못하고를\s*평가하는\s*점수가\s*아니/);

    const distinctionMessage = view.messages.find((m) => m.promptItemId === "tbct-s02-n04-p03-discomfort-distress-distinction");
    expect(distinctionMessage).toBeDefined();
    expect(distinctionMessage!.content).toMatch(/0~3점/);
    expect(distinctionMessage!.content).toMatch(/4~5점/);
    expect(distinctionMessage!.content).toMatch(/이해되시나요/);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n04-p03-discomfort-distress-distinction");

    const comprehensionOk = await submitPatientInput(session.id, { kind: "text", value: "네" });
    expect(comprehensionOk.turnOutcome).toBe("normal");

    // -- First problem rating, by color word. --
    const problemRating = await submitPatientInput(session.id, { kind: "text", value: "노란색이요" });
    expect(problemRating.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([4]);

    // Compatibility guard: this acknowledgment now auto-advances because it
    // contains no question. The branch remains so this older long-form flow
    // test can also run against a historical release snapshot if needed.
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress") {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
    }

    // -- Goals: one goal, "no more", card available this time. --
    view = await current(session.id);
    // Drive through the problem-summary transition prompts if still pending.
    for (let i = 0; i < 5 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n07-p01-goal-framing");

    const goalAnswer = await submitPatientInput(session.id, { kind: "text", value: "발표할 때 덜 긴장하고 싶어요" });
    expect(goalAnswer.turnOutcome).toBe("normal");
    const goalNoMore = await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    expect(goalNoMore.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goals).toEqual(["발표할 때 덜 긴장하고 싶어요"]);
    // goal-dream-small-step ("is there a distant-dream goal to break into a
    // small first step?") is an elaboration prompt, not an elicitation
    // follow-up -- it still fires after goalsNoMore, unlike goal-life-change
    // etc. above, since it asks about an ALREADY-named goal rather than
    // trying to surface a new one.
    if (view.currentPromptItem?.id === "tbct-s02-n07-p08-goal-dream-small-step") {
      await submitPatientInput(session.id, { kind: "text", value: "아니요" });
      view = await current(session.id);
    }
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n08-p01-goal-rating-card-check");

    const goalCardAvailable = await submitPatientInput(session.id, { kind: "text", value: "네" });
    expect(goalCardAvailable.turnOutcome).toBe("normal");
    view = await current(session.id);
    const goalScaleMessage = view.messages.find((m) => m.promptItemId === "tbct-s02-n08-p02-six-anchor-goal-scale");
    expect(goalScaleMessage).toBeDefined();
    // CCGH must explicitly say the colors repeat but the MEANING is different.
    expect(goalScaleMessage!.content).toMatch(/색상.*같.*의미.*(다르|달라)/);
    expect(goalScaleMessage!.content).toMatch(/0점,\s*연한\s*파란색/);
    expect(goalScaleMessage!.content).toMatch(/5점,\s*빨간색/);

    const goalRating = await submitPatientInput(session.id, { kind: "text", value: "진한 초록색이요" });
    expect(goalRating.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goalRatings).toEqual([3]);

    // -- Session reaches completion, never paused at any point. --
    for (let i = 0; i < 6 && view.session.status === "waiting_for_input"; i += 1) {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    expect(view.session.status).toBe("completed");
  }, 20_000);
});

// Follow-up task: two additional manual-control failures found in real S02
// testing, distinct from the ones above. See .claude/TASK_SCOPE.json's
// note2026_08_17h entry for root cause and file-level detail.
describe("S02 -- manual-control follow-up fixes (problem-confirmation + rating-card boolean)", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  // Test 1: confirmation auto-progress. problem-confirmation only becomes
  // the active step (rather than being auto-delivered and skipped in the
  // same turn) when problemsNoMore is NOT set, which needs every
  // elicit-problems follow-up answered without ever saying "no more".
  it("Test 1: problem-confirmation delivers its acknowledgment and auto-advances, never demanding a new 'problems' answer", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    for (const answer of ["문제1", "문제2", "문제3", "문제4", "문제5"]) {
      const result = await submitPatientInput(session.id, { kind: "text", value: answer });
      expect(result.turnOutcome).toBe("normal");
    }
    const view = await current(session.id);
    // The confirmation message was actually delivered to the participant...
    const confirmationMessage = view.messages.find((m) => m.promptItemId === "tbct-s02-n02-p06-problem-confirmation");
    expect(confirmationMessage).toBeDefined();
    expect(confirmationMessage!.content).toContain("목록에 추가할게요");
    // ...but the runtime did not stop and wait for a fresh "problems"
    // answer to it -- it auto-advanced to the next node in the same turn
    // as "문제5", landing on the private-placeholder step.
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n03-p01-offer-private-placeholders");
    // The five entries collected are exactly what was said -- nothing
    // extra (like a stray "네") got appended, nothing got overwritten.
    expect(view.session.runtimeContext.fields.problems).toEqual(["문제1", "문제2", "문제3", "문제4", "문제5"]);
  }, 15_000);

  async function reachRatingCardCheck(sessionId: string) {
    await submitPatientInput(sessionId, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    await submitPatientInput(sessionId, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" }); // decline private placeholder
  }

  // Test 2 + Test 3: problem rating card unavailable, several phrasings.
  it.each(["아니요 설명해주세요", "아니요", "없어요", "카드 없어요", "없는데 설명해주세요"])(
    "Test 2/3: '%s' -> problemScaleCardAvailable=false, no clarification-attempt cost, session continues to the CCPH explanation",
    async (answer) => {
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
      await startRuntimeSession(session.id);
      await reachRatingCardCheck(session.id);
      const before = await current(session.id);
      expect(before.currentPromptItem?.id).toBe("tbct-s02-n04-p01-rating-card-check");
      const beforeAttempts = before.session.runtimeContext.clarificationAttemptCount ?? 0;

      const result = await submitPatientInput(session.id, { kind: "text", value: answer });
      expect(result.turnOutcome).toBe("normal");
      expect(result.sessionStatus).not.toBe("paused");

      const after = await current(session.id);
      expect(after.session.runtimeContext.fields.problemScaleCardAvailable).toBe(false);
      expect(after.session.runtimeContext.clarificationAttemptCount ?? 0).toBe(beforeAttempts);
      // Next relevant prompt is the CCPH explanation (six-anchor-problem-scale
      // auto-delivers and chains straight into the comprehension check).
      expect(after.currentPromptItem?.id).toBe("tbct-s02-n04-p03-discomfort-distress-distinction");
      const scaleMessage = after.messages.find((m) => m.promptItemId === "tbct-s02-n04-p02-six-anchor-problem-scale");
      expect(scaleMessage).toBeDefined();
      expect(scaleMessage!.content).toMatch(/0점,\s*연한\s*파란색/);
      // Never the generic catch-all clarification.
      expect(after.messages.some((m) => m.content.includes("짧고 구체적인 예를"))).toBe(false);
    },
    15_000,
  );

  // Test 4: same fixes apply to the goal rating card.
  it.each(["아니요 설명해주세요", "없어요"])("Test 4: goal rating card '%s' -> goalScaleCardAvailable=false, session continues to CCGH explanation", async (answer) => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachRatingCardCheck(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "네" }); // problem rating card available
    await submitPatientInput(session.id, { kind: "text", value: "네" }); // discomfort/distress comprehension check
    await submitPatientInput(session.id, { kind: "text", value: "노란색이요" }); // first problem rating
    let view = await current(session.id);
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress") {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    for (let i = 0; i < 5 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    await submitPatientInput(session.id, { kind: "text", value: "목표1" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    view = await current(session.id);
    if (view.currentPromptItem?.id === "tbct-s02-n07-p08-goal-dream-small-step") {
      await submitPatientInput(session.id, { kind: "text", value: "아니요" });
      view = await current(session.id);
    }
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n08-p01-goal-rating-card-check");

    const result = await submitPatientInput(session.id, { kind: "text", value: answer });
    expect(result.turnOutcome).toBe("normal");
    expect(result.sessionStatus).not.toBe("paused");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goalScaleCardAvailable).toBe(false);
    const goalScaleMessage = after.messages.find((m) => m.promptItemId === "tbct-s02-n08-p02-six-anchor-goal-scale");
    expect(goalScaleMessage).toBeDefined();
    expect(goalScaleMessage!.content).toMatch(/0점,\s*연한\s*파란색/);
  }, 15_000);

  // Test 5: existing yes path still works, including the "have it"
  // phrasings this fix newly recognizes.
  it.each(["네", "있어요", "가지고 있어요", "예"])("Test 5: '%s' -> problemScaleCardAvailable=true, session continues normally", async (answer) => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachRatingCardCheck(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: answer });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problemScaleCardAvailable).toBe(true);
  }, 15_000);
});

describe("S02 -- passive reflection auto-progression", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("moves from a high final problem rating to goal collection without asking the patient to answer an acknowledgment", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "업무를 계속 미루고 있어요" });
    await submitPatientInput(session.id, { kind: "text", value: "더 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "네" });
    await submitPatientInput(session.id, { kind: "text", value: "5" });

    const view = await current(session.id);
    expect(view.messages.some((message) => message.promptItemId === "tbct-s02-n05-p02-acknowledge-distress")).toBe(true);
    expect(view.messages.some((message) => message.promptItemId === "tbct-s02-n06-p02-problem-total-personal")).toBe(true);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n07-p01-goal-framing");
  }, 15_000);
});

// TBCT Session 2 매뉴얼 통제 복구 -- 최소 범위 수정 (2026-08-17). Regression
// coverage for P0-1 (meta-utterance/no-more idiom contamination in
// problems/goals), P0-2 (X/Y/Z private placeholders rated alongside regular
// problems), P0-3 (rating corrections checked before numeric validation),
// P0-4 (goal-dream-small-step gated on a real distant dream), and P1
// (rating-card-check clarification explains the actual card/scale, not the
// generic "give a short example" fallback). See .claude/TASK_SCOPE.json's
// note2026_08_17i entry for root cause and file-level detail.
describe("S02 -- manual-control recovery (meta-utterance contamination, X/Y/Z rating, rating corrections, distant-dream gating, rating-card clarification)", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  // Test 1: meta remark about the problem question itself must never land in
  // `problems`, even after several real problems were already collected.
  it("Test 1 (P0-1): '앞에서 말했잖아요' after three real problems is not stored, and does not end the problems list", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);

    await submitPatientInput(session.id, { kind: "text", value: "머리카락 뜯는 습관" });
    await submitPatientInput(session.id, { kind: "text", value: "공부가 어려워요" });
    await submitPatientInput(session.id, { kind: "text", value: "공부와 영어회화를 병행하기 어렵다" });

    const before = await current(session.id);
    const metaResult = await submitPatientInput(session.id, { kind: "text", value: "앞에서 말했잖아요" });
    expect(metaResult.turnOutcome).toBe("clarification");

    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems).toEqual(["머리카락 뜯는 습관", "공부가 어려워요", "공부와 영어회화를 병행하기 어렵다"]);
    expect(after.session.runtimeContext.fields.problems).not.toContain("앞에서 말했잖아요");
    // Still on the same prompt -- clarification never advances or ends collection.
    expect(after.currentPromptItem?.id).toBe(before.currentPromptItem?.id);
    expect(after.session.runtimeContext.fields.problemsNoMore).not.toBe(true);
  }, 15_000);

  // Test 2: same meta-question protection on the goals side.
  it("Test 2 (P0-1): '무슨질문이요?' at goal collection is not stored in goals and triggers clarification", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    // Fast-path to goal-framing via the existing full-flow pattern: one
    // problem, immediate "no more", decline placeholder, decline card, pass
    // comprehension check, rate the single problem, then drive transition
    // prompts through to goal-framing.
    await submitPatientInput(session.id, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" }); // decline placeholder
    await submitPatientInput(session.id, { kind: "text", value: "아니요" }); // decline rating card
    await submitPatientInput(session.id, { kind: "text", value: "네" }); // comprehension check
    await submitPatientInput(session.id, { kind: "text", value: "2" }); // rate the one problem
    let view = await current(session.id);
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress" || view.currentPromptItem?.id === "tbct-s02-n05-p03-acknowledge-manageable") {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    for (let i = 0; i < 5 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n07-p01-goal-framing");

    const metaResult = await submitPatientInput(session.id, { kind: "text", value: "무슨질문이요?" });
    expect(metaResult.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals ?? []).not.toContain("무슨질문이요?");
    expect(after.currentPromptItem?.id).toBe("tbct-s02-n07-p01-goal-framing");
  }, 15_000);

  // Test 3: "이미 이루어서 없어요" is an idiom outside isNoMoreEvidence's
  // exact-match set -- must still be recognized as "nothing more", not
  // stored as a literal goal.
  it("Test 3 (P0-1): '이미 이루어서 없어요' sets goalsNoMore and is not stored in goals", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "네" });
    await submitPatientInput(session.id, { kind: "text", value: "2" });
    let view = await current(session.id);
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress" || view.currentPromptItem?.id === "tbct-s02-n05-p03-acknowledge-manageable") {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    for (let i = 0; i < 5 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n07-p01-goal-framing");

    await submitPatientInput(session.id, { kind: "text", value: "목표1" });
    const noMoreResult = await submitPatientInput(session.id, { kind: "text", value: "이미 이루어서 없어요" });
    expect(noMoreResult.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표1"]);
    expect(after.session.runtimeContext.fields.goals).not.toContain("이미 이루어서 없어요");
    expect(after.session.runtimeContext.fields.goalsNoMore).toBe(true);
  }, 15_000);

  /** Drives three named problems, closes collection, and adds X as a private
   * placeholder, landing on the problem-scale rating-card-check. */
  async function reachRatingCardCheckWithThreeProblemsAndX(sessionId: string) {
    await submitPatientInput(sessionId, { kind: "text", value: "문제1" }); // problem-framing
    await submitPatientInput(sessionId, { kind: "text", value: "문제2" }); // problem-home-work-relationships
    await submitPatientInput(sessionId, { kind: "text", value: "문제3" }); // problem-avoidance
    await submitPatientInput(sessionId, { kind: "text", value: "더 생각나는 건 없어요" }); // problem-therapy-goal -> noMore
    await submitPatientInput(sessionId, { kind: "text", value: "X로 할게요" }); // offer-private-placeholders
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" }); // rating-card-check (decline card)
    await submitPatientInput(sessionId, { kind: "text", value: "네" }); // discomfort-distress-distinction
  }

  // Test 4 (P0-2): the required regression scenario verbatim -- problems has
  // 3 real items, X is added as a private placeholder, and the rating loop
  // must visit 문제1 -> 문제2 -> 문제3 -> X in that order, never marking
  // allProblemsRated before X itself is rated.
  it("Test 4 (P0-2): X becomes the 4th CCPH rating target, rated after the three named problems", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachRatingCardCheckWithThreeProblemsAndX(session.id);

    let view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n05-p01-reflect-problem-score");
    expect(view.session.runtimeContext.fields.problems).toEqual(["문제1", "문제2", "문제3", "X"]);
    expect(view.session.runtimeContext.fields.currentProblemText).toBe("문제1");

    const r1 = await submitPatientInput(session.id, { kind: "text", value: "2" });
    expect(r1.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([2]);
    expect(view.session.runtimeContext.fields.currentProblemText).toBe("문제2");
    expect(view.session.runtimeContext.fields.allProblemsRated).not.toBe(true);

    const r2 = await submitPatientInput(session.id, { kind: "text", value: "2" });
    expect(r2.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([2, 2]);
    expect(view.session.runtimeContext.fields.currentProblemText).toBe("문제3");
    expect(view.session.runtimeContext.fields.allProblemsRated).not.toBe(true);

    const r3 = await submitPatientInput(session.id, { kind: "text", value: "2" });
    expect(r3.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([2, 2, 2]);
    // Critical assertion: X is the next rating target, and rating is NOT
    // considered complete before X itself is rated.
    expect(view.session.runtimeContext.fields.currentProblemText).toBe("X");
    expect(view.session.runtimeContext.fields.allProblemsRated).not.toBe(true);

    const r4 = await submitPatientInput(session.id, { kind: "text", value: "2" });
    expect(r4.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([2, 2, 2, 2]);
    expect(view.session.runtimeContext.fields.allProblemsRated).toBe(true);
  }, 15_000);

  // Test 5 (P0-3a): the participant rejects the CURRENT goal as not actually
  // a goal, with no number in the message at all. Must not be forced into a
  // numeric rating; the item is removed and rating moves to the next goal.
  it("Test 5 (P0-3a): 'that's not a goal' correction removes the current goal without recording a rating, moves to the next goal", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "네" });
    await submitPatientInput(session.id, { kind: "text", value: "2" });
    let view = await current(session.id);
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress" || view.currentPromptItem?.id === "tbct-s02-n05-p03-acknowledge-manageable") {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    for (let i = 0; i < 5 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n07-p01-goal-framing");

    await submitPatientInput(session.id, { kind: "text", value: "목표1" });
    await submitPatientInput(session.id, { kind: "text", value: "부가적인 스트레스가 줄 것 같아요" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n08-p01-goal-rating-card-check");
    await submitPatientInput(session.id, { kind: "text", value: "네" });

    view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    expect(view.session.runtimeContext.fields.currentGoalText).toBe("목표1");

    const firstRating = await submitPatientInput(session.id, { kind: "text", value: "2" });
    expect(firstRating.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.currentGoalText).toBe("부가적인 스트레스가 줄 것 같아요");

    const correction = await submitPatientInput(session.id, { kind: "text", value: "그건 문제행동을 고친 미래를 말한 거라 목표가 아닌데?" });
    expect(correction.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goals).toEqual(["목표1"]);
    expect(view.session.runtimeContext.fields.goalRatings).toEqual([2]);
    expect(view.session.runtimeContext.fields.allGoalsRated).toBe(true);
  }, 15_000);

  // Test 6 (P0-3b): a duplicate correction WITH a leading number attached
  // ("5. 근데 이것도...") -- the 5 must never be recorded as a rating; the
  // item is removed as a duplicate, and problems/problemRatings stay aligned.
  it("Test 6 (P0-3b): '5. 근데 이것도 앞에서 했는데 왜 또 해야해?' does not record 5, removes the duplicate, keeps list/rating alignment", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "문제1" });
    await submitPatientInput(session.id, { kind: "text", value: "문제2" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" }); // decline placeholder
    await submitPatientInput(session.id, { kind: "text", value: "아니요" }); // decline card
    await submitPatientInput(session.id, { kind: "text", value: "네" }); // comprehension check

    let view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n05-p01-reflect-problem-score");
    expect(view.session.runtimeContext.fields.currentProblemText).toBe("문제1");

    const firstRating = await submitPatientInput(session.id, { kind: "text", value: "2" });
    expect(firstRating.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.currentProblemText).toBe("문제2");

    const duplicateWithNumber = await submitPatientInput(session.id, { kind: "text", value: "5. 근데 이것도 앞에서 했는데 왜 또 해야해?" });
    expect(duplicateWithNumber.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problems).toEqual(["문제1"]);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([2]);
    expect(view.session.runtimeContext.fields.problemRatings).not.toContain(5);
    expect(view.session.runtimeContext.fields.allProblemsRated).toBe(true);
  }, 15_000);

  // Test 7 (P0-4): the distant-dream small-step follow-up must be skipped
  // when no real distant dream was named, and must fire when one was.
  it("Test 7a (P0-4): goal-dream-small-step is skipped when goal-dream ends in 'no more', not a real dream", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "네" });
    await submitPatientInput(session.id, { kind: "text", value: "2" });
    let view = await current(session.id);
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress" || view.currentPromptItem?.id === "tbct-s02-n05-p03-acknowledge-manageable") {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    for (let i = 0; i < 5 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n07-p01-goal-framing");

    await submitPatientInput(session.id, { kind: "text", value: "목표1" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" }); // ends collection at goal-life-change
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goalDistantDreamIdentified).not.toBe(true);
    // Skips straight past goal-dream-small-step to the goal rating card check.
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n08-p01-goal-rating-card-check");
  }, 15_000);

  it("Test 7b (P0-4): goal-dream-small-step fires when a real distant dream is named", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "네" });
    await submitPatientInput(session.id, { kind: "text", value: "2" });
    let view = await current(session.id);
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress" || view.currentPromptItem?.id === "tbct-s02-n05-p03-acknowledge-manageable") {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    for (let i = 0; i < 5 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(session.id, { kind: "text", value: "네" });
      view = await current(session.id);
    }
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n07-p01-goal-framing");

    await submitPatientInput(session.id, { kind: "text", value: "목표1" }); // goal-framing
    await submitPatientInput(session.id, { kind: "text", value: "목표2" }); // goal-life-change
    await submitPatientInput(session.id, { kind: "text", value: "목표3" }); // goal-difficult-action
    await submitPatientInput(session.id, { kind: "text", value: "목표4" }); // goal-freedom
    const dreamResult = await submitPatientInput(session.id, { kind: "text", value: "세계여행을 하고 싶어요" }); // goal-dream
    expect(dreamResult.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goalDistantDreamIdentified).toBe(true);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n07-p08-goal-dream-small-step");

    const smallStepResult = await submitPatientInput(session.id, { kind: "text", value: "여행 정보를 하나씩 찾아볼게요" });
    expect(smallStepResult.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n08-p01-goal-rating-card-check");
  }, 15_000);

  // Test 8 (P1): "잘 모르겠는데 설명해주세요" at rating-card-check must explain
  // what the rating card/scale actually is, never the generic
  // "질문에 맞는 짧고 구체적인 예를 하나 들어 주시겠어요?" fallback.
  it("Test 8 (P1): rating-card-check clarification explains the card and 0-5 scale, not the generic example fallback", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" }); // decline placeholder
    const view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n04-p01-rating-card-check");

    const result = await submitPatientInput(session.id, { kind: "text", value: "잘 모르겠는데 설명해주세요" });
    expect(result.turnOutcome).toBe("clarification");
    expect(result.generatedMessage?.content).toMatch(/평가 척도 카드|0점.*5점|0부터 5/);
    expect(result.generatedMessage?.content).not.toContain("질문에 맞는 짧고 구체적인 예를 하나 들어 주시겠어요?");
  }, 15_000);

  // Test 9 (regression): ordinary numeric 0-5 ratings still work unaffected
  // by the P0-3 correction detector.
  it("Test 9 (regression): a plain numeric rating is still recorded normally", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "문제1" });
    await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "아니요" });
    await submitPatientInput(session.id, { kind: "text", value: "네" });
    const result = await submitPatientInput(session.id, { kind: "text", value: "3" });
    expect(result.turnOutcome).toBe("normal");
    const view = await current(session.id);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([3]);
  }, 15_000);
});

// TBCT Runtime Orchestration Simplification -- Phase 1 (closed-form
// deterministic parsing priority). Root cause: "x" as a private-placeholder
// answer was rejected by isMeaningfulTextResponse's generic compact.length>=2
// gate before ever reaching the private_placeholder_labels-specific parser,
// and any text with no A-Z letter (not just an explicit decline) was
// silently treated as "participant declined". Fixed by giving
// private_placeholder_labels the same closed-form priority boolean/enum/
// rating already have, and by separating "explicit decline" from "couldn't
// parse" in parsePrivatePlaceholderLabelsInput (runtime-deterministic-input.ts).
describe("S02 -- Phase 1: private_placeholder_labels closed-form parsing", () => {
  describe("parsePrivatePlaceholderLabelsInput (unit)", () => {
    it("'x' canonicalizes to ['X']", () => {
      expect(parsePrivatePlaceholderLabelsInput({ kind: "text", value: "x" })).toEqual({ decline: false, labels: ["X"] });
    });
    it("'X' canonicalizes to ['X']", () => {
      expect(parsePrivatePlaceholderLabelsInput({ kind: "text", value: "X" })).toEqual({ decline: false, labels: ["X"] });
    });
    it("'y' canonicalizes to ['Y']", () => {
      expect(parsePrivatePlaceholderLabelsInput({ kind: "text", value: "y" })).toEqual({ decline: false, labels: ["Y"] });
    });
    it("'X, Z' canonicalizes to both allowed labels", () => {
      expect(parsePrivatePlaceholderLabelsInput({ kind: "text", value: "X, Z" })).toEqual({ decline: false, labels: ["X", "Z"] });
    });
    it("a label outside the allowed set is a parse failure, not a decline", () => {
      expect(parsePrivatePlaceholderLabelsInput({ kind: "text", value: "Q" }, ["X", "Y", "Z"])).toBeNull();
    });
    it("an explicit decline ('아니요') returns decline:true with no labels", () => {
      expect(parsePrivatePlaceholderLabelsInput({ kind: "text", value: "아니요" })).toEqual({ decline: true, labels: [] });
    });
    it("off-topic text with no letter and no decline word is a parse failure, never silently a decline", () => {
      expect(parsePrivatePlaceholderLabelsInput({ kind: "text", value: "잘 모르겠는데 그냥 넘어갈게요" })).toBeNull();
    });
  });

  describe("end-to-end via submitPatientInput", () => {
    beforeEach(async () => {
      const db = getLocalDb();
      await db.transaction("rw", db.tables, async () => {
        await Promise.all(db.tables.map((table) => table.clear()));
      });
    });

    async function reachOfferPlaceholders(sessionId: string) {
      await submitPatientInput(sessionId, { kind: "text", value: "머리카락 뜯는 습관이 있어요" });
      await submitPatientInput(sessionId, { kind: "text", value: "더 생각나는 건 없어요" });
    }

    it("lone 'x' is accepted immediately: privateProblemPlaceholders/problems include X, privateProblemAdded is true", async () => {
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
      await startRuntimeSession(session.id);
      await reachOfferPlaceholders(session.id);
      const before = await current(session.id);
      expect(before.currentPromptItem?.id).toBe("tbct-s02-n03-p01-offer-private-placeholders");

      const result = await submitPatientInput(session.id, { kind: "text", value: "x" });
      expect(result.turnOutcome).toBe("normal");
      const after = await current(session.id);
      expect(after.session.runtimeContext.fields.privateProblemPlaceholders).toEqual(["X"]);
      expect(after.session.runtimeContext.fields.privateProblemAdded).toBe(true);
      expect(after.session.runtimeContext.fields.problems).toContain("X");
    }, 15_000);

    it("an explicit decline still produces privateProblemPlaceholders=[] and privateProblemAdded=false", async () => {
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
      await startRuntimeSession(session.id);
      await reachOfferPlaceholders(session.id);
      const result = await submitPatientInput(session.id, { kind: "text", value: "아니요" });
      expect(result.turnOutcome).toBe("normal");
      const after = await current(session.id);
      expect(after.session.runtimeContext.fields.privateProblemPlaceholders).toEqual([]);
      expect(after.session.runtimeContext.fields.privateProblemAdded).toBe(false);
    }, 15_000);

    it("unparseable text (no letter, no decline) asks for clarification instead of silently becoming a decline", async () => {
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
      await startRuntimeSession(session.id);
      await reachOfferPlaceholders(session.id);
      const result = await submitPatientInput(session.id, { kind: "text", value: "잘 모르겠는데 그냥 넘어갈게요" });
      expect(result.turnOutcome).toBe("clarification");
      const after = await current(session.id);
      // Still on the same prompt, not silently advanced as a decline.
      expect(after.currentPromptItem?.id).toBe("tbct-s02-n03-p01-offer-private-placeholders");
      expect(after.session.runtimeContext.fields.privateProblemAdded).toBeUndefined();
    }, 15_000);
  });
});

// TBCT Runtime Simplification -- Phase 2 (Single Turn Interpretation Owner /
// S02 Collection Semantic Gate). Root cause: requiresSemanticInputAssessment
// never called assessRuntimePatientInput for problems/goals (ordinary
// single-output-field "array" kind, not in INSIGHT_VALIDATION_KINDS), so
// "강박증을 치료받을 수 있나요?" and similar clarification-shaped text fell
// straight through to the generic "non-empty text -> append" list-building
// logic. Fixed by making problems/goals a semantic-assessment-required field
// (isS02CollectionField) and giving the assessment result's turnAction
// disposition sole authority over append/NoMore/clarification for these two
// fields. These are real end-to-end runs through submitPatientInput using
// whatever assessment provider is actually configured in this environment
// (the deterministic fallback, DeterministicAssessmentModel in
// assessment-providers.ts, since no cloud provider is configured here) --
// see s02-collection-semantic-gate.test.ts for contract-level tests that
// exercise all four turnAction values explicitly via a mocked provider, and
// for the assessment-failure fail-closed test.
describe("S02 -- Phase 2: collection semantic gate (problems/goals)", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  async function reachGoalFraming(sessionId: string) {
    await submitPatientInput(sessionId, { kind: "text", value: "머리카락 만지는 습관이 있는데 그만하고싶어요" });
    await submitPatientInput(sessionId, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
    await submitPatientInput(sessionId, { kind: "text", value: "네" });
    await submitPatientInput(sessionId, { kind: "text", value: "2" });
    let view = await current(sessionId);
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress" || view.currentPromptItem?.id === "tbct-s02-n05-p03-acknowledge-manageable") {
      await submitPatientInput(sessionId, { kind: "text", value: "네" });
      view = await current(sessionId);
    }
    for (let i = 0; i < 5 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(sessionId, { kind: "text", value: "네" });
      view = await current(sessionId);
    }
  }

  it("Test 1: '강박증을 치료받을 수 있나요?' during problem collection is not stored, active prompt held", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const before = await current(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "강박증을 치료받을 수 있나요?" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).not.toContain("강박증을 치료받을 수 있나요?");
    expect(after.currentPromptItem?.id).toBe(before.currentPromptItem?.id);
  }, 15_000);

  it("Test 2: a novel paraphrase of the same clarification ('그런 건 치료하면 없어질 수 있는 건가요?') is not stored", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "그런 건 치료하면 없어질 수 있는 건가요?" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).toHaveLength(0);
  }, 15_000);

  it("Test 3: goal clarification ('무엇을 위해서요? ...') is not stored in goals", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachGoalFraming(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "무엇을 위해서요? 갑자기 질문 나와서 어떤 의미인지 모르겠어요" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals ?? []).toHaveLength(0);
  }, 15_000);

  it("Test 4: a novel paraphrase goal clarification ('제가 여기서 어떤 걸 목표라고 말해야 하는 거예요?') is not stored", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachGoalFraming(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "제가 여기서 어떤 걸 목표라고 말해야 하는 거예요?" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals ?? []).toHaveLength(0);
  }, 15_000);

  it("Test 5: a valid problem ('공부가 너무 힘들어요') is stored verbatim", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "공부가 너무 힘들어요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems).toEqual(["공부가 너무 힘들어요"]);
  }, 15_000);

  it("Test 6: a valid problem containing '없어요' ('돈이 없어서 너무 스트레스 받아요') is stored, problemsNoMore stays false", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "돈이 없어서 너무 스트레스 받아요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems).toEqual(["돈이 없어서 너무 스트레스 받아요"]);
    expect(after.session.runtimeContext.fields.problemsNoMore).not.toBe(true);
  }, 15_000);

  it("Test 7: '자신감이 없어요' is stored as a real problem, not treated as collection_stop", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "자신감이 없어요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems).toEqual(["자신감이 없어요"]);
  }, 15_000);

  it("Test 8: a valid goal ('경제적으로 여유로워지고 싶어요') is stored verbatim", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachGoalFraming(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "경제적으로 여유로워지고 싶어요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["경제적으로 여유로워지고 싶어요"]);
  }, 15_000);

  it("Test 9: a hedged goal ('아마 좀 더 건강하게 살고 싶은 것 같아요') is stored -- '것 같아요' is not grounds for rejection", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachGoalFraming(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "아마 좀 더 건강하게 살고 싶은 것 같아요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["아마 좀 더 건강하게 살고 싶은 것 같아요"]);
  }, 15_000);

  it("Test 10: collection stop ('더 생각나는 건 없어요') is not stored, problemsNoMore becomes true", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "공부가 너무 힘들어요" });
    const result = await submitPatientInput(session.id, { kind: "text", value: "더 생각나는 건 없어요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems).toEqual(["공부가 너무 힘들어요"]);
    expect(after.session.runtimeContext.fields.problems).not.toContain("더 생각나는 건 없어요");
    expect(after.session.runtimeContext.fields.problemsNoMore).toBe(true);
  }, 15_000);

  it("Test 11: a paraphrased collection stop ('그게 전부인 것 같아요') not in the legacy regex is recognized", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "공부가 너무 힘들어요" });
    const result = await submitPatientInput(session.id, { kind: "text", value: "그게 전부인 것 같아요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems).toEqual(["공부가 너무 힘들어요"]);
    expect(after.session.runtimeContext.fields.problemsNoMore).toBe(true);
  }, 15_000);

  it("Test 12: unrelated text ('다람쥐 보고 싶어요') is not stored to the clinical list", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const before = await current(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "다람쥐 보고 싶어요" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).toHaveLength(0);
    expect(after.currentPromptItem?.id).toBe(before.currentPromptItem?.id);
  }, 15_000);

  it("Test 13: safety takes priority -- a risk disclosure never reaches problems/goals append", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "요즘 너무 힘들어서 죽고 싶어요" });
    expect(result.turnOutcome).not.toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).not.toContain("요즘 너무 힘들어서 죽고 싶어요");
  }, 15_000);
});

// TBCT Runtime Simplification -- Phase 3 (Rating Item Correction Lifecycle /
// State Mutation vs Protocol Progression). Root cause (confirmed via a real
// before-snapshot reproduction, not speculation): a correction turn returned
// missingFields:[] exactly like a genuine accepted rating, so
// runtime-execution-api.ts always reduced it as "patient_input_accepted" --
// which unconditionally increments a repeat_until prompt's
// promptIterationCounts, consuming one of the 5 rating attempts even though
// no rating was recorded. Fixed by adding StateExtractionResult.inputDisposition
// ("state_corrected" for a correction) and a new reducer event,
// "patient_state_corrected", that persists state and evaluates completion
// exactly like an accepted answer but never increments the iteration budget.
// classifyS02RatingCorrection's session-scoped regex is replaced by
// assessRuntimePatientInput's turnAction==="current_item_correction",
// reusing the same assessment layer Phase 2 gave problems/goals collection.
describe("S02 -- Phase 3: rating item correction lifecycle", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  /** Drives one problem (rated 2) through to goal-framing, then answers
   * `goalTexts` (max 5) across goal-framing's serial follow-ups, then lands
   * on reflect-goal-score with exactly those goals unrated. */
  async function reachGoalRatingWithGoals(sessionId: string, goalTexts: string[]) {
    await submitPatientInput(sessionId, { kind: "text", value: "공부가 너무 힘들어요" });
    await submitPatientInput(sessionId, { kind: "text", value: "더 생각나는 건 없어요" });
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
    await submitPatientInput(sessionId, { kind: "text", value: "네" });
    await submitPatientInput(sessionId, { kind: "text", value: "2" });
    let view = await current(sessionId);
    if (view.currentPromptItem?.id === "tbct-s02-n05-p02-acknowledge-distress" || view.currentPromptItem?.id === "tbct-s02-n05-p03-acknowledge-manageable") {
      await submitPatientInput(sessionId, { kind: "text", value: "네" });
      view = await current(sessionId);
    }
    for (let i = 0; i < 6 && view.currentPromptItem && !view.currentPromptItem.id.includes("goal-framing"); i += 1) {
      await submitPatientInput(sessionId, { kind: "text", value: "네" });
      view = await current(sessionId);
    }
    for (const text of goalTexts) {
      await submitPatientInput(sessionId, { kind: "text", value: text });
    }
    if (goalTexts.length < 5) {
      await submitPatientInput(sessionId, { kind: "text", value: "더 생각나는 건 없어요" });
    }
    view = await current(sessionId);
    if (view.currentPromptItem?.id === "tbct-s02-n07-p08-goal-dream-small-step") {
      await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
      view = await current(sessionId);
    }
    if (view.currentPromptItem?.id === "tbct-s02-n08-p01-goal-rating-card-check") {
      await submitPatientInput(sessionId, { kind: "text", value: "네" });
      view = await current(sessionId);
    }
    return view;
  }

  /** Same shape for problems: 2 named problems, no more, lands on
   * reflect-problem-score with neither rated. */
  async function reachProblemRatingWithProblems(sessionId: string, problemTexts: string[]) {
    for (const text of problemTexts) {
      await submitPatientInput(sessionId, { kind: "text", value: text });
    }
    if (problemTexts.length < 5) {
      await submitPatientInput(sessionId, { kind: "text", value: "더 생각나는 건 없어요" });
    }
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" }); // decline placeholder
    await submitPatientInput(sessionId, { kind: "text", value: "아니요" }); // decline card
    const result = await submitPatientInput(sessionId, { kind: "text", value: "네" }); // comprehension check
    return result;
  }

  it("Test 1: canonical goal rejection ('이건 목표가 아닌데요') removes the current goal, no rating recorded, no iteration consumed", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    let view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const before = view.session.runtimeState?.promptIterationCounts?.["tbct-s02-n09-p01-reflect-goal-score"] ?? 0;

    const result = await submitPatientInput(session.id, { kind: "text", value: "이건 목표가 아닌데요" });
    expect(result.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goals).toEqual(["목표B"]);
    expect(view.session.runtimeContext.fields.goalRatings ?? []).toHaveLength(0);
    expect(view.session.runtimeState?.promptIterationCounts?.["tbct-s02-n09-p01-reflect-goal-score"] ?? 0).toBe(before);
  }, 15_000);

  it("Test 2: a natural variant ('이건 제가 목표라고 말한 건 아니에요') not in the legacy regex is recognized", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "이건 제가 목표라고 말한 건 아니에요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표B"]);
    expect(after.session.runtimeContext.fields.goalRatings ?? []).toHaveLength(0);
  }, 15_000);

  it("Test 3: question contamination ('이것도 질문인데요') removes the item instead of demanding a numeric rating", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "이것도 질문인데요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표B"]);
    expect(after.session.runtimeContext.fields.goalRatings ?? []).toHaveLength(0);
    expect(after.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
  }, 15_000);

  it("Test 4: problem-side rejection ('이건 문제로 넣으려고 한 말이 아니었어요') removes the current problem", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachProblemRatingWithProblems(session.id, ["문제A", "문제B"]);
    const view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n05-p01-reflect-problem-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "이건 문제로 넣으려고 한 말이 아니었어요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems).toEqual(["문제B"]);
    expect(after.session.runtimeContext.fields.problemRatings ?? []).toHaveLength(0);
  }, 15_000);

  it("Test 5: duplicate correction ('이거 앞에서 말한 거랑 같은 내용인데 왜 또 평가하나요?') removes the item", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "이거 앞에서 말한 거랑 같은 내용인데 왜 또 평가하나요?" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표B"]);
    expect(after.session.runtimeContext.fields.goalRatings ?? []).toHaveLength(0);
  }, 15_000);

  it("Test 6: a leading digit attached to a correction ('5. 근데 이건 앞에 있던 거랑 같은 항목이에요') never records 5 as a rating", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "5. 근데 이건 앞에 있던 거랑 같은 항목이에요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표B"]);
    expect(after.session.runtimeContext.fields.goalRatings ?? []).toHaveLength(0);
    expect(after.session.runtimeContext.fields.goalRatings ?? []).not.toContain(5);
  }, 15_000);

  it("Test 7: a pure rating ('5') is recorded normally", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "5" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goalRatings).toEqual([5]);
  }, 15_000);

  it("Test 8: a color rating ('노란색') is recorded as 4 -- Phase 1/existing color behavior unaffected", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "노란색" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goalRatings).toEqual([4]);
  }, 15_000);

  it("Test 9: a hedged rating ('4점 정도인 것 같아요') is still recorded as 4, preserving existing tolerant rating extraction", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "4점 정도인 것 같아요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goalRatings).toEqual([4]);
  }, 15_000);

  it("Test 10: correcting the LAST unrated goal makes allGoalsRated true and completes the rating phase", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    let view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    await submitPatientInput(session.id, { kind: "text", value: "5" }); // rate A
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.currentGoalText).toBe("목표B");

    const result = await submitPatientInput(session.id, { kind: "text", value: "목표B는 목표가 아니에요" });
    expect(result.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goals).toEqual(["목표A"]);
    expect(view.session.runtimeContext.fields.goalRatings).toEqual([5]);
    expect(view.session.runtimeContext.fields.allGoalsRated).toBe(true);
    // The rating phase actually advanced past reflect-goal-score.
    expect(view.currentPromptItem?.id).not.toBe("tbct-s02-n09-p01-reflect-goal-score");
  }, 15_000);

  it("Test 11: correcting a MIDDLE goal keeps the same rating prompt, next target is the survivor after it", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    let view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B", "목표C"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    await submitPatientInput(session.id, { kind: "text", value: "5" }); // rate A
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.currentGoalText).toBe("목표B");

    const result = await submitPatientInput(session.id, { kind: "text", value: "목표B는 목표가 아니에요" });
    expect(result.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goals).toEqual(["목표A", "목표C"]);
    expect(view.session.runtimeContext.fields.goalRatings).toEqual([5]);
    expect(view.session.runtimeContext.fields.currentGoalText).toBe("목표C");
    expect(view.session.runtimeContext.fields.allGoalsRated).not.toBe(true);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const latestAssistantMessage = [...view.messages].reverse().find((message) => message.role === "assistant");
    expect(latestAssistantMessage?.content).toContain("제외");
    expect(latestAssistantMessage?.content).toContain("목표C");
    expect(latestAssistantMessage?.content).not.toContain("5점");
  }, 15_000);

  it("Test 12: iteration budget -- a correction among 5 goals never consumes an iteration slot", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    let view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B", "목표C", "목표D", "목표E"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    await submitPatientInput(session.id, { kind: "text", value: "5" }); // A
    await submitPatientInput(session.id, { kind: "text", value: "목표B는 목표가 아니에요" }); // correction, no iteration
    await submitPatientInput(session.id, { kind: "text", value: "3" }); // C
    await submitPatientInput(session.id, { kind: "text", value: "4" }); // D
    const last = await submitPatientInput(session.id, { kind: "text", value: "2" }); // E
    expect(last.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.goalRatings).toEqual([5, 3, 4, 2]);
    expect(view.session.runtimeContext.fields.allGoalsRated).toBe(true);
    expect(view.session.runtimeState?.promptIterationCounts?.["tbct-s02-n09-p01-reflect-goal-score"]).toBe(4);
  }, 15_000);

  it("Test 13: problem side goes through the exact same lifecycle (no S02-Goal-only special-casing)", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await reachProblemRatingWithProblems(session.id, ["문제A", "문제B", "문제C"]);
    let view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n05-p01-reflect-problem-score");
    await submitPatientInput(session.id, { kind: "text", value: "5" }); // A
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.currentProblemText).toBe("문제B");
    const before = view.session.runtimeState?.promptIterationCounts?.["tbct-s02-n05-p01-reflect-problem-score"] ?? 0;

    const result = await submitPatientInput(session.id, { kind: "text", value: "이건 문제가 아닌데요" });
    expect(result.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.problems).toEqual(["문제A", "문제C"]);
    expect(view.session.runtimeContext.fields.problemRatings).toEqual([5]);
    expect(view.session.runtimeContext.fields.currentProblemText).toBe("문제C");
    expect(view.session.runtimeState?.promptIterationCounts?.["tbct-s02-n05-p01-reflect-problem-score"] ?? 0).toBe(before);
    const latestAssistantMessage = [...view.messages].reverse().find((message) => message.role === "assistant");
    expect(latestAssistantMessage?.content).toContain("제외");
    expect(latestAssistantMessage?.content).toContain("문제C");
    expect(latestAssistantMessage?.content).not.toContain("5점");
  }, 15_000);

  it("Test 14: a genuine clarification request ('이 목표가 무슨 뜻이에요?') does not delete the current item", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "이 목표가 무슨 뜻이에요?" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표A", "목표B"]);
    expect(after.session.runtimeContext.fields.goalRatings ?? []).toHaveLength(0);
    expect(after.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
  }, 15_000);

  it("Test 15: rating revision ('아까 5점이라고 했는데 4점으로 바꿀게요') is neither a correction nor silently accepted", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "아까 5점이라고 했는데 4점으로 바꿀게요" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    // Not treated as a correction: both goals are still present.
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표A", "목표B"]);
    // Not silently accepted as a rating of 4 or 5 either.
    expect(after.session.runtimeContext.fields.goalRatings ?? []).toHaveLength(0);
  }, 15_000);

  it("Test 16: safety takes priority over item correction", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithGoals(session.id, ["목표A", "목표B"]);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
    const result = await submitPatientInput(session.id, { kind: "text", value: "이건 목표가 아닌데 요즘 죽고 싶기도 해요" });
    expect(result.turnOutcome).not.toBe("normal");
    const after = await current(session.id);
    // Item mutation must not have been committed ahead of the safety route.
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표A", "목표B"]);
  }, 15_000);
});
