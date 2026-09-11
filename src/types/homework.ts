// Domain types for the patient-facing homework/follow-up-activity layer
// (sql/007_homework.sql). One record per completed session, holding
// session-specific top-level state in `data`; ongoing-type sessions (S1
// practice-example log, S6 practice tries, S8 daily appeals) additionally
// accumulate HomeworkEntryRecord rows. The per-session shape of `data`/entry
// `data` is intentionally untyped here (Record<string, unknown>) -- each
// session's own module in src/patient/lib/homework/ owns and types its own shape;
// this file only owns what's common across all eight.

export type HomeworkStatus = "not_started" | "in_progress" | "completed" | "ongoing" | "review_available";

export interface HomeworkRecord {
  id: string;
  runtimeSessionId: string;
  sessionDefinitionId: string;
  participantId: string;
  status: HomeworkStatus;
  updatedAt: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface HomeworkEntryRecord {
  id: string;
  homeworkRecordId: string;
  entryType: string;
  createdAt: string;
  data: Record<string, unknown>;
}

// Session-definition-id -> the follow-up activity's own display name and
// category, exactly as specified: S1/S6/S8 are repeatable "ongoing" logs;
// S4/S7 are one-or-more follow-ups after an Action Plan is executed; S3/S5
// are review/share only, with no new patient-authored entries.
export const HOMEWORK_LABEL_BY_SESSION: Record<string, string> = {
  "tbct-s01": "Distortion Examples", // 15-distortion table with a "내 예시" column (note2026_09_12_s01_redesign)
  "tbct-s02": "Check-in",
  "tbct-s03": "Review Intra-TR",
  "tbct-s04": "Action Plan",
  "tbct-s05": "Review Grid",
  "tbct-s06": "Practice",
  "tbct-s07": "Decision Plan",
  "tbct-s08": "Appeal Record",
};

export const HOMEWORK_CATEGORY_BY_SESSION: Record<string, "ongoing" | "action_plan" | "review"> = {
  "tbct-s01": "ongoing",
  "tbct-s02": "ongoing", // repeated check-in rounds building a "journey" trend, like S1/S6/S8
  "tbct-s03": "review",
  "tbct-s04": "action_plan",
  "tbct-s05": "review",
  "tbct-s06": "ongoing",
  "tbct-s07": "action_plan",
  "tbct-s08": "ongoing",
};

export function hasHomeworkActivity(sessionDefinitionId: string): boolean {
  return sessionDefinitionId in HOMEWORK_LABEL_BY_SESSION;
}
