import { HOMEWORK_LABEL_BY_SESSION } from "@/types/homework";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeContext, RuntimeSession } from "@/types/runtime-session";

// Carries what the previous session left behind into the next session's
// starting RuntimeContext.
//
// The protocol already asks for this. S02's opening node has four prompts --
// returning-opening ("Welcome back..."), between-session-bridge ("How did that
// go for you?"), assessment-transition, and the first-session-opening they
// replace -- all gated on `returningParticipant`, and the source itself
// (tbct-source-text.generated.ts:421) requires a warm bridge that acknowledges
// the previous session and asks about between-session work before any
// assessment starts.
//
// But `returningParticipant` was only ever READ. Nothing in the codebase set
// it, so `not_equals: true` always matched and `equals: true` never did: every
// participant, on every session, got the first-session opening, and the three
// returning-participant prompts were unreachable. `homeworkStatus` had the same
// shape of gap -- it is wired into all three condition evaluators
// (runtime-condition-evaluator.ts, protocol-api.ts, source-fidelity-prompt-
// progression.ts) but was only ever written from a `homework_status` patient
// input, never seeded from the homework the participant was actually given.
//
// This module is the missing write side. It is deliberately pure: the callers
// fetch the records, this decides what the next session should start with.

/** Only the fields the seed actually reads, so tests can pass plain literals
 * instead of constructing whole RuntimeSession/HomeworkRecord objects. */
export type PriorSessionSummary = Pick<RuntimeSession, "id" | "sessionDefinitionId" | "status" | "updatedAt">;
export type PriorHomeworkSummary = Pick<HomeworkRecord, "runtimeSessionId" | "sessionDefinitionId" | "status" | "updatedAt">;

export interface SessionContinuitySeed {
  /** Merged into RuntimeContext.fields at session creation. */
  fields: Record<string, unknown>;
  /** Replaces RuntimeContext.homeworkStatus at session creation. */
  homeworkStatus: NonNullable<RuntimeContext["homeworkStatus"]>;
}

export const EMPTY_CONTINUITY_SEED: SessionContinuitySeed = { fields: {}, homeworkStatus: "not_assigned" };

/** A participant is "returning" once they have finished a session, not merely
 * started one. The bridge asks how the between-session work went, which only
 * makes sense after a session that actually reached its end and assigned
 * something -- an abandoned or safety-paused first attempt leaves nothing to
 * ask about, and greeting that participant with "Welcome back" would be worse
 * than greeting them as new. */
function completedPriorSessions(priorSessions: PriorSessionSummary[], excludeSessionId?: string) {
  return priorSessions
    .filter((item) => item.id !== excludeSessionId && item.status === "completed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** HomeworkRecord.status is the follow-up activity's own lifecycle (five
 * values, including the S3/S5 "nothing to author, just review" state).
 * RuntimeContext.homeworkStatus is the three-value protocol-facing flag the
 * condition evaluators branch on. "Did the participant finish it?" is the only
 * question the protocol asks, so everything that is not finished is pending. */
function toContextHomeworkStatus(record: PriorHomeworkSummary | undefined): SessionContinuitySeed["homeworkStatus"] {
  if (!record) return "not_assigned";
  return record.status === "completed" ? "completed" : "pending";
}

export function computeSessionContinuitySeed(input: {
  priorSessions: PriorSessionSummary[];
  homeworkRecords: PriorHomeworkSummary[];
  /** The session being created, when it is already in the participant's list. */
  excludeSessionId?: string;
}): SessionContinuitySeed {
  const completed = completedPriorSessions(input.priorSessions, input.excludeSessionId);
  const previous = completed[0];
  if (!previous) return EMPTY_CONTINUITY_SEED;

  const record = input.homeworkRecords.find((item) => item.runtimeSessionId === previous.id);
  const homeworkStatus = toContextHomeworkStatus(record);

  // `returningParticipant` is the only field S02's activation conditions read.
  // The rest are here so the bridge can name what it is asking about instead of
  // asking a generic "how did it go" -- and so a clinician reading the runtime
  // context can see which session this one is continuing from.
  const fields: Record<string, unknown> = {
    returningParticipant: true,
    previousSessionDefinitionId: previous.sessionDefinitionId,
    previousSessionCompletedAt: previous.updatedAt,
    completedSessionCount: completed.length,
    previousHomeworkStatus: homeworkStatus,
  };

  const label = HOMEWORK_LABEL_BY_SESSION[previous.sessionDefinitionId];
  if (label) fields.previousHomeworkLabel = label;

  return { fields, homeworkStatus };
}
