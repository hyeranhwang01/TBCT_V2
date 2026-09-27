// What a sealed session record contains (sql/034,
// .claude/TASK_SCOPE.json note2026_09_28_rct_backend M2). Built on the server
// only (trial-store finalizeSessionRecord), from the stores as they are when
// the session ends -- never from anything a client sends.
//
// The earlier-session memory the model was shown is copied in as text, not as
// chunk ids only, so the record alone says what the model saw even if a chunk
// is later suppressed.

import { getRuntimeSession } from "@/shared/api/runtime-session-api";
import { getWorksheetInstance, listWorksheetFieldRevisions, listWorksheetFieldValues } from "@/shared/data/repositories/worksheet-repository";
import { getHomeworkRecord, listHomeworkEntries } from "@/shared/data/repositories/homework-repository";
import { listSafetyEvents } from "@/shared/data/repositories/safety-event-repository";
import { getSessionSummaryBySession } from "@/shared/data/repositories/session-summary-repository";
import { listMemoryChunkRetrievals, listMemoryChunks } from "@/shared/data/repositories/memory-chunk-repository";
import { getParticipant } from "@/shared/data/repositories/participant-repository";
import { computeStepFidelity } from "@/shared/trial/step-progress";
import type { RuntimeEvent } from "@/types/trial";

export const SESSION_RECORD_SCHEMA_VERSION = "session-record-v1";

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export async function buildSessionSnapshot(runtimeSessionId: string, context: { events: RuntimeEvent[] }) {
  const view = await getRuntimeSession(runtimeSessionId);
  if (!view) throw new Error("Runtime session not found");
  const session = view.session;

  const instance = await settle(getWorksheetInstance(runtimeSessionId), undefined);
  const fieldValues = instance ? await settle(listWorksheetFieldValues(instance.id), []) : [];
  const worksheet = instance
    ? {
        instanceId: instance.id,
        values: await Promise.all(fieldValues.map(async (value) => ({ ...value, revisions: await settle(listWorksheetFieldRevisions(value.id), []) }))),
      }
    : null;

  const homeworkRecord = await settle(getHomeworkRecord(runtimeSessionId), undefined);
  const homework = homeworkRecord ? { record: homeworkRecord, entries: await settle(listHomeworkEntries(homeworkRecord.id), []) } : null;

  const safetyEvents = (await settle(listSafetyEvents(), [])).filter((event) => event.runtimeSessionId === runtimeSessionId);
  const summary = await settle(getSessionSummaryBySession(runtimeSessionId), undefined);

  const retrievals = await settle(listMemoryChunkRetrievals(runtimeSessionId), []);
  const chunkIds = new Set(retrievals.flatMap((retrieval) => retrieval.selected.map((item) => item.chunkId)));
  const chunks = chunkIds.size ? (await settle(listMemoryChunks(session.participantId, { includeSuppressed: true }), [])).filter((chunk) => chunkIds.has(chunk.id)) : [];
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const memory = retrievals.map((retrieval) => ({
    messageId: retrieval.messageId ?? null,
    consentState: retrieval.consentState,
    algorithmVersion: retrieval.algorithmVersion,
    indexVersion: retrieval.indexVersion,
    shown: retrieval.selected.map((item) => {
      const chunk = chunkById.get(item.chunkId);
      return { chunkId: item.chunkId, score: item.score, parts: item.parts, kind: chunk?.chunkKind, elementKind: chunk?.elementKind, fromSession: chunk?.sessionIndex, content: chunk?.content };
    }),
  }));

  const participant = await settle(getParticipant(session.participantId), undefined);
  const assistantMessages = view.messages.filter((message) => message.role === "assistant");
  const reportedSteps = assistantMessages.map((message) => (typeof message.metadata?.step === "number" ? (message.metadata.step as number) : null));
  const fidelity = computeStepFidelity(session.sessionDefinitionId, session.runtimeContext.fields, reportedSteps);

  const models = [...new Set(view.providerEvents.map((event) => event.model).filter(Boolean))];
  const promptVersions = [...new Set(assistantMessages.map((message) => message.metadata?.promptSessionVersion).filter(Boolean))];
  const promptHashes = [...new Set(assistantMessages.map((message) => message.metadata?.promptSessionSha256).filter(Boolean))];

  return {
    schemaVersion: SESSION_RECORD_SCHEMA_VERSION,
    session: {
      id: session.id,
      participantId: session.participantId,
      sessionDefinitionId: session.sessionDefinitionId,
      moduleNumber: session.moduleNumber ?? null,
      attemptNumber: session.attemptNumber ?? null,
      status: session.status,
      locale: session.locale,
      createdAt: session.createdAt,
      completedAt: session.completedAt ?? null,
      terminatedAt: (session as { terminatedAt?: string }).terminatedAt ?? null,
      releaseId: session.releaseId,
      fields: session.runtimeContext.fields,
    },
    conversation: view.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      nodeId: message.nodeId ?? null,
      metadata: message.metadata ?? {},
    })),
    ai: { models, promptVersions, promptHashes, providerEvents: view.providerEvents, validationEvents: view.validationEvents },
    worksheet,
    homework,
    safety: { events: safetyEvents, escalations: view.escalations },
    summary: summary ?? null,
    memory,
    memoryConsent: participant?.memoryConsent ?? null,
    fidelity,
    events: context.events.filter((event) => event.severity !== "info"),
  };
}

/** JSON with object keys sorted at every level, so the hash of a snapshot
 * does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
