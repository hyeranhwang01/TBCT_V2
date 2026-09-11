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
export type PriorSessionSummary = Pick<RuntimeSession, "id" | "sessionDefinitionId" | "status" | "updatedAt"> & { runtimeContext?: { fields?: Record<string, unknown> } };
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
function completedPriorSessions<T extends PriorSessionSummary>(priorSessions: T[], excludeSessionId?: string): T[] {
  return priorSessions
    .filter((item) => item.id !== excludeSessionId && item.status === "completed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** The most recently completed run of one session definition. */
export function latestCompletedSession<T extends PriorSessionSummary>(priorSessions: T[], sessionDefinitionId: string, excludeSessionId?: string): T | undefined {
  return completedPriorSessions(priorSessions, excludeSessionId).find((item) => item.sessionDefinitionId === sessionDefinitionId);
}

/** S01's homework entry type ("내 예시" in the 15-distortion table). Same
 * value as DISTORTION_EXAMPLE_ENTRY_TYPE in s01/distortion-table.tsx, kept
 * here so session creation does not import a client component; a test pins
 * the two together. */
export const S01_HOMEWORK_EXAMPLE_ENTRY_TYPE = "distortion_example";

/** S01 redesign (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign): what
 * the participant named in their first session, in their own words, for
 * S02's wording only (s02/messages.ts). New previousS01* names -- S02's own
 * problems/goals fields are never seeded; the participant still names this
 * session's problems and goals themselves. */
function previousS01Fields(s01: PriorSessionSummary | undefined, exampleCount?: number): Record<string, unknown> {
  if (!s01) return {};
  const source = s01.runtimeContext?.fields ?? {};
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const fields: Record<string, unknown> = {};
  const problems = Array.isArray(source.s01Problems) ? source.s01Problems.map(text).filter((item): item is string => Boolean(item)) : [];
  if (problems.length) fields.previousS01Problems = problems;
  const representative = text(source.s01RepresentativeProblem);
  if (representative) fields.previousS01RepresentativeProblem = representative;
  const goal = text(source.s01Goal);
  if (goal) fields.previousS01Goal = goal;
  if (typeof exampleCount === "number") fields.previousS01HomeworkExampleCount = exampleCount;
  return fields;
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
  /** Entries in the latest completed S01's homework, when it has a record. */
  s01HomeworkExampleCount?: number;
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
  Object.assign(fields, previousS01Fields(latestCompletedSession(completed, "tbct-s01"), input.s01HomeworkExampleCount));

  return { fields, homeworkStatus };
}
