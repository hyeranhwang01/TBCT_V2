import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, createRuntimeSession, getPatientRuntimeSession, getRuntimeSession, listCanonicalTestSessions, listPatientAvailableRuntimeReleases } from "@/shared/api/runtime-session-api";
import { resumeRuntimeSession, retryStalledRuntimeNode, startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { publishProtocolRelease, runProtocolValidation } from "@/clinician/lib/api/protocol-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { listRuntimeExecutionTraces, saveRuntimeMessage, updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { promptRequiresPatientInput } from "@/shared/runtime/source-fidelity-prompt-progression";
import { getWorksheetView } from "@/shared/worksheet/worksheet-projection";

describe("canonical source-fidelity runtime", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("starts an explicit canonical test session without a published release", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);
      const active = await getRuntimeSession(session.id);

      expect(session.releaseId).toBe("demo-release");
      expect(active?.session.status).toBe("waiting_for_input");
      expect(active?.session.runtimeState?.releaseId).toBe("demo-release");
      expect(active?.currentPromptItem).toBeDefined();
      expect(active?.messages.find((message) => message.role === "assistant")?.content).toMatch(/[\uAC00-\uD7A3]/);
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  // Reproduces a live-reported bug ("the counselor's first message repeats
  // twice"): patient-session-page.tsx's auto-start effect and a still-
  // visible, not-yet-disabled manual "Start" button (or a stray auto-retry)
  // could both call startRuntimeSession for the same freshly-created
  // session. startRuntimeSession previously had no precondition check at
  // all, so both concurrent calls would independently run the full
  // entry-node execution chain and each generate their own assistant
  // message for the session's first turn. claimRuntimeSessionStart
  // (runtime-execution-api.ts / runtime-session-store.ts) now makes this an
  // atomic claim -- only one caller's chain actually runs.
  it("never delivers a duplicate first message when startRuntimeSession is called concurrently", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
      const [first, second] = await Promise.all([startRuntimeSession(session.id), startRuntimeSession(session.id)]);
      // Exactly one of the two racing calls should have won the claim and
      // actually run the chain; the other is a no-op (null).
      expect([first, second].filter((result) => result !== null)).toHaveLength(1);

      const view = await getRuntimeSession(session.id);
      const assistantMessages = view?.messages.filter((message) => message.role === "assistant") ?? [];
      // S01's opening node legitimately delivers two DIFFERENT prompts in
      // one healthy chain (warm-acknowledgement, then telegraphic-situation)
      // -- the bug was the SAME prompt being delivered twice, so assert on
      // distinct (nodeId, promptItemId) pairs rather than a raw count.
      expect(assistantMessages.length).toBeGreaterThan(0);
      const promptKeys = assistantMessages.map((message) => `${message.nodeId}:${message.promptItemId}`);
      expect(new Set(promptKeys).size).toBe(promptKeys.length);
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("makes every canonical session available to the publish-free test flow", async () => {
    const sessions = await listCanonicalTestSessions();
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s08" });

    expect(sessions.map((item) => item.id)).toEqual(["tbct-s01", "tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"]);
    expect(session.releaseId).toBe("demo-release");
    expect(session.sessionDefinitionId).toBe("tbct-s08");
  });

  it("does not mistake Korean readiness for a problem and accepts the patient's actual problem without repetition", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      // P0-3 (S02 redesign): first-session-opening is a one-way welcome with
      // no patient input required (completionEffect sets openingMode
      // deterministically), so the session auto-advances straight to
      // elicit-problems/problem-framing -- that is the very first prompt
      // that actually waits on the participant, not a separate check-in.
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
      await startRuntimeSession(session.id);
      const before = await getRuntimeSession(session.id);
      const problemPromptId = before?.session.currentPromptItemId;

      await submitPatientInput(session.id, { kind: "text", value: "네 알겠습니다." });
      const afterReadiness = await getRuntimeSession(session.id);
      expect(afterReadiness?.session.runtimeContext.fields.problems).toBeUndefined();
      expect(afterReadiness?.session.currentPromptItemId).toBe(problemPromptId);

      const actualProblem = "제 생각에는 저는 포기하는 용기가 없는 것 같아요";
      await submitPatientInput(session.id, { kind: "text", value: actualProblem });
      const afterProblem = await getRuntimeSession(session.id);
      expect(afterProblem?.session.runtimeContext.fields.problems).toEqual([actualProblem]);
      expect(afterProblem?.session.currentPromptItemId).not.toBe(problemPromptId);
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("keeps the active PromptItem and sends a clarification when a patient sends a greeting or gibberish", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);
      const before = await getRuntimeSession(session.id);
      const activePromptItemId = before?.session.currentPromptItemId;

      await submitPatientInput(session.id, { kind: "text", value: "hi" });
      await submitPatientInput(session.id, { kind: "text", value: "fuiissiidojfosid" });
      const after = await getRuntimeSession(session.id);

      expect(activePromptItemId).toBeDefined();
      expect(after?.session.status).toBe("waiting_for_input");
      expect(after?.session.currentPromptItemId).toBe(activePromptItemId);
      expect(after?.session.completedPromptItemIds).not.toContain(activePromptItemId);
      const clarificationMessages = after?.messages.filter((message) => message.role === "assistant" && message.metadata?.turnOutcome === "clarification") ?? [];
      expect(clarificationMessages).toHaveLength(2);
      expect(clarificationMessages.at(-1)?.promptItemId).toBe(activePromptItemId);
      expect(clarificationMessages.at(-1)?.content).toBeTruthy();
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("preempts Session 03 progression for a direct Korean suicide disclosure", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
      await startRuntimeSession(session.id);
      const before = await getRuntimeSession(session.id);
      const suspendedPromptItemId = before?.session.currentPromptItemId;

      const result = await submitPatientInput(session.id, { kind: "text", value: "죽고싶다" });
      const after = await getRuntimeSession(session.id);
      const safetyMessages = after?.messages.filter((message) => message.role === "assistant" && message.metadata?.turnOutcome === "safety_override") ?? [];
      const safetyTrace = (await listRuntimeExecutionTraces(session.id))
        .find((trace) => trace.transitionDecision === "safety_override");

      expect(result.turnOutcome).toBe("safety_override");
      expect(after?.session.status).toBe("escalated");
      expect(after?.session.currentPromptItemId).toBe(suspendedPromptItemId);
      expect(after?.session.completedPromptItemIds).not.toContain(suspendedPromptItemId);
      expect(safetyMessages).toHaveLength(1);
      expect(safetyMessages[0]?.content).toBe("Your immediate safety is the highest priority. We will switch to clinician escalation now.");
      expect(after?.messages.some((message) => message.role === "assistant" && /Intrapersonal Thought Record/i.test(message.content))).toBe(false);
      expect(safetyTrace?.fidelity.safetyFidelity).toBe("pass");
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("rejects a rapid duplicate submission for the same session version", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);
      const before = await getRuntimeSession(session.id);
      const expectedSessionVersion = before?.session.version ?? 0;

      const outcomes = await Promise.all([
        submitPatientInput(session.id, { kind: "text", value: "hi" }, { clientTurnId: "duplicate-turn", expectedSessionVersion }),
        submitPatientInput(session.id, { kind: "text", value: "hi" }, { clientTurnId: "duplicate-turn", expectedSessionVersion }),
      ]);
      const after = await getRuntimeSession(session.id);

      expect(outcomes.map((outcome) => outcome.turnOutcome).sort()).toEqual(["clarification", "rejected_duplicate"]);
      expect(after?.messages.filter((message) => message.role === "patient" && message.content === "hi")).toHaveLength(1);
      expect(after?.messages.filter((message) => message.role === "assistant" && message.metadata?.turnOutcome === "clarification")).toHaveLength(1);
      expect(after?.session.version).toBe(expectedSessionVersion + 1);
      expect(after?.session.pendingTurnId).toBeUndefined();
      expect(after?.session.lastCompletedTurnId).toBe("duplicate-turn");
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("pauses an unchanged PromptItem after the maximum clarification attempts", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);
      const before = await getRuntimeSession(session.id);
      const activePromptItemId = before?.session.currentPromptItemId;

      await submitPatientInput(session.id, { kind: "text", value: "hi" });
      await submitPatientInput(session.id, { kind: "text", value: "hi" });
      const finalResult = await submitPatientInput(session.id, { kind: "text", value: "hi" });
      const after = await getRuntimeSession(session.id);

      expect(finalResult.turnOutcome).toBe("clarification");
      expect(finalResult.fallbackUsed).toBe(false);
      expect(after?.session.status).toBe("paused");
      expect(after?.session.currentPromptItemId).toBe(activePromptItemId);
      expect(after?.session.runtimeContext.clarificationAttemptCount).toBe(3);
      expect(after?.session.runtimeContext.lastClarificationReason).toBe("maximum_clarification_attempts");
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("switches session.locale on a mid-session language-switch request instead of treating it as a wrong answer", async () => {
    // Regression test: a request like "한국어로 해주세요" used to be graded like
    // any other patient message -- an attempted answer to whatever the
    // active prompt was asking -- which has no plausible connection to a
    // clinical question, so it burned a clarification attempt and never
    // actually changed session.locale (the reply language). This confirms
    // it's now detected before that pipeline, updates the locale, and does
    // NOT spend a clarification attempt.
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession({ locale: "en-US" });
      await startRuntimeSession(session.id);
      const before = await getRuntimeSession(session.id);
      const activePromptItemId = before?.session.currentPromptItemId;

      const result = await submitPatientInput(session.id, { kind: "text", value: "한국어로 해주세요" });
      const after = await getRuntimeSession(session.id);

      expect(result.turnOutcome).toBe("clarification");
      expect(after?.session.locale).toBe("ko-KR");
      expect(after?.session.status).toBe("waiting_for_input");
      expect(after?.session.currentPromptItemId).toBe(activePromptItemId);
      expect(after?.session.runtimeContext.clarificationAttemptCount ?? 0).toBe(0);
      const languageSwitchMessage = after?.messages.find((message) => message.role === "assistant" && message.metadata?.clarificationReason === "language_switch");
      expect(languageSwitchMessage?.content).toBeTruthy();
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("resume grants a genuinely fresh clarification budget, not just one more attempt", async () => {
    // Regression test: resumeRuntimeSession used to only flip status back
    // to "active" without resetting clarificationAttemptCount, which stays
    // at 3 (or more) from the pause. The very next insufficient answer
    // after resuming would then compute 3+1=4 >= MAX_CLARIFICATION_ATTEMPTS
    // and immediately pause again -- so a resumed session only ever got
    // ONE more try, no matter how good the participant's next answer was,
    // instead of a real fresh 3-attempt budget like any other prompt gets.
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);

      await submitPatientInput(session.id, { kind: "text", value: "hi" });
      await submitPatientInput(session.id, { kind: "text", value: "hi" });
      await submitPatientInput(session.id, { kind: "text", value: "hi" });
      const paused = await getRuntimeSession(session.id);
      expect(paused?.session.status).toBe("paused");
      expect(paused?.session.runtimeContext.clarificationAttemptCount).toBe(3);

      await resumeRuntimeSession(session.id);
      const resumed = await getRuntimeSession(session.id);
      // executeCurrentNode (called at the end of resume) re-delivers the
      // same prompt fresh, landing on "waiting_for_input" like any normal
      // delivered turn -- the important assertion here is the counter.
      expect(resumed?.session.status).not.toBe("paused");
      expect(resumed?.session.runtimeContext.clarificationAttemptCount).toBe(0);

      // Two more insufficient answers should NOT re-pause -- a fresh
      // budget of 3 was granted, this is only attempt 1 and 2 of it.
      await submitPatientInput(session.id, { kind: "text", value: "hi" });
      const afterOne = await getRuntimeSession(session.id);
      expect(afterOne?.session.status).not.toBe("paused");

      const afterTwo = await submitPatientInput(session.id, { kind: "text", value: "hi" });
      expect(afterTwo.sessionStatus).not.toBe("paused");
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("retries a session stuck at status active with an already-delivered prompt back to waiting_for_input", async () => {
    // Regression test: executeCurrentNode recurses through passive nodes,
    // persisting status:"active" after each one -- if a later step in that
    // same chain throws, the record is left holding "active" forever with a
    // message already delivered for the current PromptItem, and nothing in
    // the app ever revisits it (no polling, no case for "active" beyond an
    // inert message). Confirmed live: a real production session sat at
    // status "active" for 10+ minutes with zero recovery. Simulate that
    // exact state directly (delivered message + status forced to "active")
    // and confirm retryStalledRuntimeNode self-heals it back to
    // waiting_for_input without re-delivering a duplicate message.
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);
      const delivered = await getRuntimeSession(session.id);
      expect(delivered?.session.status).toBe("waiting_for_input");
      const assistantMessageCountBefore = delivered?.messages.filter((message) => message.role === "assistant").length ?? 0;

      // Force the exact stuck shape: the prompt's message already exists,
      // but the status field never made it to "waiting_for_input".
      await updateRuntimeSessionRecord(session.id, { status: "active" });
      const stalled = await getRuntimeSession(session.id);
      expect(stalled?.session.status).toBe("active");

      await retryStalledRuntimeNode(session.id);
      const recovered = await getRuntimeSession(session.id);
      expect(recovered?.session.status).toBe("waiting_for_input");
      const assistantMessageCountAfter = recovered?.messages.filter((message) => message.role === "assistant").length ?? 0;
      expect(assistantMessageCountAfter).toBe(assistantMessageCountBefore);
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("refuses to retry a session that is not actually stalled", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);
      await expect(retryStalledRuntimeNode(session.id)).rejects.toThrow(/not allowed/);
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("starts from a canonical release and waits on exactly one immutable PromptItem", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "anthropic";
    try {
    await runProtocolValidation("TBCT-BR-001", "tbct-s01");
    const published = await publishProtocolRelease("TBCT-BR-001", {
      version: `runtime-source-fidelity-${Date.now()}`,
      targetEnvironment: "development",
      changeSummary: "Runtime source-fidelity test release",
    });
    const patientReleases = await listPatientAvailableRuntimeReleases("TBCT-BR-001");
    const patientRelease = patientReleases.find((release) => release.id === published.release.id);
    const session = await createRuntimeSession({
      projectId: "TBCT-BR-001",
      protocolId: "TBCT-BR-001",
      releaseId: published.release.id,
      sessionDefinitionId: "tbct-session-01",
      patientAlias: "TBCT-DEMO-001",
      locale: "pt-BR",
    });

    const initial = await getRuntimeSession(session.id);
    expect(initial?.session.protocolId).toBe("tbct-br-001");
    expect(initial?.session.releaseId).toBe(published.release.id);
    expect(initial?.session.runtimeState?.releaseId).toBe(published.release.id);
    expect(initial?.session.sessionDefinitionId).toBe("tbct-s01");
    expect(initial?.session.sourceTextHash).toBe(published.release.immutableSnapshot.sourceFidelity?.sourceTextHash);
    expect(initial?.currentPromptItem?.id).toBe(initial?.session.currentPromptItemId);

    await startRuntimeSession(session.id);
    await saveRuntimeMessage({
      id: "internal-system-message",
      runtimeSessionId: session.id,
      role: "system",
      content: "Internal runtime detail",
      status: "delivered",
      createdAt: new Date().toISOString(),
    });
    await saveRuntimeMessage({
      id: "approved-system-message",
      runtimeSessionId: session.id,
      role: "system",
      content: "A safety review is in progress.",
      status: "delivered",
      createdAt: new Date().toISOString(),
      metadata: { patientVisible: true },
    });
    const active = await getRuntimeSession(session.id);
    const patientView = await getPatientRuntimeSession(session.id);
    const promptItem = active?.currentPromptItem;

    expect(active?.session.status).toBe("waiting_for_input");
    expect(promptItem).toBeDefined();
    expect(promptItem && promptRequiresPatientInput(promptItem)).toBe(true);
    expect(active?.session.runtimeState?.activeNodeId).toBe(active?.session.currentNodeId);
    expect(active?.session.runtimeState?.activePromptItemId).toBe(active?.session.currentPromptItemId);
    expect(active?.messages.filter((message) => message.role === "assistant").every((message) => message.promptItemId !== undefined)).toBe(true);
    expect([...active?.messages ?? []].reverse().find((message) => message.role === "assistant")?.promptItemId).toBe(promptItem?.id);
    expect(active?.promptItems.some((item) => item.id === promptItem?.id)).toBe(true);
    expect(active?.release.immutableSnapshot.nodes.some((node) => node.id.startsWith("RT-NODE-"))).toBe(false);
    // tbct-s01 now routes non-safety-critical turns through the dialogue
    // agent (see dialogue-agent-orchestrator.ts); in this test environment
    // that resolves to the intercepted fake ("mock"), never a real
    // "anthropic" call, even with AI_PROVIDER=anthropic set above.
    expect(active?.providerEvents.every((event) => event.provider === "deterministic" || event.provider === "mock")).toBe(true);
    expect("release" in (patientView ?? {})).toBe(false);
    expect(patientView?.currentPromptInput && "aiInstruction" in patientView.currentPromptInput).toBe(false);
    expect(patientView?.messages.some((message) => message.id === "internal-system-message")).toBe(false);
    expect(patientView?.messages.some((message) => message.id === "approved-system-message")).toBe(true);
    expect("immutableSnapshot" in (patientRelease ?? {})).toBe(false);
    expect(patientRelease?.sessions.length).toBeGreaterThan(0);
    expect(patientRelease?.sessions[0] && "sessionObjective" in patientRelease.sessions[0]).toBe(false);
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("keeps release-pinned runtime state aligned after a validated patient answer", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      await runProtocolValidation("TBCT-BR-001", "tbct-s01");
      const published = await publishProtocolRelease("TBCT-BR-001", {
        version: `runtime-progress-${Date.now()}`,
        targetEnvironment: "development",
        changeSummary: "Runtime progression test release",
      });
      const session = await createRuntimeSession({
        projectId: "TBCT-BR-001",
        protocolId: "TBCT-BR-001",
        releaseId: published.release.id,
        sessionDefinitionId: "tbct-session-01",
        patientAlias: "TBCT-DEMO-002",
        locale: "en-US",
      });

      await startRuntimeSession(session.id);
      const before = await getRuntimeSession(session.id);
      const answeredPromptId = before?.session.currentPromptItemId;
      const assistantMessageCountBefore = before?.messages.filter((message) => message.role === "assistant").length ?? 0;
      expect(answeredPromptId).toBeDefined();

      const result = await submitPatientInput(session.id, { kind: "text", value: "This is a current situation, not only an interpretation." });
      const after = await getRuntimeSession(session.id);
      const traces = await listRuntimeExecutionTraces(session.id);
      const assistantMessages = after?.messages.filter((message) => message.role === "assistant") ?? [];
      const latestAssistantMessage = assistantMessages.at(-1);

      expect(after?.session.releaseId).toBe(published.release.id);
      expect(after?.session.completedPromptItemIds).toContain(answeredPromptId);
      expect(after?.session.runtimeState?.activeNodeId).toBe(after?.session.currentNodeId);
      expect(after?.session.runtimeState?.activePromptItemId).toBe(after?.session.currentPromptItemId);
      expect(result.turnOutcome).toBe("normal");
      expect(assistantMessages).toHaveLength(assistantMessageCountBefore + 1);
      expect(latestAssistantMessage?.nodeId).toBe(after?.session.currentNodeId);
      expect(latestAssistantMessage?.promptItemId).toBe(after?.session.currentPromptItemId);
      expect(traces.length).toBeGreaterThan(0);
      expect(traces.every((trace) => trace.releaseId === published.release.id && Boolean(trace.contractHash))).toBe(true);
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("reflects a filled worksheet field immediately after the turn resolves, not after a later poll", async () => {
    // Regression test for the worksheet-lag bug: projectRuntimeFieldsToWorksheet
    // used to be fire-and-forget inside submitPatientInput (see
    // runtime-execution-api.ts), so a turn's HTTP response could return before
    // its worksheet write had actually landed -- the patient-facing
    // WorksheetPane (which only re-checks on its own poll or on an explicit
    // cache invalidation right after this same call) could visibly lag behind
    // what the patient had just answered. This asserts the field this exact
    // input fills (tbct-s01's situationThoughtDistinction, the first patient
    // turn of the canonical S01 flow -- see "keeps release-pinned runtime
    // state aligned..." above for the same input/field pairing) is already
    // reflected in getWorksheetView the instant submitPatientInput resolves,
    // with no wait/poll of any kind in between.
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);

      await submitPatientInput(session.id, { kind: "text", value: "This is a current situation, not only an interpretation." });
      const view = await getWorksheetView(session.id, "tbct-s01");
      const situationField = view?.fields.find((field) => field.definition.worksheetFieldKey === "situationThoughtDistinction");

      expect(situationField?.value?.value).toBeTruthy();
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("does not let the situation-or-thought clarification overwrite the participant's actual situation answer", async () => {
    // Regression test: tbct-s01's "situation-or-thought" clarification (the
    // very next patient-input turn after the one above) used to declare
    // outputFields: ["situationThoughtDistinction"] with no
    // activationCondition -- it fired for every participant and, whatever
    // they said in reply to "is that a situation or a thought?", overwrote
    // the worksheet's "My situation" box with that reply instead of leaving
    // their actual situation answer in place. See the fix comment on this
    // prompt in source-fidelity-catalog.ts.
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession();
      await startRuntimeSession(session.id);

      await submitPatientInput(session.id, { kind: "text", value: "I am currently speaking with the therapist during my appointment." });
      await submitPatientInput(session.id, { kind: "text", value: "I think that is the situation, not a thought." });

      const view = await getWorksheetView(session.id, "tbct-s01");
      const situationField = view?.fields.find((field) => field.definition.worksheetFieldKey === "situationThoughtDistinction");

      expect(situationField?.value?.value).toContain("speaking with the therapist");
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);

  it("asks specifically for the still-missing automatic thought instead of re-asking about an already-answered situation", async () => {
    // Regression test: S08's opening prompt (tbct-s08-n01-p01-distressing-situation)
    // has TWO outputFields (distressingSituation, automaticThought). The
    // generic adaptiveClarification fallback in deliverClarificationTurn
    // always used to win over this prompt's purpose-built
    // sourceSpecificClarification, and adaptiveClarification only ever
    // reads outputFields[0] -- so once the situation was answered but the
    // thought never was, every subsequent clarification kept asking to
    // re-describe the situation (already recorded) instead of ever asking
    // for the thought (the one field still genuinely missing). A patient
    // who never happened to also state a "thought" in the same breath as
    // their situation could not escape this loop. See the fix comment on
    // deliverClarificationTurn's `content` assignment.
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s08", locale: "en-US" });
      await startRuntimeSession(session.id);
      // S08 now opens with the participant guide's "quick word first": the
      // materials check and the belief-as-charge orientation, whose reaction
      // is invited before the investigation begins. Clear those first so this
      // test still lands on the combined situation+thought prompt.
      await submitPatientInput(session.id, { kind: "boolean", value: true });
      await submitPatientInput(session.id, { kind: "text", value: "That makes sense to me -- I have never really questioned that belief." });

      // A plain descriptive sentence like this doesn't get parsed apart
      // into "the situation part" vs. "the thought part" -- this combined
      // prompt's extraction needs both concepts genuinely stated, so both
      // outputFields (distressingSituation, automaticThought) stay missing
      // here. The point of this test is which CLARIFICATION TEXT that
      // produces, not which single field it names.
      const result = await submitPatientInput(session.id, {
        kind: "text",
        value: "My manager criticized my report in front of the whole team during a meeting yesterday afternoon.",
      });

      expect(result.turnOutcome).toBe("clarification");
      const after = await getRuntimeSession(session.id);
      const lastMessage = after?.messages.at(-1);
      // Must be the real, field-aware clarification (names both the
      // situation AND the thought) -- not the generic Situation-pattern
      // fallback ("give one brief, concrete moment"), which only ever
      // reads outputFields[0] and would silently drop the automaticThought
      // ask entirely.
      expect(lastMessage?.content.toLowerCase()).toContain("thought");
      expect(lastMessage?.content.toLowerCase()).not.toContain("concrete moment");
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 15_000);
});
