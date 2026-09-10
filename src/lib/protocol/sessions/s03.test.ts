import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/lib/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/lib/api/runtime-execution-api";
import { getLocalDb } from "@/lib/db/tbct-local-db";

// TBCT S01-S03 정상 발화 오인 수정 (2026-08-17 fidelity pass), S03 section.
// Regression coverage for P0-3 (orientation no longer forces/rejects patient
// input), P0-6 (negated/historical/third-party safety mentions get a
// clarifying question instead of the immediate crisis route, while a genuine
// current disclosure still does), and P1-2 (situation/thought/emotion stay
// in their own fields, never bleeding into each other).

async function current(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error(`Session ${sessionId} not found.`);
  return view;
}

async function passOrientation(sessionId: string) {
  await submitPatientInput(sessionId, { kind: "text", value: "괜찮아요, 특별히 급한 건 없어요" }); // safety-check (introduction auto-advances)
  await submitPatientInput(sessionId, { kind: "text", value: "네" }); // redirection-contract (boolean)
  await submitPatientInput(sessionId, { kind: "text", value: "네" }); // worksheet-readiness-check (boolean)
}

describe("S03 Intra-TR -- 정상 발화 오인 수정", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("P0-3: the 14-question introduction never forces/rejects a patient answer -- the flow reaches redirection-contract without any answer to the introduction itself", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    // Before the fix, fourteen-question-introduction's outputFields:
    // ["intraTrIntroductionComplete"] with no validation.kind made it wait
    // for a patient answer with nothing able to satisfy it, so the safety
    // check's answer would land here needing a further "네" that then got
    // rejected as filler. Now the introduction (and the already-passive
    // ccd-connection after it) both auto-deliver and auto-advance in the
    // same turn as the safety-check answer, landing directly on the first
    // real yes/no question (redirection-contract).
    const afterSafetyCheck = await submitPatientInput(session.id, { kind: "text", value: "괜찮아요, 특별히 급한 건 없어요" });
    expect(afterSafetyCheck.turnOutcome).toBe("normal");
    const view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s03-n02-p03-redirection-contract");

    const result = await submitPatientInput(session.id, { kind: "text", value: "네" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.currentPromptItem?.id).toBe("tbct-s03-n02-p04-worksheet-readiness-check");
  }, 15_000);

  it("manual fidelity: the guide checks the participant has the Intra-TR worksheet before Q1, matching the pre-reading manual (\"The guide will check you have it before you begin\")", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "괜찮아요, 특별히 급한 건 없어요" }); // safety-check
    await submitPatientInput(session.id, { kind: "text", value: "네" }); // redirection-contract

    const view = await current(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s03-n02-p04-worksheet-readiness-check");

    const result = await submitPatientInput(session.id, { kind: "text", value: "네" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.worksheetReady).toBe(true);
    expect(after.currentPromptItem?.id).toBe("tbct-s03-n03-p01-describe-situation");
  }, 15_000);

  it("P1-2: situation, automatic thought, and emotion are recorded in their own fields, never bleeding into each other", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await passOrientation(session.id);

    const situationResult = await submitPatientInput(session.id, { kind: "text", value: "상사가 회의에서 보고서 수정이 필요하다고 말했어요" });
    expect(situationResult.turnOutcome).toBe("normal");
    let view = await current(session.id);
    expect(view.session.runtimeContext.fields.situation).toBe("상사가 회의에서 보고서 수정이 필요하다고 말했어요");
    expect(view.currentPromptItem?.id).toBe("tbct-s03-n04-p01-automatic-thought");

    const thoughtResult = await submitPatientInput(session.id, { kind: "text", value: "상사가 저를 무능하다고 생각하는 것 같았어요" });
    expect(thoughtResult.turnOutcome).toBe("normal");
    view = await current(session.id);
    expect(view.session.runtimeContext.fields.automaticThought).toBe("상사가 저를 무능하다고 생각하는 것 같았어요");
    // The situation field is untouched by the thought answer.
    expect(view.session.runtimeContext.fields.situation).toBe("상사가 회의에서 보고서 수정이 필요하다고 말했어요");
  }, 15_000);

  it("P0-6: a negated safety mention gets a clarifying question, not the immediate crisis route", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await passOrientation(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "상사가 회의에서 보고서 수정이 필요하다고 말했어요" });
    await submitPatientInput(session.id, { kind: "text", value: "상사가 저를 무능하다고 생각하는 것 같았어요" });

    const result = await submitPatientInput(session.id, { kind: "text", value: "죽고 싶은 건 아니에요. 그냥 너무 지쳤어요." });
    expect(result.safetyResult.triggered).toBe(false);
    expect(result.stateExtraction?.riskLevel).toBe("low");
    expect(result.stateExtraction?.riskSignals).toContain("ambiguous_safety_language");
    expect(result.sessionStatus).toBe("waiting_for_input");
    expect(result.generatedMessage?.content).toMatch(/확인|이해/);
  }, 15_000);

  it("regression: a genuine, unqualified current-risk disclosure still takes the immediate safety route", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await passOrientation(session.id);
    await submitPatientInput(session.id, { kind: "text", value: "상사가 회의에서 보고서 수정이 필요하다고 말했어요" });

    const result = await submitPatientInput(session.id, { kind: "text", value: "지금 너무 힘들어서 죽고 싶어요" });
    expect(result.safetyResult.triggered).toBe(true);
    expect(result.stateExtraction?.riskLevel).toBe("high");
    // High-severity signals escalate to clinician review rather than merely
    // pausing -- see runtime-safety-orchestrator.ts's severity === "high"
    // branch (action: "escalate_clinician").
    expect(result.sessionStatus).toBe("escalated");
  }, 15_000);
});

// Bug report: answering a passive reflection/readback turn with a plain
// "네" sometimes produced an unrelated generic reply instead of continuing
// the session. Root cause: promptRequiresPatientInput (runtime-release-
// normalizer.ts) treats every "reflection"/"confirmation"-typed prompt as
// requiring a substantive answer unless its id is explicitly listed as a
// passive acknowledgment -- cycle-note (the reported example) and
// full-conclusion-readback were both missing that treatment.
describe("S03 Intra-TR -- '네' continues the session instead of a generic reply (bug fix)", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  /** Reasonable answer for every prompt on the path from Q1 through
   * conclusion-belief. cycle-note and full-conclusion-readback (both fixed
   * above) get a plain "네" -- the exact reply the bug report used. Passive
   * prompts that no longer wait for input (cycle-note, once fixed) are never
   * actually reached by this walk since the runtime skips straight past
   * them, but the entry is kept in case that changes. */
  function answerForS03Prompt(promptId: string | undefined): string {
    switch (promptId) {
      case "tbct-s03-n03-p01-describe-situation": return "친구가 제 메시지에 답장을 안 했어요";
      case "tbct-s03-n04-p01-automatic-thought": return "저를 무시하는 것 같았어요";
      case "tbct-s03-n06-p01-rate-at-belief": return "70";
      case "tbct-s03-n07-p01-primary-emotion": return "속상함";
      case "tbct-s03-n07-p03-emotion-intensity": return "80";
      case "tbct-s03-n08-p01-behavior": return "메시지를 계속 확인했어요";
      case "tbct-s03-n08-p02-body-sensations": return "가슴이 답답했어요";
      case "tbct-s03-n08-p03-participant-summary": return "친구가 답장을 안 해서 저를 무시한다고 생각했고, 속상해서 가슴이 답답했어요";
      case "tbct-s03-n08-p04-cycle-note": return "네";
      case "tbct-s03-n09-p01-behavior-pros": return "생각을 안 하려고 노력하니까 잠깐은 편했어요";
      case "tbct-s03-n09-p03-behavior-cons": return "계속 신경이 쓰이고 일에 집중이 안 됐어요";
      case "tbct-s03-n09-p04-cognitive-distortion": return "독심술";
      case "tbct-s03-n10-p01-evidence-for": return "예전에 연락이 늦었을 때도 서운했던 적이 있어요";
      case "tbct-s03-n10-p02-evidence-for-more": return "그때도 나중엔 별일 아니었어요";
      case "tbct-s03-n10-p03-evidence-against": return "보통은 하루 안에 답장을 잘 해줘요";
      case "tbct-s03-n10-p04-evidence-against-direction": return "요즘 친구가 일 때문에 많이 바빴다고 들었어요";
      case "tbct-s03-n11-p01-balanced-conclusion": return "친구가 저를 무시한다는 확실한 증거는 없고, 그냥 바빴을 가능성이 커요";
      case "tbct-s03-n11-p02-therefore-extension": return "따라서 답장이 늦는다고 저를 무시하는 건 아니에요";
      case "tbct-s03-n11-p03-full-conclusion-readback": return "네";
      case "tbct-s03-n11-p04-conclusion-belief": return "90";
      case "tbct-s03-n12-p01-positive-emotions-first": return "다행이라는 마음이 들어요";
      case "tbct-s03-n12-p02-original-negative-emotion": return "60";
      case "tbct-s03-n12-p03-emotion-intensities": return "50";
      case "tbct-s03-n13-p01-intended-action": return "천천히 제 속도대로 해보려고 해요";
      case "tbct-s03-n13-p03-new-body-sensations": return "몸이 좀 더 편안해진 것 같아요";
      case "tbct-s03-n13-p04-repeat-exact-at": return "70";
      default: return "네";
    }
  }

  /** Walks forward from wherever the session currently is, answering each
   * prompt with answerForS03Prompt, until currentPromptItem is targetId (or
   * maxTurns is exhausted). Returns every generatedMessage content seen
   * along the way, so the caller can assert none of them is the generic
   * fallback -- robust to passive prompts (like the newly-fixed cycle-note)
   * completing on delivery and being skipped without their own patient turn. */
  async function walkToPrompt(sessionId: string, targetId: string, maxTurns = 20) {
    const messages: string[] = [];
    let view = await current(sessionId);
    for (let guard = 0; guard < maxTurns; guard += 1) {
      if (view.currentPromptItem?.id === targetId) return { view, messages };
      const value = answerForS03Prompt(view.currentPromptItem?.id);
      const result = await submitPatientInput(sessionId, { kind: "text", value });
      if (result.generatedMessage?.content) messages.push(result.generatedMessage.content);
      view = await current(sessionId);
    }
    throw new Error(`Did not reach ${targetId} within ${maxTurns} turns; stopped at ${view.currentPromptItem?.id}`);
  }

  it("cycle-note: reaching it (or being carried past it) never produces the generic 'give a short concrete example' fallback", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await passOrientation(session.id);

    const { messages } = await walkToPrompt(session.id, "tbct-s03-n09-p01-behavior-pros");
    expect(messages.some((content) => content.includes("짧고 구체적인 예를"))).toBe(false);
  }, 20_000);

  it("full-conclusion-readback: a plain '네' sets conclusionReadBackComplete and advances to conclusion-belief, never the generic fallback", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    await passOrientation(session.id);

    const { messages: preMessages } = await walkToPrompt(session.id, "tbct-s03-n11-p03-full-conclusion-readback");
    expect(preMessages.some((content) => content.includes("짧고 구체적인 예를"))).toBe(false);

    const result = await submitPatientInput(session.id, { kind: "text", value: "네" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    // This particular transition (a boolean-validated confirmation handing
    // off to the next rating prompt) goes through the dialogue agent and
    // doesn't mirror its own generated message onto result.generatedMessage
    // -- session.messages is the reliable source for what was actually sent.
    const lastAssistantMessage = [...after.messages].reverse().find((message) => message.role === "assistant");
    expect(lastAssistantMessage?.content).not.toContain("짧고 구체적인 예를");
    expect(after.session.runtimeContext.fields.conclusionReadBackComplete).toBe(true);
    expect(after.currentPromptItem?.id).toBe("tbct-s03-n11-p04-conclusion-belief");
  }, 20_000);

  // Bug report: a real en-US session reached the very last Intra-TR question
  // (global-evaluation, "same / a little better / much better") and got
  // stuck. Root cause: matchEnumChoice (runtime-deterministic-input.ts) only
  // accepts an exact match against validation.values or a listed alias --
  // this prompt had no aliases at all, so a natural answer missing the
  // leading article ("little better" instead of "a little better") was
  // rejected every time, repeating the identical re-ask until the session
  // paused. Same defect class already fixed for S07/S08 (and half-fixed,
  // Korean-only, for S04's near-identical final-emotional-check).
  it("bug fix: 'little better' (missing the article) at the final global-evaluation check is accepted via alias, not rejected forever", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "en-US" });
    await startRuntimeSession(session.id);
    await passOrientation(session.id);

    const { view } = await walkToPrompt(session.id, "tbct-s03-n13-p05-global-evaluation", 30);
    expect(view.currentPromptItem?.id).toBe("tbct-s03-n13-p05-global-evaluation");

    // Matches the reported transcript: a full sentence first (still not an
    // exact enum match), producing one clarification re-ask.
    const first = await submitPatientInput(session.id, { kind: "text", value: "It seems a little better." });
    expect(first.turnOutcome).toBe("clarification");

    // The reported failure: the article-less rephrasing must now be
    // recognized via alias instead of looping toward a pause.
    const answered = await submitPatientInput(session.id, { kind: "text", value: "little better" });
    expect(answered.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.globalEvaluation).toBe("a little better");
    expect(after.session.status).not.toBe("paused");
  }, 20_000);
});
