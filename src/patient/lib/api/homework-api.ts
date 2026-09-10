import { ensureHomeworkRecord, getHomeworkRecord, updateHomeworkRecord, appendHomeworkEntry, listHomeworkEntries } from "@/shared/data/repositories/homework-repository";
import { HOMEWORK_CATEGORY_BY_SESSION, hasHomeworkActivity, type HomeworkStatus } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

// Shared entry point every per-session homework page calls first: creates
// (idempotently) the one HomeworkRecord for this completed session, with a
// category-appropriate initial status. "ongoing"/"action_plan" sessions
// start in_progress (there's a first thing to do); "review" sessions start
// review_available (nothing new to author, just review/share the completed
// worksheet) -- see Part 3/homework proposal's own S3/S5 distinction.
export async function ensureHomeworkForSession(session: RuntimeSession) {
  if (!hasHomeworkActivity(session.sessionDefinitionId)) return undefined;
  const category = HOMEWORK_CATEGORY_BY_SESSION[session.sessionDefinitionId];
  const initialStatus: HomeworkStatus = category === "review" ? "review_available" : "in_progress";
  return ensureHomeworkRecord({
    runtimeSessionId: session.id,
    sessionDefinitionId: session.sessionDefinitionId,
    participantId: session.participantId,
    initialStatus,
  });
}

export { getHomeworkRecord, updateHomeworkRecord, appendHomeworkEntry, listHomeworkEntries };
