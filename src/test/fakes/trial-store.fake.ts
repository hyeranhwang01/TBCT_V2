// Browser-safe (the patient dev mock installs this fake in the browser).
import { sha256Hex } from "@/test/fakes/sha256-hex";
import type { TrialStoreOp } from "@/shared/trial/trial-store-ops";
import type { RuntimeEvent, SessionGate } from "@/types/trial";
import { SESSION_RECORD_SCHEMA_VERSION, buildSessionSnapshot, canonicalJson } from "@/shared/trial/session-snapshot";
import { dispatchFakeRuntimeStoreOp, fakeMarkSessionEnded } from "@/test/fakes/runtime-session-store.fake";
import type { RuntimeSession } from "@/types/runtime-session";

// In-memory stand-in for /api/trial/store under jsdom: only the ops the
// runtime calls (events, sealed records, the session gate). The trial
// operations themselves are tested against real Postgres (src/test/pglite).
// The gate is open (no active study) unless a test sets one.

type FakeRecord = { recordId: string; runtimeSessionId: string; participantId: string; moduleNumber: number | null; attemptNumber: number | null; endStatus: string; isOfficialAtWrite: boolean; contentSha256: string; snapshot: unknown };

let events: RuntimeEvent[] = [];
let records: FakeRecord[] = [];
let gate: SessionGate = { allowed: true, enforced: false };

export function resetFakeTrialStore() {
  events = [];
  records = [];
  gate = { allowed: true, enforced: false };
}

export function fakeSetSessionGate(next: SessionGate) {
  gate = next;
}

export function fakeTrialEvents() {
  return events.map((event) => ({ ...event }));
}

export function fakeSessionRecords() {
  return records.map((record) => ({ ...record }));
}

async function finalize(runtimeSessionId: string) {
  const session = (await dispatchFakeRuntimeStoreOp({ op: "getSession", sessionId: runtimeSessionId } as never)) as RuntimeSession | undefined;
  if (!session) throw new Error("Runtime session not found");
  if (session.status !== "completed" && session.status !== "terminated") throw new Error(`Session has not ended (${session.status})`);
  const existing = records.find((record) => record.runtimeSessionId === runtimeSessionId);
  if (existing) return { recordId: existing.recordId, inserted: false, isOfficial: existing.isOfficialAtWrite };
  const marked = fakeMarkSessionEnded(runtimeSessionId);
  const snapshot = await buildSessionSnapshot(runtimeSessionId, { events: events.filter((event) => event.runtimeSessionId === runtimeSessionId) });
  const contentSha256 = sha256Hex(canonicalJson(snapshot));
  const record: FakeRecord = {
    recordId: `REC-${records.length + 1}`, runtimeSessionId, participantId: session.participantId, moduleNumber: marked.moduleNumber ?? null, attemptNumber: marked.attemptNumber ?? null,
    endStatus: session.status, isOfficialAtWrite: marked.isOfficial ?? false, contentSha256, snapshot: { ...snapshot, schemaVersion: SESSION_RECORD_SCHEMA_VERSION },
  };
  records.push(record);
  return { recordId: record.recordId, inserted: true, isOfficial: record.isOfficialAtWrite, contentSha256 };
}

export async function dispatchFakeTrialStoreOp(op: TrialStoreOp): Promise<unknown> {
  switch (op.op) {
    case "recordEvents": {
      for (const event of op.events) if (!events.some((existing) => existing.id === event.id)) events.push({ ...event });
      return undefined;
    }
    case "listEvents":
      return events.filter((event) => (!op.filter.runtimeSessionId || event.runtimeSessionId === op.filter.runtimeSessionId) && (!op.filter.code || event.code === op.filter.code));
    case "finalizeSessionRecord":
      return finalize(op.runtimeSessionId);
    case "listSessionRecords":
      return records.filter((record) => record.participantId === op.participantId);
    case "getSessionGate":
      return gate;
    default:
      throw new Error(`The fake trial store does not implement ${op.op}; test it against PGlite`);
  }
}
