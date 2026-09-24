import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveParticipant } from "@/shared/data/repositories/participant-repository";
import {
  getMemoryCandidate,
  listLongitudinalMemories,
  listMemoryCandidates,
  listMemoryRetrievalRuns,
  listMemoryUsageLogs,
  listHomeworkTrackingRecords,
  saveLongitudinalMemory,
  saveMemoryCandidate,
} from "@/shared/data/repositories/longitudinal-memory-repository";
import { listMemoryReviewDecisions } from "@/shared/data/repositories/memory-review-repository";
import { saveSessionSummary, getSessionSummary } from "@/shared/data/repositories/session-summary-repository";
import { retrieveSelectiveMemory } from "@/shared/memory/memory-retrieval-engine";
import { getRetentionPolicy, listRetentionPolicies } from "@/shared/memory/retention-policies";
import { expireEligibleMemories, getPendingMemoryCandidates } from "@/shared/api/longitudinal-memory-api";
import { extractMemoryCandidates } from "@/shared/api/session-summary-api";
import { approveMemoryCandidateWithReview, getMemoryReviewQueue, rejectMemoryCandidateWithReview } from "@/clinician/lib/api/memory-review-api";
import type { LongitudinalMemory, MemoryCandidate, RuntimeParticipant, RuntimeSessionSummary } from "@/types/longitudinal-memory";

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
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
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
    ...overrides,
  };
}

const retrievalRequest = {
  participantId: PARTICIPANT_ID,
  runtimeSessionId: "RS-current",
  protocolId: "tbct-br-001",
  protocolVersion: "1",
  sessionDefinitionId: "tbct-s02",
  currentNodeId: "tbct-s02-n01",
  currentNodeType: "dialogue" as const,
  currentClinicalIntent: "Problems and goals",
  maxItems: 5,
};

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

describe("stage 3 -- retrieval without IndexedDB", () => {
  it("selects an approved memory, excludes the safety-restricted one, and logs the run and usage", async () => {
    await saveLongitudinalMemory(memory({ id: "MEM-goal", memoryType: "treatment_goal", content: "아침에 10분 산책하기" }));
    await saveLongitudinalMemory(memory({ id: "MEM-safe", memoryType: "safety_relevant", content: "위기 관련", sensitivity: "safety_restricted" }));
    await saveLongitudinalMemory(memory({ id: "MEM-pending", memoryType: "barrier", content: "아직 승인 안 됨", status: "candidate", retentionPolicyId: "RET-HW-OUT" }));

    const result = await retrieveSelectiveMemory(retrievalRequest);

    expect(result.selected.map((item) => item.id)).toEqual(["MEM-goal"]);
    expect(result.run.excluded).toEqual(expect.arrayContaining([
      { memoryId: "MEM-safe", reason: "safety restricted" },
      { memoryId: "MEM-pending", reason: "not approved" },
    ]));
    const runs = await listMemoryRetrievalRuns("RS-current");
    expect(runs.map((run) => run.selectedMemoryIds)).toEqual([["MEM-goal"]]);
    const usage = await listMemoryUsageLogs("RS-current");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ memoryId: "MEM-goal", nodeId: "tbct-s02-n01", usageType: "retrieved" });
  });

  it("selects nothing when the participant has not consented to cross-session use", async () => {
    await saveParticipant(participant({ consent: { memoryStorageAllowed: true, crossSessionUseAllowed: false, sensitiveMemoryAllowed: true, updatedAt: now() } }));
    await saveLongitudinalMemory(memory({ id: "MEM-goal", memoryType: "treatment_goal", content: "아침에 10분 산책하기" }));
    const result = await retrieveSelectiveMemory(retrievalRequest);
    expect(result.selected).toEqual([]);
    expect(result.run.excluded).toEqual([{ memoryId: "MEM-goal", reason: "cross-session consent disabled" }]);
  });
});

describe("stage 1 -- candidates from a stored session summary, without IndexedDB", () => {
  it("writes the candidates and the homework tracking record to the server store", async () => {
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
      updatedAt: now(),
    };
    await saveSessionSummary(summary);

    const candidates = await extractMemoryCandidates("SUM-1");

    expect(candidates.map((candidate) => candidate.memoryType).sort()).toEqual(["barrier", "homework_assignment"]);
    const stored = await listMemoryCandidates(PARTICIPANT_ID);
    expect(stored.map((candidate) => candidate.id).sort()).toEqual(candidates.map((candidate) => candidate.id).sort());
    expect(stored.every((candidate) => candidate.status === "candidate")).toBe(true);
    expect((await getSessionSummary("SUM-1"))?.memoryCandidateIds).toHaveLength(2);
    expect(await listHomeworkTrackingRecords(PARTICIPANT_ID)).toMatchObject([{ description: "이번 주에 자동적 사고 3개 기록하기", status: "assigned" }]);
  });
});

describe("stage 2 -- clinician approval moves a candidate into the approved memories", () => {
  function candidate(id: string, content: string): MemoryCandidate {
    return memory({ id, memoryType: "homework_assignment", content, status: "candidate", retentionPolicyId: "RET-HW-ASG" });
  }

  it("shows the candidate in the review queue and, once approved, in retrieval -- with the decision recorded", async () => {
    await saveMemoryCandidate(candidate("CAND-1", "이번 주에 자동적 사고 3개 기록하기"));
    expect((await getMemoryReviewQueue()).map((item) => item.id)).toEqual(["CAND-1"]);
    expect(await getPendingMemoryCandidates(PARTICIPANT_ID)).toHaveLength(1);

    const approved = await approveMemoryCandidateWithReview("CAND-1", "clinically relevant");

    expect(approved).toMatchObject({ id: "CAND-1", status: "approved", approvedBy: "Clinician" });
    expect(await getMemoryCandidate("CAND-1")).toBeUndefined();
    expect((await listLongitudinalMemories(PARTICIPANT_ID)).map((item) => item.id)).toEqual(["CAND-1"]);
    expect(await listMemoryReviewDecisions("CAND-1")).toMatchObject([{ action: "approve", reason: "clinically relevant" }]);
    const result = await retrieveSelectiveMemory(retrievalRequest);
    expect(result.selected.map((item) => item.id)).toEqual(["CAND-1"]);
  });

  it("keeps a rejected candidate out of the queue and out of retrieval, with the decision recorded", async () => {
    await saveMemoryCandidate(candidate("CAND-2", "관련 없는 항목"));
    await rejectMemoryCandidateWithReview("CAND-2", "not relevant");
    expect(await getMemoryCandidate("CAND-2")).toMatchObject({ status: "rejected", rejectionReason: "not relevant" });
    expect(await getMemoryReviewQueue()).toEqual([]);
    expect(await listLongitudinalMemories(PARTICIPANT_ID)).toEqual([]);
    expect(await listMemoryReviewDecisions("CAND-2")).toMatchObject([{ action: "reject", previousValue: "관련 없는 항목" }]);
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
