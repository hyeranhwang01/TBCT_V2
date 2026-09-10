import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/lib/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/lib/api/runtime-execution-api";
import { getLocalDb } from "@/lib/db/tbct-local-db";
import { resetAssessmentModelForTests, setAssessmentModelForTests } from "@/lib/assessment/assessment-providers";
import type { AssessmentModel, AssessmentProviderHealth, AssessmentProviderMetadata, AssessmentRequest, AssessmentResult } from "@/lib/assessment/assessment-contract";

async function current(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("missing session");
  return view;
}

function baseResult(overrides: Partial<AssessmentResult>): AssessmentResult {
  return {
    inputValid: true,
    relevance: "relevant",
    intent: "answer",
    extractedFields: {},
    completionStatus: "complete",
    safetyLevel: "none",
    safetySignals: [],
    recommendedTransition: null,
    internalSummary: null,
    ...overrides,
  };
}

/** A fully controllable fake assessment provider: each test sets exactly
 * what the "model" returns for the next call, then drives one real turn
 * through submitPatientInput and inspects the resulting runtime state --
 * this is the state mutation table (Phase 2 report section E) made
 * executable, independent of whatever the deterministic fallback's own
 * heuristics happen to produce. Same test-support idiom as
 * src/test/fakes/*.fake.ts + installFakeStoreFetch, applied to the
 * assessment provider instead of the store/dialogue-agent HTTP layer. */
class ScriptedAssessmentModel implements AssessmentModel {
  public next: AssessmentResult | Error = baseResult({});
  async assessInput(_request: AssessmentRequest): Promise<AssessmentResult> {
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
  async healthCheck(): Promise<AssessmentProviderHealth> { return { ok: true, provider: "deterministic" }; }
  getProviderMetadata(): AssessmentProviderMetadata { return { provider: "deterministic", privacyBoundary: "none" }; }
}

describe("S02 -- Phase 2: collection semantic gate contract tests (scripted assessment provider)", () => {
  const model = new ScriptedAssessmentModel();

  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    setAssessmentModelForTests(model);
  });

  afterEach(() => {
    resetAssessmentModelForTests();
  });

  it("turnAction=accept_answer appends the participant's raw text verbatim, never the model's extractedFields", async () => {
    model.next = baseResult({ turnAction: "accept_answer", extractedFields: { problems: "a rewritten version the model invented" } });
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "원본 그대로 저장되어야 하는 문장" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems).toEqual(["원본 그대로 저장되어야 하는 문장"]);
  }, 15_000);

  it("turnAction=clarification_request never mutates problems, keeps the active prompt, and does not set NoMore", async () => {
    model.next = baseResult({ turnAction: "clarification_request" });
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const before = await current(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "아무 텍스트" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).toHaveLength(0);
    expect(after.session.runtimeContext.fields.problemsNoMore).not.toBe(true);
    expect(after.currentPromptItem?.id).toBe(before.currentPromptItem?.id);
  }, 15_000);

  it("turnAction=collection_stop sets NoMore without storing the raw text or requiring a prior item", async () => {
    model.next = baseResult({ turnAction: "collection_stop" });
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "아무 텍스트" });
    expect(result.turnOutcome).toBe("normal");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).toHaveLength(0);
    expect(after.session.runtimeContext.fields.problemsNoMore).toBe(true);
  }, 15_000);

  it("turnAction=unresolved never mutates problems and keeps the active prompt (same contract as clarification_request)", async () => {
    model.next = baseResult({ turnAction: "unresolved" });
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const before = await current(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "아무 텍스트" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).toHaveLength(0);
    expect(after.currentPromptItem?.id).toBe(before.currentPromptItem?.id);
  }, 15_000);

  // Test 14 (Phase 2 required test): assessment provider failure must
  // fail-closed -- no raw-text auto-append, regardless of clarification
  // retry count. This is the exact scenario the old generic list-building
  // path used to get wrong (any non-empty text was "meaningful", so a
  // failed/unconfigured assessment still resulted in storage via a
  // different code path).
  it("Test 14: assessment provider failure never auto-appends raw text (fail-closed)", async () => {
    model.next = new Error("simulated provider timeout");
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const before = await current(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "공부 때문에 너무 압박을 느껴요" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).toHaveLength(0);
    expect(after.currentPromptItem?.id).toBe(before.currentPromptItem?.id);
  }, 15_000);

  it("safetyLevel=high from the assessment short-circuits to a risk signal before any turnAction dispatch, even when turnAction says accept_answer", async () => {
    model.next = baseResult({ turnAction: "accept_answer", safetyLevel: "high", safetySignals: ["scripted_high_risk"] });
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "아무 텍스트" });
    expect(result.stateExtraction?.riskLevel).toBe("high");
    expect(result.stateExtraction?.riskSignals).toContain("scripted_high_risk");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).toHaveLength(0);
  }, 15_000);

  it("intent=refusal from the assessment is surfaced as patient_refusal_semantic and does not append", async () => {
    model.next = baseResult({ turnAction: "accept_answer", intent: "refusal" });
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const result = await submitPatientInput(session.id, { kind: "text", value: "아무 텍스트" });
    expect(result.stateExtraction?.riskSignals).toContain("patient_refusal_semantic");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.problems ?? []).toHaveLength(0);
  }, 15_000);
});
