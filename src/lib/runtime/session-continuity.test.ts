import { describe, expect, it } from "vitest";
import { computeSessionContinuitySeed } from "@/lib/runtime/session-continuity";
import type { PriorHomeworkSummary, PriorSessionSummary } from "@/lib/runtime/session-continuity";

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
