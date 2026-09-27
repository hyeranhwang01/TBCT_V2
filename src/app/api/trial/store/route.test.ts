import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrialStoreOp } from "@/shared/trial/trial-store-ops";

// The trial store route is the authorization boundary (it runs with the
// full-access DATABASE_URL): who may run which op, a patient only on their
// own data, the blinded assessor never near arms, and the actor always taken
// from the session, never from the request.

type Role = "patient" | "clinician" | "admin" | "assessor" | "coordinator";
const caller = vi.hoisted(() => ({ current: null as null | { userId: string; email: string | null; role: Role } }));
const dispatched = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const accessLog = vi.hoisted(() => [] as unknown[]);

vi.mock("@/shared/supabase/server", () => ({ getStaffCaller: async () => caller.current }));
vi.mock("@/shared/data/server/runtime-request-context", () => ({}));
vi.mock("@/shared/data/server/trial-store", () => ({
  dispatchTrialStoreOp: async (op: Record<string, unknown>) => {
    dispatched.push(JSON.parse(JSON.stringify(op)));
    return { ok: true };
  },
}));
vi.mock("@/shared/data/server/trial/events-store", () => ({ logAccess: async (...args: unknown[]) => void accessLog.push(args) }));
vi.mock("@/shared/data/server/participant-store", () => ({
  getParticipantByAuthUserId: async (authUserId: string) => (authUserId === "user-1" ? { id: "P-1" } : authUserId === "user-2" ? { id: "P-2" } : undefined),
}));
vi.mock("@/shared/data/server/runtime-session-store", () => ({
  getRuntimeSessionRecord: async (id: string) => (id === "RS-own" ? { id, participantId: "P-1" } : id === "RS-other" ? { id, participantId: "P-2" } : undefined),
}));

import { POST } from "@/app/api/trial/store/route";

async function call(op: TrialStoreOp) {
  const response = await POST(new Request("http://test/api/trial/store", { method: "POST", body: JSON.stringify(op) }));
  return response.status;
}

function as(role: Role, userId = `${role}-1`) {
  caller.current = { userId, email: null, role };
}

beforeEach(() => {
  dispatched.length = 0;
  accessLog.length = 0;
  caller.current = null;
});

describe("/api/trial/store", () => {
  it("refuses anyone not signed in", async () => {
    expect(await call({ op: "getMyTrialStatus" })).toBe(401);
  });

  it("never lets a request choose its actor", async () => {
    as("coordinator");
    await call({ op: "enrollParticipant", studyParticipantId: "SP-1", actor: { userId: "admin-1", role: "admin" } });
    expect(dispatched[0].actor).toEqual({ userId: "coordinator-1", role: "coordinator" });
  });

  it("keeps server-only ops away from every role", async () => {
    for (const role of ["patient", "clinician", "admin", "assessor", "coordinator"] as const) {
      as(role);
      expect(await call({ op: "recordEvents", events: [] })).toBe(403);
      expect(await call({ op: "recordRecordDownload", download: { participantId: null, moduleNumber: null, attempts: "all", format: "json", recordHashes: [] } })).toBe(403);
    }
    expect(dispatched).toEqual([]);
  });

  it("gives randomization, releases and the lock to the admin only", async () => {
    for (const role of ["clinician", "coordinator", "assessor", "patient"] as const) {
      as(role);
      expect(await call({ op: "uploadRandomizationList", listVersion: "v1", csv: "" })).toBe(403);
      expect(await call({ op: "randomizationStatus" })).toBe(403);
      expect(await call({ op: "freezeAiRelease", releaseId: "R" })).toBe(403);
      expect(await call({ op: "lockStudy", reason: "x" })).toBe(403);
    }
    as("admin");
    expect(await call({ op: "randomizationStatus" })).toBe(200);
  });

  it("keeps the blinded assessor to the blinded roster and interview entry", async () => {
    as("assessor");
    expect(await call({ op: "listBlindedParticipants" })).toBe(200);
    expect(await call({ op: "listAssessmentTasks" })).toBe(200);
    expect(await call({ op: "submitAssessmentResponse", response: { taskId: "T", items: [] } })).toBe(200);
    for (const op of [
      { op: "listTrialParticipants" }, { op: "getTrialParticipant", studyParticipantId: "SP-1" }, { op: "listSessionRecords", participantId: "P-1" },
      { op: "listEvents", filter: {} }, { op: "getMonitoringSummary" }, { op: "listAdverseEvents" }, { op: "allocateParticipant", studyParticipantId: "SP-1" },
      { op: "listAssessmentResponses", studyParticipantId: "SP-1" }, { op: "getStudyContext" },
    ] as TrialStoreOp[]) {
      expect(await call(op), op.op).toBe(403);
    }
  });

  it("lets the coordinator run enrolment but not clinical safety or records", async () => {
    as("coordinator");
    expect(await call({ op: "allocateParticipant", studyParticipantId: "SP-1" })).toBe(200);
    expect(await call({ op: "createAdverseEvent", event: {} as never })).toBe(403);
    expect(await call({ op: "listSessionRecords", participantId: "P-1" })).toBe(403);
  });

  it("lets a patient reach only their own gate, session record, status, tasks and homework", async () => {
    as("patient", "user-1");
    expect(await call({ op: "getSessionGate", runtimeParticipantId: "P-1", sessionDefinitionId: "tbct-s01" })).toBe(200);
    expect(await call({ op: "getSessionGate", runtimeParticipantId: "P-2", sessionDefinitionId: "tbct-s01" })).toBe(403);
    expect(await call({ op: "finalizeSessionRecord", runtimeSessionId: "RS-own" })).toBe(200);
    expect(await call({ op: "finalizeSessionRecord", runtimeSessionId: "RS-other" })).toBe(403);
    expect(await call({ op: "getMyTrialStatus" })).toBe(200);
    expect(await call({ op: "listAssessmentTasks" })).toBe(200);
    expect(await call({ op: "listAssessmentTasks", studyParticipantId: "SP-2" })).toBe(403);
    expect(await call({ op: "logHomework", log: { week: 1, minutes: 30, completed: true } })).toBe(200);
    expect(await call({ op: "logHomework", log: { studyParticipantId: "SP-2", week: 1, minutes: 30, completed: true } })).toBe(403);
    expect(await call({ op: "listTrialParticipants" })).toBe(403);
    expect(await call({ op: "listSessionRecords", participantId: "P-1" })).toBe(403);
    expect(dispatched.every((op) => (op.actor as { role: string }).role === "patient")).toBe(true);
  });

  it("writes staff reads of clinical data to the access log", async () => {
    as("clinician");
    await call({ op: "listSessionRecords", participantId: "P-1" });
    await call({ op: "getTrialParticipant", studyParticipantId: "SP-1" });
    expect(accessLog).toEqual([
      [{ userId: "clinician-1", role: "clinician" }, { action: "listSessionRecords", resource: "session_records", participantId: "P-1" }],
      [{ userId: "clinician-1", role: "clinician" }, { action: "getTrialParticipant", resource: "trial_participant", participantId: "SP-1" }],
    ]);
  });
});
