import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParticipantStoreOp } from "@/shared/runtime/participant-store-ops";
import type { RuntimeParticipant } from "@/types/longitudinal-memory";

// The route is the authorization boundary for the participant store (it runs
// with the full-access DATABASE_URL), so the memory-consent rules are tested
// here: a patient records only their own answer, never as "clinician", never
// by patching the participant directly, and the recorded actor always comes
// from the session.

const caller = vi.hoisted(() => ({ current: null as null | { userId: string; email: string | null; role: "patient" | "clinician" | "admin" | null } }));
const dispatched = vi.hoisted(() => [] as unknown[]);
const participants = vi.hoisted(() => new Map<string, RuntimeParticipant>());

vi.mock("@/shared/supabase/server", () => ({ getAuthenticatedCaller: async () => caller.current }));
vi.mock("@/shared/data/server/runtime-session-store", () => ({ getRuntimeSessionRecord: async () => undefined }));
vi.mock("@/shared/data/server/participant-store", () => ({
  dispatchParticipantStoreOp: async (op: unknown) => {
    dispatched.push(JSON.parse(JSON.stringify(op)));
    return null;
  },
  getMemory: async () => undefined,
  getParticipant: async (id: string) => participants.get(id),
  getParticipantByAuthUserId: async (authUserId: string) => [...participants.values()].find((item) => item.authUserId === authUserId),
}));

import { POST } from "@/app/api/participants/store/route";

function participant(id: string, authUserId: string, extra: Partial<RuntimeParticipant> = {}): RuntimeParticipant {
  const now = "2026-09-27T00:00:00.000Z";
  return { id, projectId: "P", alias: id, locale: "ko-KR", status: "active", runtimeSessionIds: [], longitudinalRecordId: `L-${id}`, authUserId, consent: { memoryStorageAllowed: true, crossSessionUseAllowed: false, sensitiveMemoryAllowed: false, updatedAt: now }, createdAt: now, updatedAt: now, ...extra };
}

async function call(op: ParticipantStoreOp) {
  const response = await POST(new Request("http://test/api/participants/store", { method: "POST", body: JSON.stringify(op) }));
  return response.status;
}

const consentOp = (participantId: string, extra: Partial<Extract<ParticipantStoreOp, { op: "recordMemoryConsent" }>> = {}): ParticipantStoreOp => ({
  op: "recordMemoryConsent",
  participantId,
  decision: "granted",
  textVersion: "1.0.0",
  source: "first_visit_dialog",
  locale: "ko",
  ...extra,
});

beforeEach(() => {
  dispatched.length = 0;
  participants.clear();
  participants.set("PT-own", participant("PT-own", "user-own"));
  participants.set("PT-other", participant("PT-other", "user-other"));
  caller.current = { userId: "user-own", email: null, role: "patient" };
});

describe("memory consent through the participant store route", () => {
  it("lets a patient record their own answer, with the actor taken from the session", async () => {
    expect(await call(consentOp("PT-own", { actor: { actorUserId: "someone-else", actorRole: "clinician" } }))).toBe(200);
    expect(dispatched).toEqual([expect.objectContaining({ op: "recordMemoryConsent", participantId: "PT-own", actor: { actorUserId: "user-own", actorRole: "patient" } })]);
  });

  it("refuses a patient recording an answer for someone else, or as a clinician", async () => {
    expect(await call(consentOp("PT-other"))).toBe(403);
    expect(await call(consentOp("PT-own", { source: "clinician" }))).toBe(403);
    expect(dispatched).toEqual([]);
  });

  it("refuses a patient changing memoryConsent any other way", async () => {
    expect(await call({ op: "updateParticipant", participantId: "PT-own", patch: { memoryConsent: { decision: "granted", textVersion: "1.0.0", source: "profile", decidedAt: "x" } } })).toBe(403);
    const withConsent = participant("PT-own", "user-own", { memoryConsent: { decision: "granted", textVersion: "1.0.0", source: "profile", decidedAt: "x" } });
    expect(await call({ op: "saveParticipant", participant: withConsent })).toBe(403);
    expect(dispatched).toEqual([]);
    // Saving the record back unchanged (other profile fields) still works.
    expect(await call({ op: "saveParticipant", participant: participant("PT-own", "user-own", { alias: "renamed" }) })).toBe(200);
  });

  it("lets a patient read only their own consent history", async () => {
    expect(await call({ op: "listMemoryConsentEvents", participantId: "PT-own" })).toBe(200);
    expect(await call({ op: "listMemoryConsentEvents", participantId: "PT-other" })).toBe(403);
  });

  it("lets a clinician record an answer on a participant's behalf, recorded as the clinician", async () => {
    caller.current = { userId: "clin-1", email: null, role: "clinician" };
    expect(await call(consentOp("PT-other", { source: "clinician" }))).toBe(200);
    expect(dispatched).toEqual([expect.objectContaining({ participantId: "PT-other", source: "clinician", actor: { actorUserId: "clin-1", actorRole: "clinician" } })]);
  });

  it("keeps every memory-chunk operation away from a patient, and records the clinician who suppresses one", async () => {
    for (const op of [
      { op: "listMemoryChunks", participantId: "PT-own" },
      { op: "listMemoryChunksBySession", runtimeSessionId: "RS-own" },
      { op: "saveMemoryChunks", chunks: [] },
      { op: "suppressMemoryChunk", chunkId: "MCH-1", reason: "x" },
    ] as ParticipantStoreOp[]) {
      expect(await call(op)).toBe(403);
    }
    expect(dispatched).toEqual([]);
    caller.current = { userId: "clin-1", email: null, role: "clinician" };
    expect(await call({ op: "suppressMemoryChunk", chunkId: "MCH-1", reason: "x", actorUserId: "someone-else" })).toBe(200);
    expect(dispatched).toEqual([expect.objectContaining({ op: "suppressMemoryChunk", actorUserId: "clin-1" })]);
  });
});
