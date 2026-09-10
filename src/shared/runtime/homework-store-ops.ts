// Shared client/server contract for the homework/follow-up-activity store
// (Neon Postgres, sql/007_homework.sql). Mirrors the pattern in
// worksheet-store-ops.ts/safety-store-ops.ts: no server-only imports, so
// this is safe to import from both the repository client
// (src/lib/repositories/homework-repository.ts) and the server-side store
// implementation (src/lib/server/homework-store.ts).
import type { HomeworkEntryRecord, HomeworkRecord, HomeworkStatus } from "@/types/homework";

export type HomeworkStoreOp =
  | { op: "ensureRecord"; runtimeSessionId: string; sessionDefinitionId: string; participantId: string; initialStatus: HomeworkStatus; initialData?: Record<string, unknown> }
  | { op: "getRecord"; runtimeSessionId: string }
  | { op: "getRecordById"; id: string }
  | { op: "updateRecord"; id: string; patch: Partial<Pick<HomeworkRecord, "status" | "data">> }
  | { op: "listRecordsByParticipant"; participantId: string }
  | { op: "appendEntry"; homeworkRecordId: string; entryType: string; data: Record<string, unknown> }
  | { op: "listEntries"; homeworkRecordId: string; entryType?: string }
  | { op: "updateEntry"; id: string; patch: Partial<Pick<HomeworkEntryRecord, "data">> };

export const HOMEWORK_STORE_ENDPOINT = "/api/homework/store";
