// @vitest-environment node
// The trial store against real Postgres (PGlite) with every migration applied:
// lifecycle to allocation, concealed stratified allocation, the session gate,
// sealed session records, assessments and blinding, adverse events and the
// study lock. .claude/TASK_SCOPE.json note2026_09_28_rct_backend.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/shared/data/db/pg-pool", () => ({ getPgPool: () => db.pool }));

// Repositories called from server code dispatch in process (to PGlite).
import "@/shared/data/server/runtime-request-context";
import { createTestDatabase, type TestPool } from "@/test/pglite/pglite-db";
import { dispatchTrialStoreOp } from "@/shared/data/server/trial-store";
import { saveParticipant } from "@/shared/data/server/participant-store";
import { createRuntimeSessionRecord, saveRuntimeMessage, updateRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";
import { SCREENING_CRITERIA, defaultStudyConfig } from "@/shared/trial/default-study-config";
import type { TrialActor, TrialStoreOp } from "@/shared/trial/trial-store-ops";
import type { Allocation, AssessmentResponse, AssessmentTask, SessionGate, StudyParticipant } from "@/types/trial";
import type { RuntimeSession } from "@/types/runtime-session";
import { CANONICAL_PROTOCOL_ID } from "@/shared/protocol/source-fidelity-catalog";

const admin: TrialActor = { userId: "admin-1", role: "admin" };
const coordinator: TrialActor = { userId: "coord-1", role: "coordinator" };
const assessor: TrialActor = { userId: "assessor-1", role: "assessor" };
const clinician: TrialActor = { userId: "clin-1", role: "clinician" };

type OpWithoutActor = TrialStoreOp extends infer T ? (T extends unknown ? Omit<T, "actor"> : never) : never;
function call<T>(op: OpWithoutActor, actor: TrialActor = admin): Promise<T> {
  return dispatchTrialStoreOp({ ...op, actor } as TrialStoreOp) as Promise<T>;
}

function pool() {
  return db.pool as TestPool;
}

const ARMS = ["CLINICIAN_ONLY", "AI_CLINICIAN", "AI_LED"] as const;

/** Permuted blocks of 6, seeded, for one stratum. */
function blockList(stratum: string, blocks: number, seed = 7) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const lines: string[] = [];
  let sequence = 1;
  for (let block = 0; block < blocks; block += 1) {
    const arms = [...ARMS, ...ARMS];
    for (let index = arms.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [arms[index], arms[swap]] = [arms[swap], arms[index]];
    }
    for (const arm of arms) lines.push(`${stratum},${sequence++},${arm}`);
  }
  return lines;
}

let counter = 0;
async function newAppParticipant() {
  counter += 1;
  const now = new Date().toISOString();
  const authUserId = randomUUID();
  const participant = await saveParticipant({
    id: `P-${counter}`, projectId: "tbct", alias: `P${counter}`, locale: "ko", status: "active", runtimeSessionIds: [], longitudinalRecordId: `L-${counter}`,
    authUserId, createdAt: now, updatedAt: now,
  } as never);
  return { runtimeParticipantId: participant.id, authUserId };
}

const SITE_ID = "TBCT-RCT-KR-KR";

async function enrolledParticipant(stratum: "MDD" | "ANXIETY", options: { aiConsent?: boolean } = {}) {
  const app = await newAppParticipant();
  const registered = await call<StudyParticipant>({ op: "registerParticipant", participant: { runtimeParticipantId: app.runtimeParticipantId, siteId: SITE_ID, studyCode: `TBCT-KR-${String(counter).padStart(3, "0")}`, diagnosisStratum: stratum } }, coordinator);
  await call({ op: "recordScreening", screening: { studyParticipantId: registered.id, criteria: SCREENING_CRITERIA.map((criterion) => ({ code: criterion.code, met: true })), phq9Total: 14, gad7Total: 9, cssrsRisk: "low" } as never }, coordinator);
  await call({ op: "decideEligibility", studyParticipantId: registered.id, decision: "eligible", reasons: [] }, coordinator);
  await call({ op: "recordConsent", consent: { studyParticipantId: registered.id, consentType: "main", version: "ICF-1", status: "granted", method: "written" } }, coordinator);
  if (options.aiConsent !== false) await call({ op: "recordConsent", consent: { studyParticipantId: registered.id, consentType: "ai_interaction_logging", version: "AI-1", status: "granted", method: "written" } }, coordinator);
  const enrolled = await call<StudyParticipant>({ op: "enrollParticipant", studyParticipantId: registered.id }, coordinator);
  return { ...app, studyParticipantId: enrolled.id };
}

async function expectRefused(sql: string, params: unknown[], pattern: RegExp) {
  await expect(pool().query(sql, params)).rejects.toThrow(pattern);
}

function session(id: string, participantId: string, sessionDefinitionId: string): RuntimeSession {
  const now = new Date().toISOString();
  return {
    id, projectId: "tbct", protocolId: CANONICAL_PROTOCOL_ID, protocolVersion: "1", releaseId: "demo-release", sessionDefinitionId, participantId, status: "in_progress" as never,
    patientAlias: "P", locale: "ko", runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {} }, messageIds: [], executionLogIds: [], escalationIds: [], createdAt: now, updatedAt: now,
  };
}

beforeAll(async () => {
  db.pool = (await createTestDatabase()).pool;
}, 120_000);

describe("trial store on Postgres", () => {
  let releaseId = "";

  it("leaves the session gate open while no study is active", async () => {
    await expect(call<SessionGate>({ op: "getSessionGate", runtimeParticipantId: "nobody", sessionDefinitionId: "tbct-s01" })).resolves.toEqual({ allowed: true, enforced: false });
  });

  it("configures the study, freezes an AI release and loads a concealed list", async () => {
    const context = await call<{ arms: unknown[]; sites: unknown[]; timepoints: unknown[] }>({ op: "configureStudy", config: defaultStudyConfig("KR", "active") });
    expect(context.arms).toHaveLength(3);
    expect(context.sites).toHaveLength(1);
    expect(context.timepoints).toHaveLength(6);
    const release = await call<{ id: string }>({ op: "createAiRelease", release: { label: "R1", modelId: "claude-opus-5-5", promptVersions: { "tbct-s01": { version: "1.0", sha256: "aaa" } }, memoryAlgorithmVersion: "retrieval-v1", memoryIndexVersion: "chunks-v1" } });
    releaseId = release.id;
    await call({ op: "freezeAiRelease", releaseId });
    await expect(expectRefused("UPDATE ai_releases SET model_id = 'other' WHERE id = $1", [releaseId], /frozen|immutable|refus/i)).resolves.toBeUndefined();

    const csv = ["stratum,sequence,arm", ...blockList("KR|MDD", 3), ...blockList("KR|ANXIETY", 3, 11)].join("\n");
    await call({ op: "uploadRandomizationList", listVersion: "v1", csv });
    await expect(call({ op: "uploadRandomizationList", listVersion: "v1", csv })).rejects.toThrow();
    await expect(call({ op: "uploadRandomizationList", listVersion: "v2", csv: "stratum,sequence,arm\nXX|MDD,1,AI_LED" })).rejects.toThrow();
    const status = await call<unknown[]>({ op: "randomizationStatus" });
    expect(JSON.stringify(status)).not.toMatch(/CLINICIAN_ONLY|AI_CLINICIAN|AI_LED/);
    expect(status).toEqual([
      { stratum: "KR|ANXIETY", total: 18, used: 0, remaining: 18 },
      { stratum: "KR|MDD", total: 18, used: 0, remaining: 18 },
    ]);
  });

  it("refuses allocation before enrolment and without main consent", async () => {
    const app = await newAppParticipant();
    const registered = await call<StudyParticipant>({ op: "registerParticipant", participant: { runtimeParticipantId: app.runtimeParticipantId, siteId: SITE_ID, studyCode: "TBCT-KR-X01", diagnosisStratum: "MDD" } }, coordinator);
    await expect(call({ op: "allocateParticipant", studyParticipantId: registered.id }, coordinator)).rejects.toThrow();
    await call({ op: "recordScreening", screening: { studyParticipantId: registered.id, criteria: SCREENING_CRITERIA.map((criterion) => ({ code: criterion.code, met: true })) } as never }, coordinator);
    await call({ op: "decideEligibility", studyParticipantId: registered.id, decision: "eligible", reasons: [] }, coordinator);
    await expect(call({ op: "enrollParticipant", studyParticipantId: registered.id }, coordinator)).rejects.toThrow(/consent/i);
  });

  it("requires an override reason when eligibility contradicts screening, and logs a deviation", async () => {
    const app = await newAppParticipant();
    const registered = await call<StudyParticipant>({ op: "registerParticipant", participant: { runtimeParticipantId: app.runtimeParticipantId, siteId: SITE_ID, studyCode: "TBCT-KR-X02" } }, coordinator);
    await call({ op: "recordScreening", screening: { studyParticipantId: registered.id, criteria: SCREENING_CRITERIA.map((criterion) => ({ code: criterion.code, met: criterion.code !== "internet" })) } as never }, coordinator);
    await expect(call({ op: "decideEligibility", studyParticipantId: registered.id, decision: "eligible", reasons: [] }, coordinator)).rejects.toThrow();
    await call({ op: "decideEligibility", studyParticipantId: registered.id, decision: "eligible", reasons: [], overrideReason: "Connection verified on a second test" }, coordinator);
    const deviations = await call<Array<{ category: string }>>({ op: "listDeviations", studyParticipantId: registered.id });
    expect(deviations.map((deviation) => deviation.category)).toContain("eligibility");
  });

  it("allocates in list order within each stratum, builds the arm's schedule and tasks", async () => {
    const { rows: list } = await pool().query<{ sequence: number; arm_code: string }>("SELECT sequence, arm_code FROM randomization_lists WHERE stratum = 'KR|MDD' ORDER BY sequence");
    for (let index = 0; index < 6; index += 1) {
      const participant = await enrolledParticipant("MDD");
      const allocation = await call<Allocation>({ op: "allocateParticipant", studyParticipantId: participant.studyParticipantId }, coordinator);
      expect(allocation.armCode).toBe(list[index].arm_code);
      expect(allocation.stratum).toBe("KR|MDD");
      expect(allocation.aiReleaseId ?? null).toBe(allocation.armCode === "CLINICIAN_ONLY" ? null : releaseId);
      const { rows: visits } = await pool().query<{ n: number }>("SELECT count(*)::int AS n FROM study_visits WHERE study_participant_id = $1", [participant.studyParticipantId]);
      expect(visits[0].n).toBe({ CLINICIAN_ONLY: 12, AI_CLINICIAN: 24, AI_LED: 16 }[allocation.armCode]);
      const { rows: weekly } = await pool().query<{ n: number }>("SELECT count(*)::int AS n FROM assessment_tasks WHERE study_participant_id = $1 AND timepoint_code = 'weekly'", [participant.studyParticipantId]);
      expect(weekly[0].n).toBe(allocation.armCode === "AI_LED" ? 12 : 0);
    }
    // A second allocation of the same participant is refused.
    const { rows: allocated } = await pool().query<{ study_participant_id: string }>("SELECT study_participant_id FROM allocations LIMIT 1");
    await expect(call({ op: "allocateParticipant", studyParticipantId: allocated[0].study_participant_id }, coordinator)).rejects.toThrow();
  });

  it("keeps allocations, the list and history append-only", async () => {
    await expectRefused("UPDATE allocations SET arm_code = 'AI_LED'", [], /append-only|not allowed|refus/i);
    await expectRefused("DELETE FROM allocations", [], /append-only|not allowed|refus/i);
    await expectRefused("UPDATE randomization_lists SET arm_code = 'AI_LED' WHERE used_at IS NULL", [], /.+/);
    await expectRefused("DELETE FROM randomization_lists", [], /.+/);
    const { rows } = await pool().query<{ actor: string; table_name: string }>("SELECT actor, table_name FROM trial_history WHERE table_name = 'study_participants' ORDER BY id DESC LIMIT 1");
    expect(rows[0].actor).toBe("coordinator:coord-1");
    await expectRefused("DELETE FROM trial_history", [], /.+/);
  });

  it("stops at an exhausted stratum instead of allocating outside the list", async () => {
    const participants = [];
    for (let index = 0; index < 18; index += 1) participants.push(await enrolledParticipant("ANXIETY"));
    for (const participant of participants) await call({ op: "allocateParticipant", studyParticipantId: participant.studyParticipantId }, coordinator);
    const extra = await enrolledParticipant("ANXIETY");
    await expect(call({ op: "allocateParticipant", studyParticipantId: extra.studyParticipantId }, coordinator)).rejects.toThrow(/list|exhaust|no unused/i);
    const { rows } = await pool().query<{ arm_code: string; n: number }>("SELECT arm_code, count(*)::int AS n FROM allocations WHERE stratum = 'KR|ANXIETY' GROUP BY arm_code ORDER BY arm_code");
    expect(rows.map((row) => row.n)).toEqual([6, 6, 6]);
  });

  describe("session gate and sealed records", () => {
    async function participantInArm(arm: string, options: { aiConsent?: boolean } = {}) {
      for (;;) {
        const participant = await enrolledParticipant("MDD", options);
        const allocation = await call<Allocation>({ op: "allocateParticipant", studyParticipantId: participant.studyParticipantId }, coordinator);
        if (allocation.armCode === arm) return participant;
      }
    }

    it("denies a therapist-only participant, and an AI participant without AI consent", async () => {
      const therapistOnly = await participantInArm("CLINICIAN_ONLY");
      expect(await call<SessionGate>({ op: "getSessionGate", runtimeParticipantId: therapistOnly.runtimeParticipantId, sessionDefinitionId: "tbct-s01" })).toMatchObject({ allowed: false, reason: "arm_without_ai" });
      expect(await call<SessionGate>({ op: "getSessionGate", runtimeParticipantId: "not-in-study", sessionDefinitionId: "tbct-s01" })).toMatchObject({ allowed: false, reason: "not_enrolled" });
      const noConsent = await participantInArm("AI_LED", { aiConsent: false });
      const denied = await call<SessionGate>({ op: "getSessionGate", runtimeParticipantId: noConsent.runtimeParticipantId, sessionDefinitionId: "tbct-s01", recordEvent: true });
      expect(denied).toMatchObject({ allowed: false, reason: "ai_consent_missing" });
      const events = await call<Array<{ code: string }>>({ op: "listEvents", filter: { participantId: noConsent.runtimeParticipantId } });
      expect(events.map((event) => event.code)).toContain("SESSION_GATE_DENIED");
    });

    it("allows an AI-arm participant on the frozen release, and denies a prompt that differs from it", async () => {
      const participant = await participantInArm("AI_LED");
      const gate = await call<SessionGate>({ op: "getSessionGate", runtimeParticipantId: participant.runtimeParticipantId, sessionDefinitionId: "tbct-s01", currentPromptVersions: { "tbct-s01": { version: "1.0", sha256: "aaa" } } });
      expect(gate).toMatchObject({ allowed: true, enforced: true, armCode: "AI_LED", aiReleaseId: releaseId, modelId: "claude-opus-5-5", warnings: [] });
      expect(await call<SessionGate>({ op: "getSessionGate", runtimeParticipantId: participant.runtimeParticipantId, sessionDefinitionId: "tbct-s01", currentPromptVersions: { "tbct-s01": { version: "1.1", sha256: "bbb" } } })).toMatchObject({ allowed: false, reason: "prompt_differs_from_frozen_release" });
      await call({ op: "recordConsent", consent: { studyParticipantId: participant.studyParticipantId, consentType: "ai_interaction_logging", version: "AI-1", status: "withdrawn", method: "electronic" } }, coordinator);
      expect(await call<SessionGate>({ op: "getSessionGate", runtimeParticipantId: participant.runtimeParticipantId, sessionDefinitionId: "tbct-s01" })).toMatchObject({ allowed: false, reason: "ai_consent_missing" });
    });

    it("seals each ended attempt once, marks the first completed one official and completes the visit", async () => {
      const participant = await participantInArm("AI_LED");
      const first = session("RS-1", participant.runtimeParticipantId, "tbct-s01");
      await createRuntimeSessionRecord(first);
      await expect(call({ op: "finalizeSessionRecord", runtimeSessionId: "RS-1" })).rejects.toThrow(/not ended/);
      await saveRuntimeMessage({ id: "M-1", runtimeSessionId: "RS-1", role: "assistant", content: "안녕하세요", status: "delivered", createdAt: new Date().toISOString(), metadata: { step: 1 } } as never);
      await expectRefused("UPDATE runtime_messages SET data = data WHERE id = 'M-1'", [], /.+/);
      await updateRuntimeSessionRecord("RS-1", { status: "terminated" as never, terminatedAt: new Date().toISOString() });
      const terminated = await call<{ inserted: boolean; isOfficial: boolean }>({ op: "finalizeSessionRecord", runtimeSessionId: "RS-1" });
      expect(terminated).toMatchObject({ inserted: true, isOfficial: false });

      await createRuntimeSessionRecord(session("RS-2", participant.runtimeParticipantId, "tbct-s01"));
      await updateRuntimeSessionRecord("RS-2", { status: "completed" as never, completedAt: new Date().toISOString() });
      const completed = await call<{ inserted: boolean; isOfficial: boolean; contentSha256: string }>({ op: "finalizeSessionRecord", runtimeSessionId: "RS-2" });
      expect(completed).toMatchObject({ inserted: true, isOfficial: true });
      expect(completed.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await call({ op: "finalizeSessionRecord", runtimeSessionId: "RS-2" })).toMatchObject({ inserted: false, isOfficial: true });

      await createRuntimeSessionRecord(session("RS-3", participant.runtimeParticipantId, "tbct-s01"));
      await updateRuntimeSessionRecord("RS-3", { status: "completed" as never, completedAt: new Date().toISOString() });
      expect(await call({ op: "finalizeSessionRecord", runtimeSessionId: "RS-3" })).toMatchObject({ inserted: true, isOfficial: false });

      const { rows: attempts } = await pool().query<{ id: string; module_number: number; attempt_number: number; is_official: boolean; session_number: number | null }>(
        "SELECT id, module_number, attempt_number, is_official, session_number FROM runtime_sessions WHERE participant_id = $1 ORDER BY attempt_number", [participant.runtimeParticipantId],
      );
      expect(attempts).toEqual([
        { id: "RS-1", module_number: 1, attempt_number: 1, is_official: false, session_number: null },
        { id: "RS-2", module_number: 1, attempt_number: 2, is_official: true, session_number: 1 },
        { id: "RS-3", module_number: 1, attempt_number: 3, is_official: false, session_number: null },
      ]);
      const { rows: visit } = await pool().query<{ status: string; runtime_session_id: string }>("SELECT status, runtime_session_id FROM study_visits WHERE study_participant_id = $1 AND visit_type = 'ai_session' AND number = 1", [participant.studyParticipantId]);
      expect(visit[0]).toEqual({ status: "completed", runtime_session_id: "RS-2" });

      const records = await call<Array<{ attemptNumber: number; snapshot: { conversation: Array<{ content: string }>; fidelity: { totalSteps: number } } }>>({ op: "listSessionRecords", participantId: participant.runtimeParticipantId }, clinician);
      expect(records).toHaveLength(3);
      expect(records[0].snapshot.conversation[0].content).toBe("안녕하세요");
      expect(records[0].snapshot.fidelity.totalSteps).toBe(11);
      await expectRefused("UPDATE session_records SET content_sha256 = 'x'", [], /.+/);
      // The researcher view of the conversation.
      const { rows: messages } = await pool().query<{ content: string }>("SELECT content FROM participant_session_messages WHERE runtime_session_id = 'RS-1'");
      expect(messages).toEqual([expect.objectContaining({ content: "안녕하세요" })]);
    });
  });

  describe("assessments", () => {
    it("scores a weekly PHQ-2 + suicidality response, opens 24h review tasks and keeps corrections as new rows", async () => {
      const { rows } = await pool().query<{ id: string; study_participant_id: string; runtime_participant_id: string; auth_user_id: string }>(
        `SELECT t.id, t.study_participant_id, sp.runtime_participant_id, rp.auth_user_id FROM assessment_tasks t
         JOIN study_participants sp ON sp.id = t.study_participant_id JOIN runtime_participants rp ON rp.id = sp.runtime_participant_id
         WHERE t.instrument_code = 'PHQ2SI' AND t.occurrence = 1 AND t.status = 'due' LIMIT 1`,
      );
      const task = rows[0];
      const patient: TrialActor = { userId: task.auth_user_id, role: "patient" };
      const stranger: TrialActor = { userId: randomUUID(), role: "patient" };
      await expect(call({ op: "submitAssessmentResponse", response: { taskId: task.id, items: [3, 3, 1] } }, stranger)).rejects.toThrow(/Not your/);
      await expect(call({ op: "submitAssessmentResponse", response: { taskId: task.id, items: [3, 9, 1] } }, patient)).rejects.toThrow();
      const response = await call<AssessmentResponse>({ op: "submitAssessmentResponse", response: { taskId: task.id, items: [3, 2, 1] } }, patient);
      expect(response.total).toBe(5);
      expect(response.flags).toEqual(expect.arrayContaining(["phq2_high", "suicidality"]));
      expect(response.inWindow).toBe(true);
      await expect(call({ op: "submitAssessmentResponse", response: { taskId: task.id, items: [0, 0, 0] } }, patient)).rejects.toThrow(/completed/);

      const reviews = await call<Array<{ source: string; dueAt: string; studyParticipantId: string }>>({ op: "listReviewTasks", status: "open" }, clinician);
      const mine = reviews.filter((review) => review.studyParticipantId === task.study_participant_id);
      expect(mine.map((review) => review.source).sort()).toEqual(["phq2_weekly", "suicidality_item"]);
      const hours = (new Date(mine[0].dueAt).getTime() - Date.now()) / 3600_000;
      expect(hours).toBeGreaterThan(23);
      expect(hours).toBeLessThanOrEqual(24);

      await expect(call({ op: "submitAssessmentResponse", response: { taskId: task.id, items: [0, 0, 0], supersedesId: response.id } }, coordinator)).rejects.toThrow(/reason/);
      const corrected = await call<AssessmentResponse>({ op: "submitAssessmentResponse", response: { taskId: task.id, items: [2, 2, 0], supersedesId: response.id, correctionReason: "Transcription error" } }, coordinator);
      expect(corrected.supersedesId).toBe(response.id);
      const all = await call<AssessmentResponse[]>({ op: "listAssessmentResponses", studyParticipantId: task.study_participant_id }, clinician);
      expect(all.filter((item) => item.taskId === task.id)).toHaveLength(2);
      await expectRefused("UPDATE assessment_responses SET total = 0", [], /.+/);
    });

    it("shows the blinded assessor interview tasks only, and a blinded roster without arms", async () => {
      const tasks = await call<AssessmentTask[]>({ op: "listAssessmentTasks" }, assessor);
      expect(tasks.length).toBeGreaterThan(0);
      expect(new Set(tasks.map((task) => task.mode))).toEqual(new Set(["interview"]));
      const roster = await call<Array<Record<string, unknown>>>({ op: "listBlindedParticipants" }, assessor);
      expect(roster.length).toBeGreaterThan(0);
      expect(JSON.stringify(roster)).not.toMatch(/CLINICIAN_ONLY|AI_CLINICIAN|AI_LED|armCode/);
      expect(roster.every((row) => row.status !== "allocated")).toBe(true);
      const interview = tasks.find((task) => task.instrumentCode === "CSSRS")!;
      const self = (await call<AssessmentTask[]>({ op: "listAssessmentTasks", mode: "self" }, coordinator))[0];
      await expect(call({ op: "submitAssessmentResponse", response: { taskId: self.id, items: [1] } }, assessor)).rejects.toThrow(/interview/);
      expect(interview).toBeDefined();
    });
  });

  describe("safety and lock", () => {
    it("gives a serious adverse event a 24h reporting deadline and refuses to lock while it is unreported", async () => {
      const { rows } = await pool().query<{ id: string }>("SELECT id FROM study_participants WHERE status = 'allocated' LIMIT 1");
      const detectedAt = "2026-09-20T10:00:00.000Z";
      const event = await call<{ id: string; reportDueAt: string }>({
        op: "createAdverseEvent",
        event: { studyParticipantId: rows[0].id, detectedAt, description: "Hospitalised", serious: true, seriousnessCriteria: ["hospitalisation"], severity: "severe", relatedness: "unlikely", outcome: "ongoing" },
      }, clinician);
      expect(event.reportDueAt).toBe("2026-09-21T10:00:00.000Z");
      await expect(call({ op: "updateAdverseEvent", id: event.id, patch: { recordedBy: "someone" } as never }, clinician)).rejects.toThrow(/cannot be changed/);
      await expect(call({ op: "lockStudy", reason: "Database lock" })).rejects.toThrow(/not reported/);
      await call({ op: "updateAdverseEvent", id: event.id, patch: { reportedAt: "2026-09-20T20:00:00.000Z" } }, clinician);
      const summary = await call<{ enrollment: unknown[]; adverseEvents: unknown[] }>({ op: "getMonitoringSummary" }, clinician);
      expect(summary.enrollment.length).toBeGreaterThan(0);
      expect(summary.adverseEvents.length).toBeGreaterThan(0);
      await call({ op: "lockStudy", reason: "Database lock" });
      await expect(call({ op: "createDeviation", deviation: { category: "other", severity: "minor", description: "after lock" } }, coordinator)).rejects.toThrow(/lock/i);
      await expectRefused("UPDATE study_participants SET status = 'completed'", [], /lock/i);
    });
  });
});

describe("allocation balance (324 participants)", () => {
  it("allocates 1:1:1 within each stratum from a blocked list", async () => {
    const fresh = await createTestDatabase();
    const previous = db.pool;
    db.pool = fresh.pool;
    try {
      await call({ op: "configureStudy", config: defaultStudyConfig("KR", "active") });
      const release = await call<{ id: string }>({ op: "createAiRelease", release: { label: "R1", modelId: "claude-opus-5-5", promptVersions: {}, memoryAlgorithmVersion: "retrieval-v1", memoryIndexVersion: "chunks-v1" } });
      await call({ op: "freezeAiRelease", releaseId: release.id });
      await call({ op: "uploadRandomizationList", listVersion: "v1", csv: ["stratum,sequence,arm", ...blockList("KR|MDD", 27, 3), ...blockList("KR|ANXIETY", 27, 5)].join("\n") });
      // Straight to the SQL allocation function: the lifecycle is covered above.
      for (let index = 0; index < 324; index += 1) {
        const stratum = index % 2 ? "ANXIETY" : "MDD";
        const id = `SPB-${index}`;
        await fresh.pool.query(`INSERT INTO runtime_participants (id, project_id, alias, status, created_at, updated_at, data) VALUES ($1,'tbct',$1,'active',now(),now(),'{}')`, [`RPB-${index}`]);
        await fresh.pool.query(`INSERT INTO study_participants (id, study_id, site_id, runtime_participant_id, study_code, diagnosis_stratum, status, data) VALUES ($1,'TBCT-RCT-KR',$2,$3,$1,$4,'enrolled','{}')`, [id, SITE_ID, `RPB-${index}`, stratum]);
        await fresh.pool.query(`INSERT INTO study_consents (id, study_participant_id, consent_type, version, status, method, decided_at, recorded_by) VALUES ($1,$2,'main','1','granted','written',now(),'test')`, [`C-${index}`, id]);
        await fresh.pool.query("SELECT * FROM allocate_participant($1, $2, 'test')", [id, `A-${index}`]);
      }
      const { rows } = await fresh.pool.query<{ stratum: string; arm_code: string; n: number }>("SELECT stratum, arm_code, count(*)::int AS n FROM allocations GROUP BY 1, 2 ORDER BY 1, 2");
      expect(rows).toHaveLength(6);
      expect(rows.every((row) => row.n === 54)).toBe(true);
    } finally {
      db.pool = previous;
      await fresh.pool.end();
    }
  }, 180_000);
});
