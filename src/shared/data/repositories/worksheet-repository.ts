import { WORKSHEET_STORE_ENDPOINT } from "@/shared/runtime/worksheet-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";
import type { WorksheetStoreOp } from "@/shared/runtime/worksheet-store-ops";
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

// Thin fetch client over src/app/api/worksheets/store/route.ts, matching
// the pattern of runtime-session-repository.ts / participant-repository.ts.
async function callStore<T>(op: WorksheetStoreOp): Promise<T> {
  const response = await runtimeFetch(resolveStoreUrl(WORKSHEET_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Worksheet store operation failed.");
  return body.result as T;
}

export async function ensureWorksheetTemplateVersion(input: { templateId: string; sessionDefinitionId: string; title: string; version: number; sourceTextHash: string; fieldDefinitions: Array<Omit<WorksheetFieldDefinitionRecord, "id" | "templateVersionId">> }) {
  return callStore<WorksheetTemplateVersionRecord>({ op: "ensureTemplateVersion", ...input });
}

export async function getWorksheetTemplateVersion(sessionDefinitionId: string, version: number) {
  return callStore<WorksheetTemplateVersionRecord | undefined>({ op: "getTemplateVersion", sessionDefinitionId, version });
}

export async function listWorksheetFieldDefinitions(templateVersionId: string) {
  return callStore<WorksheetFieldDefinitionRecord[]>({ op: "listFieldDefinitions", templateVersionId });
}

export async function ensureWorksheetInstance(runtimeSessionId: string, templateVersionId: string) {
  return callStore<WorksheetInstanceRecord>({ op: "ensureInstance", runtimeSessionId, templateVersionId });
}

export async function getWorksheetInstance(runtimeSessionId: string) {
  return callStore<WorksheetInstanceRecord | undefined>({ op: "getInstance", runtimeSessionId });
}

export async function upsertWorksheetFieldValue(instanceId: string, fieldDefinitionId: string, patch: Partial<Omit<WorksheetFieldValueRecord, "id" | "instanceId" | "fieldDefinitionId">>) {
  return callStore<WorksheetFieldValueRecord>({ op: "upsertFieldValue", instanceId, fieldDefinitionId, patch });
}

export async function listWorksheetFieldValues(instanceId: string) {
  return callStore<WorksheetFieldValueRecord[]>({ op: "listFieldValues", instanceId });
}

export async function replaceWorksheetCollectionItems(fieldValueId: string, items: Array<{ value: unknown; displayValue?: string; status: WorksheetFieldStatus; provenance: WorksheetFieldValueRecord["provenance"]; sourceTurnId?: string }>) {
  await callStore<void>({ op: "replaceCollectionItems", fieldValueId, items });
}

export async function listWorksheetCollectionItems(fieldValueId: string) {
  return callStore<WorksheetCollectionItemRecord[]>({ op: "listCollectionItems", fieldValueId });
}

export async function appendWorksheetFieldRevision(input: { fieldValueId: string; status: WorksheetFieldStatus; provenance: WorksheetFieldValueRecord["provenance"]; sourceTurnId?: string; snapshot: unknown }) {
  return callStore<WorksheetFieldRevisionRecord>({ op: "appendFieldRevision", ...input });
}

export async function listWorksheetFieldRevisions(fieldValueId: string) {
  return callStore<WorksheetFieldRevisionRecord[]>({ op: "listFieldRevisions", fieldValueId });
}

export async function appendWorksheetEvent(instanceId: string, eventType: WorksheetEventRecord["eventType"], data: Record<string, unknown>) {
  return callStore<WorksheetEventRecord>({ op: "appendEvent", instanceId, eventType, data });
}

export async function listWorksheetEvents(instanceId: string) {
  return callStore<WorksheetEventRecord[]>({ op: "listEvents", instanceId });
}
