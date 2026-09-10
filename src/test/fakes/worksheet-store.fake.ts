import type {
  WorksheetCollectionItemRecord,
  WorksheetEventRecord,
  WorksheetFieldDefinitionRecord,
  WorksheetFieldRevisionRecord,
  WorksheetFieldValueRecord,
  WorksheetInstanceRecord,
  WorksheetTemplateVersionRecord,
} from "@/types/worksheet";
import type { WorksheetStoreOp } from "@/shared/runtime/worksheet-store-ops";

// Minimal in-memory stand-in for src/lib/server/worksheet-store.ts, mirroring
// the same pattern as safety-store.fake.ts / participant-store.fake.ts /
// protocol-studio-store.fake.ts. Discovered missing only when the
// dialogue-agent stale-worksheet-value test first exercised
// editWorksheetField in a test environment -- worksheet-projection.ts had
// never been called from a test before this.

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const templatesByKey = new Map<string, WorksheetTemplateVersionRecord>(); // key: `${sessionDefinitionId}:${version}`
const fieldDefinitionsByTemplateVersion = new Map<string, WorksheetFieldDefinitionRecord[]>();
const instancesByRuntimeSessionId = new Map<string, WorksheetInstanceRecord>();
const fieldValuesByInstance = new Map<string, Map<string, WorksheetFieldValueRecord>>(); // instanceId -> fieldDefinitionId -> value
const collectionItemsByFieldValue = new Map<string, WorksheetCollectionItemRecord[]>();
const revisionsByFieldValue = new Map<string, WorksheetFieldRevisionRecord[]>();
const eventsByInstance = new Map<string, WorksheetEventRecord[]>();

export function resetFakeWorksheetStore() {
  templatesByKey.clear();
  fieldDefinitionsByTemplateVersion.clear();
  instancesByRuntimeSessionId.clear();
  fieldValuesByInstance.clear();
  collectionItemsByFieldValue.clear();
  revisionsByFieldValue.clear();
  eventsByInstance.clear();
}

export async function dispatchFakeWorksheetStoreOp(op: WorksheetStoreOp): Promise<unknown> {
  switch (op.op) {
    case "ensureTemplateVersion": {
      const key = `${op.sessionDefinitionId}:${op.version}`;
      const existing = templatesByKey.get(key);
      let record: WorksheetTemplateVersionRecord;
      if (existing) {
        record = existing;
      } else {
        const now = new Date().toISOString();
        record = { id: makeId("WKTV"), templateId: op.templateId, version: op.version, sourceTextHash: op.sourceTextHash, status: "published", createdAt: now };
        templatesByKey.set(key, record);
        fieldDefinitionsByTemplateVersion.set(record.id, []);
      }
      // Mirrors src/lib/server/worksheet-store.ts's own backfill: a field
      // added to this session's bindings after the template version already
      // existed still needs a definition row, on every call, not only the
      // first one -- see that file's comment for the production bug this
      // fixes.
      const current = fieldDefinitionsByTemplateVersion.get(record.id) ?? [];
      const existingKeySet = new Set(current.map((definition) => definition.worksheetFieldKey));
      const additions = op.fieldDefinitions
        .filter((definition) => !existingKeySet.has(definition.worksheetFieldKey))
        .map((definition, index) => ({ ...definition, id: makeId("WKFD"), templateVersionId: record.id, displayOrder: definition.displayOrder ?? current.length + index }));
      if (additions.length) fieldDefinitionsByTemplateVersion.set(record.id, [...current, ...additions]);
      return record;
    }
    case "getTemplateVersion": return templatesByKey.get(`${op.sessionDefinitionId}:${op.version}`);
    case "listFieldDefinitions": return [...(fieldDefinitionsByTemplateVersion.get(op.templateVersionId) ?? [])].sort((left, right) => left.displayOrder - right.displayOrder);
    case "ensureInstance": {
      const existing = instancesByRuntimeSessionId.get(op.runtimeSessionId);
      if (existing) return existing;
      const now = new Date().toISOString();
      const record: WorksheetInstanceRecord = { id: makeId("WKST"), runtimeSessionId: op.runtimeSessionId, templateVersionId: op.templateVersionId, status: "in_progress", createdAt: now, updatedAt: now };
      instancesByRuntimeSessionId.set(op.runtimeSessionId, record);
      return record;
    }
    case "getInstance": return instancesByRuntimeSessionId.get(op.runtimeSessionId);
    case "upsertFieldValue": {
      const values = fieldValuesByInstance.get(op.instanceId) ?? new Map<string, WorksheetFieldValueRecord>();
      const current = values.get(op.fieldDefinitionId);
      const now = new Date().toISOString();
      const next: WorksheetFieldValueRecord = {
        id: current?.id ?? makeId("WKFV"),
        instanceId: op.instanceId,
        fieldDefinitionId: op.fieldDefinitionId,
        status: op.patch.status ?? current?.status ?? "empty",
        provenance: op.patch.provenance ?? current?.provenance ?? "unconfirmed_extraction",
        confidence: op.patch.confidence ?? current?.confidence,
        sourceTurnId: op.patch.sourceTurnId ?? current?.sourceTurnId,
        confirmedAt: op.patch.confirmedAt ?? current?.confirmedAt,
        updatedAt: now,
        value: "value" in op.patch ? op.patch.value : current?.value,
        displayValue: op.patch.displayValue ?? current?.displayValue,
        participantVerbatim: op.patch.participantVerbatim ?? current?.participantVerbatim,
      };
      values.set(op.fieldDefinitionId, next);
      fieldValuesByInstance.set(op.instanceId, values);
      return next;
    }
    case "listFieldValues": return [...(fieldValuesByInstance.get(op.instanceId)?.values() ?? [])];
    case "replaceCollectionItems": {
      const now = new Date().toISOString();
      collectionItemsByFieldValue.set(op.fieldValueId, op.items.map((item, position) => ({ id: makeId("WKCI"), fieldValueId: op.fieldValueId, position, status: item.status, provenance: item.provenance, sourceTurnId: item.sourceTurnId, createdAt: now, value: item.value, displayValue: item.displayValue })));
      return undefined;
    }
    case "listCollectionItems": return [...(collectionItemsByFieldValue.get(op.fieldValueId) ?? [])].sort((left, right) => left.position - right.position);
    case "appendFieldRevision": {
      const record: WorksheetFieldRevisionRecord = { id: makeId("WKFR"), fieldValueId: op.fieldValueId, status: op.status, provenance: op.provenance, sourceTurnId: op.sourceTurnId, createdAt: new Date().toISOString(), snapshot: op.snapshot };
      const list = revisionsByFieldValue.get(op.fieldValueId) ?? [];
      list.push(record);
      revisionsByFieldValue.set(op.fieldValueId, list);
      return record;
    }
    case "listFieldRevisions": return [...(revisionsByFieldValue.get(op.fieldValueId) ?? [])];
    case "appendEvent": {
      const record: WorksheetEventRecord = { id: makeId("WKEV"), instanceId: op.instanceId, eventType: op.eventType, createdAt: new Date().toISOString(), data: op.data };
      const list = eventsByInstance.get(op.instanceId) ?? [];
      list.push(record);
      eventsByInstance.set(op.instanceId, list);
      return record;
    }
    case "listEvents": return [...(eventsByInstance.get(op.instanceId) ?? [])];
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown worksheet store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
