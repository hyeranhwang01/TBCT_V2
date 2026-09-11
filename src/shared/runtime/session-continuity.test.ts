import { describe, expect, it } from "vitest";
import { S01_HOMEWORK_EXAMPLE_ENTRY_TYPE, computeSessionContinuitySeed, latestCompletedSession } from "@/shared/runtime/session-continuity";
import type { PriorHomeworkSummary, PriorSessionSummary } from "@/shared/runtime/session-continuity";
import { DISTORTION_EXAMPLE_ENTRY_TYPE } from "@/patient/sessions/s01/distortion-table";

const session = (over: Partial<PriorSessionSummary> = {}): PriorSessionSummary => ({
  id: "RTS-1",
  sessionDefinitionId: "tbct-s01",
  status: "completed",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

const homework = (over: Partial<PriorHomeworkSummary> = {}): PriorHomeworkSummary => ({
  runtimeSessionId: "RTS-1",
  sessionDefinitionId: "tbct-s01",
  status: "in_progress",
  updatedAt: "2026-09-02T00:00:00.000Z",
  ...over,
});

describe("computeSessionContinuitySeed", () => {
  it("leaves a first-time participant with no continuity fields at all", () => {
    // S02's first-session-opening is gated on returningParticipant not_equals
    // true, so the field must stay absent rather than be seeded as false --
    // see the activation-condition comment in sessions/s02.ts.
    const seed = computeSessionContinuitySeed({ priorSessions: [], homeworkRecords: [] });
    expect(seed.fields).toEqual({});
    expect(seed.homeworkStatus).toBe("not_assigned");
  });

  it("does not treat an unfinished prior session as a return visit", () => {
    const seed = computeSessionContinuitySeed({
      priorSessions: [session({ status: "paused" }), session({ id: "RTS-2", status: "safety_paused" })],
      homeworkRecords: [],
    });
    expect(seed.fields.returningParticipant).toBeUndefined();
  });

  it("marks a participant returning once one session has completed", () => {
    const seed = computeSessionContinuitySeed({
      priorSessions: [session({ sessionDefinitionId: "tbct-s05" })],
      homeworkRecords: [],
    });
    expect(seed.fields).toMatchObject({
      returningParticipant: true,
      previousSessionDefinitionId: "tbct-s05",
      completedSessionCount: 1,
      previousHomeworkLabel: "Review Grid",
    });
  });

  it("carries the most recently completed session, not the first one", () => {
    const seed = computeSessionContinuitySeed({
      priorSessions: [
        session({ id: "RTS-1", sessionDefinitionId: "tbct-s05", updatedAt: "2026-09-01T00:00:00.000Z" }),
        session({ id: "RTS-2", sessionDefinitionId: "tbct-s06", updatedAt: "2026-09-08T00:00:00.000Z" }),
      ],
      homeworkRecords: [],
    });
    expect(seed.fields).toMatchObject({ previousSessionDefinitionId: "tbct-s06", completedSessionCount: 2 });
  });

  it("reports homework the participant has not finished as pending", () => {
    const seed = computeSessionContinuitySeed({
      priorSessions: [session({ id: "RTS-2", sessionDefinitionId: "tbct-s06" })],
      homeworkRecords: [homework({ runtimeSessionId: "RTS-2", sessionDefinitionId: "tbct-s06", status: "in_progress" })],
    });
    expect(seed.homeworkStatus).toBe("pending");
    expect(seed.fields.previousHomeworkStatus).toBe("pending");
  });

  it("reports finished homework as completed", () => {
    const seed = computeSessionContinuitySeed({
      priorSessions: [session({ id: "RTS-2" })],
      homeworkRecords: [homework({ runtimeSessionId: "RTS-2", status: "completed" })],
    });
    expect(seed.homeworkStatus).toBe("completed");
  });

  it("treats a review-only follow-up as pending until the participant marks it done", () => {
    // S03/S05 open in review_available: there is nothing new to author, but the
    // participant has still not confirmed they looked at it.
    const seed = computeSessionContinuitySeed({
      priorSessions: [session({ id: "RTS-2", sessionDefinitionId: "tbct-s05" })],
      homeworkRecords: [homework({ runtimeSessionId: "RTS-2", sessionDefinitionId: "tbct-s05", status: "review_available" })],
    });
    expect(seed.homeworkStatus).toBe("pending");
  });

  it("ignores homework belonging to a session other than the previous one", () => {
    const seed = computeSessionContinuitySeed({
      priorSessions: [session({ id: "RTS-2", updatedAt: "2026-09-08T00:00:00.000Z" })],
      homeworkRecords: [homework({ runtimeSessionId: "RTS-OTHER", status: "completed" })],
    });
    expect(seed.homeworkStatus).toBe("not_assigned");
  });

  it("excludes the session being created from its own continuity lookup", () => {
    const seed = computeSessionContinuitySeed({
      priorSessions: [session({ id: "RTS-NEW" })],
      homeworkRecords: [],
      excludeSessionId: "RTS-NEW",
    });
    expect(seed.fields.returningParticipant).toBeUndefined();
  });
});

// S01 redesign (note2026_09_12_s01_redesign): S02 recalls the participant's
// own S01 words through previousS01* fields; S02's own fields stay empty.
describe("previous S01 recap fields", () => {
  const s01Fields = {
    s01Problems: ["불안이 심해요", "  ", "계획대로 안 되면 힘들어요"],
    s01RepresentativeProblem: " 불안이 심해요 ",
    s01Goal: "불안해도 할 일을 해내는 것",
    problems: ["must not be carried"],
  };

  it("carries the difficulties, goal and homework count under new names only", () => {
    const seed = computeSessionContinuitySeed({ priorSessions: [{ ...session(), runtimeContext: { fields: s01Fields } }], homeworkRecords: [], s01HomeworkExampleCount: 2 });
    expect(seed.fields).toMatchObject({
      previousSessionDefinitionId: "tbct-s01",
      previousS01Problems: ["불안이 심해요", "계획대로 안 되면 힘들어요"],
      previousS01RepresentativeProblem: "불안이 심해요",
      previousS01Goal: "불안해도 할 일을 해내는 것",
      previousS01HomeworkExampleCount: 2,
    });
    for (const key of ["problems", "problemRatings", "goals", "goalRatings", "s01Problems", "s01Goal"]) expect(seed.fields).not.toHaveProperty(key);
  });

  it("reads the latest completed S01 even when another session came after it", () => {
    const seed = computeSessionContinuitySeed({
      priorSessions: [
        { ...session({ id: "RTS-1", updatedAt: "2026-09-01T00:00:00.000Z" }), runtimeContext: { fields: s01Fields } },
        session({ id: "RTS-2", sessionDefinitionId: "tbct-s03", updatedAt: "2026-09-08T00:00:00.000Z" }),
      ],
      homeworkRecords: [],
    });
    expect(seed.fields.previousSessionDefinitionId).toBe("tbct-s03");
    expect(seed.fields.previousS01Goal).toBe("불안해도 할 일을 해내는 것");
    expect(seed.fields).not.toHaveProperty("previousS01HomeworkExampleCount");
  });

  it("adds nothing for a first-time participant or one who never finished S01", () => {
    expect(computeSessionContinuitySeed({ priorSessions: [], homeworkRecords: [], s01HomeworkExampleCount: 3 }).fields).toEqual({});
    const noS01 = computeSessionContinuitySeed({ priorSessions: [session({ sessionDefinitionId: "tbct-s05" }), { ...session({ id: "RTS-9", status: "paused" }), runtimeContext: { fields: s01Fields } }], homeworkRecords: [] });
    expect(Object.keys(noS01.fields).filter((key) => key.startsWith("previousS01"))).toEqual([]);
  });

  it("finds the latest completed run of a session definition", () => {
    const runs = [session({ id: "A", updatedAt: "2026-09-01T00:00:00.000Z" }), session({ id: "B", updatedAt: "2026-09-05T00:00:00.000Z" }), session({ id: "C", status: "paused", updatedAt: "2026-09-09T00:00:00.000Z" })];
    expect(latestCompletedSession(runs, "tbct-s01")?.id).toBe("B");
    expect(latestCompletedSession(runs, "tbct-s02")).toBeUndefined();
  });

  it("counts the same homework entry type the S01 homework screen writes", () => {
    expect(S01_HOMEWORK_EXAMPLE_ENTRY_TYPE).toBe(DISTORTION_EXAMPLE_ENTRY_TYPE);
  });
});
