import type { HomeworkEntryRecord, HomeworkRecord } from "@/types/homework";
import type { HomeworkStoreOp } from "@/shared/runtime/homework-store-ops";

// Minimal in-memory stand-in for src/lib/server/homework-store.ts, mirroring
// the same pattern as worksheet-store.fake.ts / safety-store.fake.ts.

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const recordsBySessionId = new Map<string, HomeworkRecord>();
const recordsById = new Map<string, HomeworkRecord>();
const entriesByRecordId = new Map<string, HomeworkEntryRecord[]>();

export function resetFakeHomeworkStore() {
  recordsBySessionId.clear();
  recordsById.clear();
  entriesByRecordId.clear();
}

export async function dispatchFakeHomeworkStoreOp(op: HomeworkStoreOp): Promise<unknown> {
  switch (op.op) {
    case "ensureRecord": {
      const existing = recordsBySessionId.get(op.runtimeSessionId);
      if (existing) return existing;
      const now = new Date().toISOString();
      const record: HomeworkRecord = {
        id: makeId("HWR"),
        runtimeSessionId: op.runtimeSessionId,
        sessionDefinitionId: op.sessionDefinitionId,
        participantId: op.participantId,
        status: op.initialStatus,
        updatedAt: now,
        createdAt: now,
        data: op.initialData ?? {},
      };
      recordsBySessionId.set(op.runtimeSessionId, record);
      recordsById.set(record.id, record);
      return record;
    }
    case "getRecord": return recordsBySessionId.get(op.runtimeSessionId);
    case "getRecordById": return recordsById.get(op.id);
    case "updateRecord": {
      const current = recordsById.get(op.id);
      if (!current) throw new Error(`Homework record not found: ${op.id}`);
      const next: HomeworkRecord = { ...current, status: op.patch.status ?? current.status, data: op.patch.data ?? current.data, updatedAt: new Date().toISOString() };
      recordsById.set(op.id, next);
      recordsBySessionId.set(next.runtimeSessionId, next);
      return next;
    }
    case "listRecordsByParticipant": return [...recordsById.values()].filter((record) => record.participantId === op.participantId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    case "appendEntry": {
      const now = new Date().toISOString();
      const record: HomeworkEntryRecord = { id: makeId("HWE"), homeworkRecordId: op.homeworkRecordId, entryType: op.entryType, createdAt: now, data: op.data };
      const list = entriesByRecordId.get(op.homeworkRecordId) ?? [];
      list.push(record);
      entriesByRecordId.set(op.homeworkRecordId, list);
      return record;
    }
    case "listEntries": {
      const list = entriesByRecordId.get(op.homeworkRecordId) ?? [];
      return op.entryType ? list.filter((entry) => entry.entryType === op.entryType) : list;
    }
    case "updateEntry": {
      for (const [recordId, list] of entriesByRecordId) {
        const index = list.findIndex((entry) => entry.id === op.id);
        if (index !== -1) {
          const next: HomeworkEntryRecord = { ...list[index], data: op.patch.data ?? list[index].data };
          list[index] = next;
          entriesByRecordId.set(recordId, list);
          return next;
        }
      }
      throw new Error(`Homework entry not found: ${op.id}`);
    }
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown homework store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
