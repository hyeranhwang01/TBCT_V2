// @vitest-environment node
// The SQL behind the operational scripts, on Postgres: the de-identified
// extract (scripts/export-deidentified.ts) and the retention erasure
// (scripts/purge-retention.ts). .claude/TASK_SCOPE.json note2026_09_28_rct_backend.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/shared/data/db/pg-pool", () => ({ getPgPool: () => db.pool }));

import "@/shared/data/server/runtime-request-context";
import { createTestDatabase, type TestPool } from "@/test/pglite/pglite-db";
import { dispatchTrialStoreOp } from "@/shared/data/server/trial-store";
import { saveParticipant } from "@/shared/data/server/participant-store";
import { createRuntimeSessionRecord, saveRuntimeMessage, updateRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";
import { SCREENING_CRITERIA, defaultStudyConfig } from "@/shared/trial/default-study-config";
import { CANONICAL_PROTOCOL_ID } from "@/shared/protocol/source-fidelity-catalog";
import type { TrialStoreOp } from "@/shared/trial/trial-store-ops";
import type { Allocation, StudyParticipant } from "@/types/trial";
import { EXTRACT_QUERIES, eraseStudyAiData, findExpiredStudies } from "../../../scripts/lib/trial-extract";

const coordinator = { userId: "coord-1", role: "coordinator" as const };
function call<T>(op: TrialStoreOp): Promise<T> {
  return dispatchTrialStoreOp({ actor: { userId: "admin-1", role: "admin" }, ...op }) as Promise<T>;
}
const pool = () => db.pool as TestPool;

let counter = 0;
/** An allocated participant with one completed, sealed AI session. */
async function participantWithSession() {
  counter += 1;
  const now = new Date().toISOString();
  const runtimeParticipantId = `RP-${counter}`;
  await saveParticipant({ id: runtimeParticipantId, projectId: "tbct", alias: `P${counter}`, locale: "ko", status: "active", runtimeSessionIds: [], longitudinalRecordId: `L-${counter}`, authUserId: randomUUID(), createdAt: now, updatedAt: now } as never);
  const sp = await call<StudyParticipant>({ op: "registerParticipant", participant: { runtimeParticipantId, siteId: "TBCT-RCT-KR-KR", studyCode: `TBCT-KR-${String(counter).padStart(3, "0")}`, diagnosisStratum: "MDD" }, actor: coordinator });
  await call({ op: "recordScreening", screening: { studyParticipantId: sp.id, criteria: SCREENING_CRITERIA.map((criterion) => ({ code: criterion.code, met: true })) } as never, actor: coordinator });
  await call({ op: "decideEligibility", studyParticipantId: sp.id, decision: "eligible", reasons: [], actor: coordinator });
  await call({ op: "recordConsent", consent: { studyParticipantId: sp.id, consentType: "main", version: "1", status: "granted", method: "written" }, actor: coordinator });
  await call({ op: "recordConsent", consent: { studyParticipantId: sp.id, consentType: "ai_interaction_logging", version: "1", status: "granted", method: "written" }, actor: coordinator });
  await call({ op: "enrollParticipant", studyParticipantId: sp.id, actor: coordinator });
  const allocation = await call<Allocation>({ op: "allocateParticipant", studyParticipantId: sp.id, actor: coordinator });
  const sessionId = `RS-${counter}`;
  await createRuntimeSessionRecord({
    id: sessionId, projectId: "tbct", protocolId: CANONICAL_PROTOCOL_ID, protocolVersion: "1", releaseId: "demo-release", sessionDefinitionId: "tbct-s01", participantId: runtimeParticipantId, status: "active",
    patientAlias: "P", locale: "ko", runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {} }, messageIds: [], executionLogIds: [], escalationIds: [], createdAt: now, updatedAt: now,
  } as never);
  await saveRuntimeMessage({ id: `M-${counter}`, runtimeSessionId: sessionId, role: "patient", content: "제 이름은 홍길동이에요", status: "delivered", createdAt: now } as never);
  await updateRuntimeSessionRecord(sessionId, { status: "completed", completedAt: now } as never);
  await call({ op: "finalizeSessionRecord", runtimeSessionId: sessionId });
  return { runtimeParticipantId, studyParticipantId: sp.id, studyCode: sp.studyCode, arm: allocation.armCode, sessionId };
}

beforeAll(async () => {
  db.pool = (await createTestDatabase()).pool;
  await call({ op: "configureStudy", config: defaultStudyConfig("KR", "active") });
  const release = await call<{ id: string }>({ op: "createAiRelease", release: { label: "R1", modelId: "claude-opus-5-5" } });
  await call({ op: "freezeAiRelease", releaseId: release.id });
  const rows = Array.from({ length: 12 }, (_, index) => `KR|MDD,${index + 1},${["CLINICIAN_ONLY", "AI_CLINICIAN", "AI_LED"][index % 3]}`);
  await call({ op: "uploadRandomizationList", listVersion: "v1", csv: ["stratum,sequence,arm", ...rows].join("\n") });
}, 120_000);

describe("de-identified extract", () => {
  it("runs every query, keys rows by study code only and leaves free text and excluded participants out", async () => {
    const kept = await participantWithSession();
    const excluded = await participantWithSession();
    await call({ op: "withdrawParticipant", withdrawal: { studyParticipantId: excluded.studyParticipantId, reasonCategory: "participant_choice", initiatedBy: "participant", dataDisposition: "exclude_from_analysis" } });
    const output: Record<string, Array<Record<string, unknown>>> = {};
    for (const [name, sql] of Object.entries(EXTRACT_QUERIES)) output[name] = (await pool().query(sql)).rows;

    expect(output.participants.map((row) => row.study_code)).toEqual([kept.studyCode]);
    expect(output.participants[0]).toMatchObject({ site_code: "KR", diagnosis_stratum: "MDD", arm_code: kept.arm, allocated_day: 0 });
    expect(output.ai_sessions).toEqual([expect.objectContaining({ study_code: kept.studyCode, module_number: 1, official: true, end_status: "completed", participant_turns: 1, steps_total: 11 })]);
    expect(output.visits.length).toBeGreaterThan(0);
    const all = JSON.stringify(output);
    expect(all).not.toContain(kept.runtimeParticipantId);
    expect(all).not.toContain("홍길동");
    expect(all).not.toContain(excluded.studyCode);
  });
});

describe("retention erasure", () => {
  it("finds a study past retention from its lock, and erases AI data except for extended-retention consent", async () => {
    const erased = await participantWithSession();
    const extended = await participantWithSession();
    await call({ op: "recordConsent", consent: { studyParticipantId: extended.studyParticipantId, consentType: "extended_retention", version: "1", status: "granted", method: "written" }, actor: coordinator });
    expect(await findExpiredStudies(pool())).toEqual([]);

    await pool().query("INSERT INTO study_locks (study_id, locked_at, locked_by, reason) VALUES ('TBCT-RCT-KR', now() - interval '6 years', 'test', 'final lock')");
    const [study] = await findExpiredStudies(pool());
    expect(study.code).toBe("TBCT-RCT-KR");
    expect(study.participants).toContain(erased.runtimeParticipantId);
    expect(study.participants).not.toContain(extended.runtimeParticipantId);
    expect(study.sessionTables).toEqual(expect.arrayContaining(["runtime_messages", "session_records"]));
    expect(study.sessionTables).not.toContain("study_visits");

    // The lock and append-only triggers refuse an ordinary delete.
    await expect(pool().query("DELETE FROM runtime_messages WHERE runtime_session_id = $1", [erased.sessionId])).rejects.toThrow();
    const counts = await eraseStudyAiData(pool() as never, study);
    expect(counts.runtime_messages).toBeGreaterThan(0);
    expect(counts.runtime_sessions).toBeGreaterThan(0);

    const left = async (sql: string, params: unknown[]) => Number((await pool().query<{ n: number }>(sql, params)).rows[0].n);
    expect(await left("SELECT count(*)::int AS n FROM runtime_messages WHERE runtime_session_id = $1", [erased.sessionId])).toBe(0);
    expect(await left("SELECT count(*)::int AS n FROM session_records WHERE participant_id = $1", [erased.runtimeParticipantId])).toBe(0);
    expect(await left("SELECT count(*)::int AS n FROM runtime_messages WHERE runtime_session_id = $1", [extended.sessionId])).toBe(1);
    // The trial record stays.
    expect(await left("SELECT count(*)::int AS n FROM allocations WHERE study_participant_id = $1", [erased.studyParticipantId])).toBe(1);
    expect(await left("SELECT count(*)::int AS n FROM study_visits WHERE study_participant_id = $1", [erased.studyParticipantId])).toBeGreaterThan(0);
  });
});
