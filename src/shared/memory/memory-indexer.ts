// Reads what a participant did and appends it to their memory chunks
// (.claude/TASK_SCOPE.json note2026_09_27_memory_rag_m2_chunks). Runs for
// everyone: storing is internal. Whether any of it may reach the model is
// decided at retrieval (memory-consent.ts), not here.
//
// Two moments:
//  - a session completes: its worksheet values and conversation;
//  - a session starts (and again at completion): homework entries, which are
//    written between sessions and so do not exist yet when the session that
//    assigned them completes.
// Chunk ids are stable, so running either twice adds nothing.

import { getRuntimeSession } from "@/shared/api/runtime-session-api";
import { listHomeworkEntries, listHomeworkRecordsByParticipant } from "@/shared/data/repositories/homework-repository";
import { saveMemoryChunks } from "@/shared/data/repositories/memory-chunk-repository";
import { buildHomeworkChunks, buildSessionChunks } from "@/shared/memory/chunk-builder";
import { worksheetChunkerFor } from "@/shared/memory/chunk-configs";
import { tagParticipantChunks, type TaggingOutcome } from "@/shared/memory/chunk-tagger";

export type IndexResult = { built: number; inserted: number };

export async function indexCompletedSession(runtimeSessionId: string): Promise<IndexResult & { participantId?: string; locale: string }> {
  const view = await getRuntimeSession(runtimeSessionId);
  if (!view) throw new Error("Runtime session not found");
  const session = view.session;
  const locale = session.locale ?? "ko-KR";
  if (!session.participantId) return { built: 0, inserted: 0, locale };
  const chunks = buildSessionChunks({
    participantId: session.participantId,
    runtimeSessionId: session.id,
    sessionDefinitionId: session.sessionDefinitionId,
    locale,
    fields: session.runtimeContext.fields,
    messages: view.messages,
    completedAt: session.completedAt ?? new Date().toISOString(),
    worksheetChunker: worksheetChunkerFor(session.sessionDefinitionId),
  });
  return { built: chunks.length, inserted: await saveMemoryChunks(chunks), participantId: session.participantId, locale };
}

/** What completeRuntimeSession runs: the session, then any homework. */
export async function indexAtCompletion(runtimeSessionId: string): Promise<{ session: IndexResult; homework: IndexResult; participantId?: string }> {
  const { participantId, locale, ...session } = await indexCompletedSession(runtimeSessionId);
  const homework = participantId ? await indexParticipantHomework(participantId, locale) : { built: 0, inserted: 0 };
  return { session, homework, participantId };
}

export async function indexParticipantHomework(participantId: string, locale: string): Promise<IndexResult> {
  const records = await listHomeworkRecordsByParticipant(participantId);
  let built = 0;
  let inserted = 0;
  for (const record of records) {
    const entries = await listHomeworkEntries(record.id);
    if (!entries.length) continue;
    const chunks = buildHomeworkChunks({ record, entries, locale });
    built += chunks.length;
    inserted += await saveMemoryChunks(chunks);
  }
  return { built, inserted };
}

/**
 * Tags the participant's untagged chunks without holding up the turn that
 * asked: tagging is a model call of several seconds, and it runs at the end of
 * a session (the closing message) and at the start of one (the first
 * message). Best effort -- whatever is not tagged now is tried again next
 * time, and retrieval works on untagged chunks too, with one signal fewer.
 * Consent is checked inside tagParticipantChunks.
 */
export function tagInBackground(participantId: string, onDone?: (outcome: TaggingOutcome | { status: "error"; error: string }) => void) {
  void tagParticipantChunks(participantId)
    .then((outcome) => onDone?.(outcome))
    .catch((error: unknown) => onDone?.({ status: "error", error: error instanceof Error ? error.message : String(error) }));
}
