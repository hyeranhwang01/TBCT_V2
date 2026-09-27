import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveParticipant } from "@/shared/data/repositories/participant-repository";
import {
  listLongitudinalMemories,
  listHomeworkTrackingRecords,
  saveLongitudinalMemory,
} from "@/shared/data/repositories/longitudinal-memory-repository";
import { saveSessionSummary, getSessionSummary } from "@/shared/data/repositories/session-summary-repository";
import { MEMORY_CONSENT_TEXT_VERSION } from "@/shared/memory/memory-consent";
import { getRetentionPolicy, listRetentionPolicies } from "@/shared/memory/retention-policies";
import { expireEligibleMemories } from "@/shared/api/longitudinal-memory-api";
import { recordSummaryTracking } from "@/shared/api/session-summary-api";
import type { LongitudinalMemory, RuntimeParticipant, RuntimeSessionSummary } from "@/types/longitudinal-memory";

// Longitudinal-memory pipeline, stage by stage, in an environment WITHOUT
// IndexedDB (.claude/TASK_SCOPE.json note2026_09_13_ari_memory_pipeline_plumbing).
// The global test setup installs fake-indexeddb for every file, which is
// exactly why the suite never noticed that the whole pipeline threw on the
// server (a patient turn runs in Node, where there is no IndexedDB). Each
// test here removes globalThis.indexedDB first, so any code path that still
// reaches for Dexie fails loudly.

const PARTICIPANT_ID = "PT-memory-pipeline";
const now = () => new Date().toISOString();

function participant(overrides: Partial<RuntimeParticipant> = {}): RuntimeParticipant {
  return {
    id: PARTICIPANT_ID,
    projectId: "TBCT-BR-001",
    alias: "Memory Test",
    locale: "ko-KR",
    status: "active",
    runtimeSessionIds: [],
    longitudinalRecordId: "LR-memory-pipeline",
    consent: { memoryStorageAllowed: true, crossSessionUseAllowed: true, sensitiveMemoryAllowed: true, updatedAt: now() },
    memoryConsent: { decision: "granted", textVersion: MEMORY_CONSENT_TEXT_VERSION, source: "profile", decidedAt: now() },
    createdAt: now(),
    updatedAt: now(),
    ...overrides };
}

function memory(overrides: Partial<LongitudinalMemory> & Pick<LongitudinalMemory, "id" | "memoryType" | "content">): LongitudinalMemory {
  return {
    participantId: PARTICIPANT_ID,
    projectId: "TBCT-BR-001",
    title: overrides.memoryType,
    status: "approved",
    sensitivity: "standard",
    sourceType: "session_summary",
    sourceSessionId: "RS-previous",
    sourceMessageIds: [],
    sourceNodeIds: [],
    sourceExecutionLogIds: [],
    isDirectlyReported: true,
    isSystemDerived: false,
    validFrom: now(),
    retentionPolicyId: overrides.memoryType === "safety_relevant" ? "RET-SAFE" : "RET-GOAL",
    createdAt: now(),
    updatedAt: now(),
    createdBy: "System",
    ...overrides };
}

let savedIndexedDb: unknown;

beforeEach(async () => {
  savedIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  await saveParticipant(participant());
});

afterEach(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = savedIndexedDb;
});

describe("retention policies are a code constant, not seeded browser data", () => {
  it("exposes the six policies everywhere, with RET-SAFE blocking runtime injection", () => {
    expect(listRetentionPolicies().map((policy) => policy.id)).toEqual(["RET-TEMP", "RET-HW-ASG", "RET-HW-OUT", "RET-PREF", "RET-GOAL", "RET-SAFE"]);
    expect(getRetentionPolicy("RET-GOAL")?.allowRuntimeInjection).toBe(true);
    expect(getRetentionPolicy("RET-SAFE")?.allowRuntimeInjection).toBe(false);
    expect(getRetentionPolicy("RET-NOPE")).toBeUndefined();
  });

  it("returns copies, so a caller cannot mutate the frozen rules", () => {
    const policy = getRetentionPolicy("RET-GOAL")!;
    policy.allowRuntimeInjection = false;
    policy.memoryTypes.push("clinician_note");
    expect(getRetentionPolicy("RET-GOAL")).toMatchObject({ allowRuntimeInjection: true, memoryTypes: ["session_goal", "treatment_goal", "coping_strategy", "progress_marker"] });
  });
});

describe("tracking from a stored session summary, without IndexedDB", () => {
  it("writes the homework tracking record to the server store, and no memory candidates any more", async () => {
    const summary: RuntimeSessionSummary = {
      id: "SUM-1",
      runtimeSessionId: "RS-previous",
      participantId: PARTICIPANT_ID,
      protocolId: "tbct-br-001",
      protocolVersion: "1",
      sessionDefinitionId: "tbct-s01",
      sessionStatus: "completed",
      summaryStatus: "draft",
      goalsAddressed: [],
      activitiesCompleted: [],
      homeworkAssigned: ["이번 주에 자동적 사고 3개 기록하기"],
      homeworkOutcomes: [],
      patientReportedBarriers: ["시간이 없어서 못 했어요"],
      copingStrategies: [],
      progressMarkers: [],
      unresolvedItems: [],
      safetyEvents: [],
      nextSessionConsiderations: [],
      memoryCandidateIds: [],
      sourceMessageIds: [],
      sourceExecutionLogIds: [],
      createdAt: now(),
      updatedAt: now() };
    await saveSessionSummary(summary);

    await recordSummaryTracking("SUM-1");

    // Cross-session memory is the participant's own words now (chunks, with
    // consent), not candidates for clinician review.
    expect((await getSessionSummary("SUM-1"))?.memoryCandidateIds).toEqual([]);
    expect(await listHomeworkTrackingRecords(PARTICIPANT_ID)).toMatchObject([{ description: "이번 주에 자동적 사고 3개 기록하기", status: "assigned" }]);
  });
});

describe("expiry", () => {
  it("expires only approved memories whose validUntil has passed", async () => {
    await saveLongitudinalMemory(memory({ id: "MEM-old", memoryType: "homework_outcome", content: "지난 결과", retentionPolicyId: "RET-HW-OUT", validUntil: new Date(Date.now() - 1000).toISOString() }));
    await saveLongitudinalMemory(memory({ id: "MEM-fresh", memoryType: "treatment_goal", content: "현재 목표", validUntil: new Date(Date.now() + 86_400_000).toISOString() }));
    expect(await expireEligibleMemories()).toBe(1);
    const all = await listLongitudinalMemories(PARTICIPANT_ID);
    expect(all.find((item) => item.id === "MEM-old")?.status).toBe("expired");
    expect(all.find((item) => item.id === "MEM-fresh")?.status).toBe("approved");
  });
});
