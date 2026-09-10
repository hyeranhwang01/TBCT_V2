// Shared client/server contract for the session worksheet store (Neon
// Postgres, sql/006_worksheets.sql). Mirrors the pattern in
// runtime-store-ops.ts/safety-store-ops.ts: no server-only imports, so this
// is safe to import from both the repository client
// (src/lib/repositories/worksheet-repository.ts) and the server-side store
// implementation (src/lib/server/worksheet-store.ts).
import type {
  WorksheetCollectionItemRecord,
  WorksheetEventRecord,
  WorksheetFieldDefinitionRecord,
  WorksheetFieldRevisionRecord,
  WorksheetFieldStatus,
  WorksheetFieldValueRecord,
  WorksheetInstanceRecord,
  WorksheetTemplateVersionRecord,
} from "@/types/worksheet";

export type WorksheetStoreOp =
  | { op: "ensureTemplateVersion"; templateId: string; sessionDefinitionId: string; title: string; version: number; sourceTextHash: string; fieldDefinitions: Array<Omit<WorksheetFieldDefinitionRecord, "id" | "templateVersionId">> }
  | { op: "getTemplateVersion"; sessionDefinitionId: string; version: number }
  | { op: "listFieldDefinitions"; templateVersionId: string }
  | { op: "ensureInstance"; runtimeSessionId: string; templateVersionId: string }
  | { op: "getInstance"; runtimeSessionId: string }
  | { op: "upsertFieldValue"; instanceId: string; fieldDefinitionId: string; patch: Partial<Omit<WorksheetFieldValueRecord, "id" | "instanceId" | "fieldDefinitionId">> }
  | { op: "listFieldValues"; instanceId: string }
  | { op: "replaceCollectionItems"; fieldValueId: string; items: Array<{ value: unknown; displayValue?: string; status: WorksheetFieldStatus; provenance: WorksheetFieldValueRecord["provenance"]; sourceTurnId?: string }> }
  | { op: "listCollectionItems"; fieldValueId: string }
  | { op: "appendFieldRevision"; fieldValueId: string; status: WorksheetFieldStatus; provenance: WorksheetFieldValueRecord["provenance"]; sourceTurnId?: string; snapshot: unknown }
  | { op: "listFieldRevisions"; fieldValueId: string }
  | { op: "appendEvent"; instanceId: string; eventType: WorksheetEventRecord["eventType"]; data: Record<string, unknown> }
  | { op: "listEvents"; instanceId: string };

export const WORKSHEET_STORE_ENDPOINT = "/api/worksheets/store";

export type { WorksheetCollectionItemRecord, WorksheetEventRecord, WorksheetFieldDefinitionRecord, WorksheetFieldRevisionRecord, WorksheetFieldValueRecord, WorksheetInstanceRecord, WorksheetTemplateVersionRecord };
