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

/** Delegates to the real assessment model for every call except the ones a
 * test explicitly scripts -- lets a test reach reflect-goal-score using
 * genuine deterministic classification, then inject exactly one failure for
 * the correction turn itself (Phase 3 section 27's fail-closed requirement),
 * without having to fake the entire setup sequence. */
class PassthroughThenScriptedModel implements AssessmentModel {
  private real: AssessmentModel;
  public override: (() => Promise<AssessmentResult>) | null = null;
  constructor(real: AssessmentModel) { this.real = real; }
  async assessInput(request: AssessmentRequest): Promise<AssessmentResult> {
    if (this.override) {
      const fn = this.override;
      this.override = null;
      return fn();
    }
    return this.real.assessInput(request);
  }
  async healthCheck(): Promise<AssessmentProviderHealth> { return this.real.healthCheck(); }
  getProviderMetadata(): AssessmentProviderMetadata { return this.real.getProviderMetadata(); }
}

describe("S02 -- Phase 3: rating correction assessment-failure fail-closed (contract test)", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    resetAssessmentModelForTests();
  });

  afterEach(() => {
    resetAssessmentModelForTests();
  });

  async function reachGoalRatingWithTwoGoals(sessionId: string) {
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
    await submitPatientInput(sessionId, { kind: "text", value: "목표A" });
    await submitPatientInput(sessionId, { kind: "text", value: "목표B" });
    await submitPatientInput(sessionId, { kind: "text", value: "더 생각나는 건 없어요" });
    view = await current(sessionId);
    if (view.currentPromptItem?.id === "tbct-s02-n07-p08-goal-dream-small-step") {
      await submitPatientInput(sessionId, { kind: "text", value: "아니요" });
      view = await current(sessionId);
    }
    await submitPatientInput(sessionId, { kind: "text", value: "네" }); // goal-rating-card-check
    return current(sessionId);
  }

  // Test (Phase 3 section 27): assessment provider failure on a non-pure
  // rating turn must fail-closed -- no stray digit stored as a rating, and
  // the current item must not be silently removed.
  it("provider failure never records a stray digit as a rating and never removes the current item", async () => {
    const { getAssessmentModel } = await import("@/lib/assessment/assessment-providers");
    const real = getAssessmentModel();
    resetAssessmentModelForTests();
    const scripted = new PassthroughThenScriptedModel(real);
    setAssessmentModelForTests(scripted);

    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR" });
    await startRuntimeSession(session.id);
    const view = await reachGoalRatingWithTwoGoals(session.id);
    expect(view.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");

    scripted.override = async () => { throw new Error("simulated provider timeout"); };
    const result = await submitPatientInput(session.id, { kind: "text", value: "5. 근데 이건 앞에 있던 거랑 같은 항목이에요" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await current(session.id);
    expect(after.session.runtimeContext.fields.goals).toEqual(["목표A", "목표B"]);
    expect(after.session.runtimeContext.fields.goalRatings ?? []).toHaveLength(0);
    expect(after.currentPromptItem?.id).toBe("tbct-s02-n09-p01-reflect-goal-score");
  }, 15_000);
});
