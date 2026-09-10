import type { LongitudinalMemory, RuntimeParticipant } from "@/types/longitudinal-memory";
import type { ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";

// Minimal in-memory stand-in for src/shared/data/server/participant-store.ts, used
// only so offline tests that touch the participant roster (e.g. session
// creation resolving/creating a demo participant) don't fail on a relative
// fetch() URL. Not a full behavioral mirror -- just enough CRUD to keep the
// runtime pipeline's participant lookups working.

const participants = new Map<string, RuntimeParticipant>();
const memories = new Map<string, LongitudinalMemory>();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function resetFakeParticipantStore() {
  participants.clear();
  memories.clear();
}

export async function dispatchFakeParticipantStoreOp(op: ParticipantStoreOp): Promise<unknown> {
  switch (op.op) {
    case "listParticipants": return [...participants.values()].map(clone);
    case "getParticipant": return participants.has(op.participantId) ? clone(participants.get(op.participantId)) : undefined;
    case "getParticipantByAuthUserId": {
      const match = [...participants.values()].find((participant) => participant.authUserId === op.authUserId);
      return match ? clone(match) : undefined;
    }
    case "saveParticipant": participants.set(op.participant.id, clone(op.participant)); return op.participant;
    case "updateParticipant": {
      const current = participants.get(op.participantId);
      if (!current) throw new Error("Participant not found");
      const next = { ...current, ...op.patch };
      participants.set(op.participantId, clone(next));
      return next;
    }
    case "listMemories": return [...memories.values()].filter((memory) => memory.participantId === op.participantId).map(clone);
    case "getMemory": return memories.has(op.memoryId) ? clone(memories.get(op.memoryId)) : undefined;
    case "saveMemory": memories.set(op.memory.id, clone(op.memory)); return op.memory;
    case "updateMemory": {
      const current = memories.get(op.memoryId);
      if (!current) throw new Error("Memory not found");
      const next = { ...current, ...op.patch };
      memories.set(op.memoryId, clone(next));
      return next;
    }
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown participant store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
