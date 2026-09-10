// Shared client/server contract for the clinician-visible participant
// roster + longitudinal memory (clinician notes) store (Neon Postgres).
// Mirrors the pattern in safety-store-ops.ts: no server-only imports, so
// this is safe to import from both the browser-facing repository client
// (participant-repository.ts / longitudinal-memory-repository.ts) and the
// server-side store implementation (participant-store.ts).
import type { LongitudinalMemory, RuntimeParticipant } from "@/types/longitudinal-memory";

export type ParticipantStoreOp =
  | { op: "listParticipants" }
  | { op: "getParticipant"; participantId: string }
  | { op: "getParticipantByAuthUserId"; authUserId: string }
  | { op: "saveParticipant"; participant: RuntimeParticipant }
  | { op: "updateParticipant"; participantId: string; patch: Partial<RuntimeParticipant> }
  | { op: "listMemories"; participantId: string }
  | { op: "getMemory"; memoryId: string }
  | { op: "saveMemory"; memory: LongitudinalMemory }
  | { op: "updateMemory"; memoryId: string; patch: Partial<LongitudinalMemory> };

export const PARTICIPANT_STORE_ENDPOINT = "/api/participants/store";
