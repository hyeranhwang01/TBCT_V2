import { HOMEWORK_STORE_ENDPOINT } from "@/shared/runtime/homework-store-ops";
import type { HomeworkStoreOp } from "@/shared/runtime/homework-store-ops";
import { resolveStoreUrl } from "@/shared/runtime/resolve-store-url";
import type { HomeworkEntryRecord, HomeworkRecord, HomeworkStatus } from "@/types/homework";

// Thin fetch client over src/app/api/homework/store/route.ts, matching the
// pattern of worksheet-repository.ts / runtime-session-repository.ts.
async function callStore<T>(op: HomeworkStoreOp): Promise<T> {
  const response = await fetch(resolveStoreUrl(HOMEWORK_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Homework store operation failed.");
  return body.result as T;
}

export async function ensureHomeworkRecord(input: { runtimeSessionId: string; sessionDefinitionId: string; participantId: string; initialStatus: HomeworkStatus; initialData?: Record<string, unknown> }) {
  return callStore<HomeworkRecord>({ op: "ensureRecord", ...input });
}

export async function getHomeworkRecord(runtimeSessionId: string) {
  return callStore<HomeworkRecord | undefined>({ op: "getRecord", runtimeSessionId });
}

export async function getHomeworkRecordById(id: string) {
  return callStore<HomeworkRecord | undefined>({ op: "getRecordById", id });
}

export async function updateHomeworkRecord(id: string, patch: Partial<Pick<HomeworkRecord, "status" | "data">>) {
  return callStore<HomeworkRecord>({ op: "updateRecord", id, patch });
}

export async function listHomeworkRecordsByParticipant(participantId: string) {
  return callStore<HomeworkRecord[]>({ op: "listRecordsByParticipant", participantId });
}

export async function appendHomeworkEntry(homeworkRecordId: string, entryType: string, data: Record<string, unknown>) {
  return callStore<HomeworkEntryRecord>({ op: "appendEntry", homeworkRecordId, entryType, data });
}

export async function listHomeworkEntries(homeworkRecordId: string, entryType?: string) {
  return callStore<HomeworkEntryRecord[]>({ op: "listEntries", homeworkRecordId, entryType });
}

export async function updateHomeworkEntry(id: string, patch: Partial<Pick<HomeworkEntryRecord, "data">>) {
  return callStore<HomeworkEntryRecord>({ op: "updateEntry", id, patch });
}
