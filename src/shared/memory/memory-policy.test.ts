import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getParticipant, saveParticipant } from "@/shared/data/repositories/participant-repository";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/shared/protocol/source-fidelity-catalog";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession } from "@/shared/api/runtime-execution-api";
import { getOrCreateParticipantForUser } from "@/shared/api/participant-api";
import { listMemoryRetrievalRuns, saveLongitudinalMemory } from "@/shared/data/repositories/longitudinal-memory-repository";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import {
  DEFAULT_LONGITUDINAL_MEMORY_POLICY,
  LONGITUDINAL_MEMORY_POLICY_ENV,
  MEMORY_INJECTION_SCOPES,
  memoryAllowedOnTurn,
  resolveLongitudinalMemoryPolicy,
  type LongitudinalMemoryPolicy,
} from "@/shared/memory/memory-policy";
import type { LongitudinalMemory } from "@/types/longitudinal-memory";
import type { RuntimeSession } from "@/types/runtime-session";
import type { RuntimePromptItem } from "@/types/protocol-runtime";

// Every rule that is the PI's decision lives in memory-policy.ts and is
// overridable from one deployment setting. These tests pin that each
// possible decision actually changes runtime behaviour -- so whatever the
// PI decides, the code accommodates it without an edit.

const saved = process.env[LONGITUDINAL_MEMORY_POLICY_ENV];
function setPolicy(override: Partial<LongitudinalMemoryPolicy> | string | undefined) {
  if (override === undefined) delete process.env[LONGITUDINAL_MEMORY_POLICY_ENV];
  else process.env[LONGITUDINAL_MEMORY_POLICY_ENV] = typeof override === "string" ? override : JSON.stringify(override);
}

beforeEach(() => setPolicy(undefined));
afterEach(() => {
  if (saved === undefined) delete process.env[LONGITUDINAL_MEMORY_POLICY_ENV];
  else process.env[LONGITUDINAL_MEMORY_POLICY_ENV] = saved;
});

describe("policy resolution", () => {
  it("has no off switch: the shipped default already carries memory", () => {
    expect(resolveLongitudinalMemoryPolicy()).toEqual(DEFAULT_LONGITUDINAL_MEMORY_POLICY);
    expect(Object.keys(DEFAULT_LONGITUDINAL_MEMORY_POLICY)).not.toContain("enabled");
    // Every scope the schema accepts injects on SOME turn, so no setting
    // can switch the feature off (clinical decision 2026-09-21).
    const everyTurnShape = [
      { participantOwned: true, nodeRequiresProtectedField: false },
      { participantOwned: false, nodeRequiresProtectedField: true },
      { participantOwned: false, nodeRequiresProtectedField: false },
    ];
    for (const scope of MEMORY_INJECTION_SCOPES) {
      expect(everyTurnShape.some((turn) => memoryAllowedOnTurn(scope, turn))).toBe(true);
    }
  });

  it("merges a partial override over the default and validates it", () => {
    setPolicy({ version: "rct-v1", injectionScope: "unprotected_nodes", maxItemsPerNode: 3, allowedMemoryTypes: ["treatment_goal", "homework_assignment"], crossSessionConsentDefault: false });
    expect(resolveLongitudinalMemoryPolicy()).toEqual({ version: "rct-v1", injectionScope: "unprotected_nodes", maxItemsPerNode: 3, allowedMemoryTypes: ["treatment_goal", "homework_assignment"], crossSessionConsentDefault: false });
    setPolicy({ injectionScope: "all_turns" });
    expect(resolveLongitudinalMemoryPolicy()).toEqual({ ...DEFAULT_LONGITUDINAL_MEMORY_POLICY, injectionScope: "all_turns" });
  });

  it("never lets an invalid setting change the intervention silently: falls back to the default and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setPolicy('{"injectionScope": "everywhere"}');
    expect(resolveLongitudinalMemoryPolicy()).toEqual(DEFAULT_LONGITUDINAL_MEMORY_POLICY);
    setPolicy("not json");
    expect(resolveLongitudinalMemoryPolicy()).toEqual(DEFAULT_LONGITUDINAL_MEMORY_POLICY);
    setPolicy({ maxItemsPerNode: -1 });
    expect(resolveLongitudinalMemoryPolicy()).toEqual(DEFAULT_LONGITUDINAL_MEMORY_POLICY);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects the settings that would be an off switch in disguise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The retired "none" scope, a zero item cap, and an empty type list
    // each used to mean "inject nothing". All three are now invalid, so a
    // deployment cannot quietly withdraw the feature.
    setPolicy({ injectionScope: "none" as never });
    expect(resolveLongitudinalMemoryPolicy()).toEqual(DEFAULT_LONGITUDINAL_MEMORY_POLICY);
    setPolicy({ maxItemsPerNode: 0 });
    expect(resolveLongitudinalMemoryPolicy()).toEqual(DEFAULT_LONGITUDINAL_MEMORY_POLICY);
    setPolicy({ allowedMemoryTypes: [] });
    expect(resolveLongitudinalMemoryPolicy()).toEqual(DEFAULT_LONGITUDINAL_MEMORY_POLICY);
    // An unknown key (such as a stale "enabled": false) is dropped, not honoured.
    setPolicy('{"enabled": false}');
    expect(resolveLongitudinalMemoryPolicy()).toEqual(DEFAULT_LONGITUDINAL_MEMORY_POLICY);
    warn.mockRestore();
  });

  it("covers every scope with an explicit turn rule", () => {
    const owned = { participantOwned: true, nodeRequiresProtectedField: false };
    const protectedNode = { participantOwned: false, nodeRequiresProtectedField: true };
    const administrative = { participantOwned: false, nodeRequiresProtectedField: false };
    expect(MEMORY_INJECTION_SCOPES).toEqual(["administrative_only", "unprotected_nodes", "all_turns"]);
    expect([owned, protectedNode, administrative].map((turn) => memoryAllowedOnTurn("administrative_only", turn))).toEqual([false, false, true]);
    expect([owned, protectedNode, administrative].map((turn) => memoryAllowedOnTurn("unprotected_nodes", turn))).toEqual([true, false, true]);
    expect([owned, protectedNode, administrative].map((turn) => memoryAllowedOnTurn("all_turns", turn))).toEqual([true, true, true]);
  });
});

const ITEMS = [{ id: "MEM-goal", type: "treatment_goal", content: "아침에 10분 산책하기" }];

function sessionWithMemory(sessionDefinitionId: string): RuntimeSession {
  return {
    id: "policy-session", projectId: "TBCT-BR-001", protocolId: "tbct-br-001", protocolVersion: "1", releaseId: "release-1",
    sessionDefinitionId, participantId: "policy-participant", status: "waiting_for_input", patientAlias: "Synthetic", locale: "ko-KR",
    runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {}, longitudinalMemory: { treatmentGoals: ["아침에 10분 산책하기"], patientPreferences: [], activeHomework: [], relevantBarriers: [], copingStrategies: [], items: ITEMS } },
  } as unknown as RuntimeSession;
}

function compile(promptIdFragment: string, sessionDefinitionId: string) {
  const sourcePromptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.startsWith(sessionDefinitionId) && item.id.includes(promptIdFragment))!;
  const node = CANONICAL_STAGE_NODES.find((item) => item.id === sourcePromptItem.nodeId)!;
  const runtimePromptItem: RuntimePromptItem = { id: sourcePromptItem.id, nodeId: node.id, roleId: "tbct_guide", scope: "node", sequenceIndex: 1, executionMode: "serial", modelGuidance: "", fallbackPatientText: "t", completionCondition: { kind: "always" }, allowedActions: ["ask"], forbiddenActions: [], requiredFields: [], validationRules: [], maxAttempts: 3, requiresPatientInput: true, outputSchemaVersion: "1" };
  return compileDialogueContract({ session: sessionWithMemory(sessionDefinitionId), node, sourcePromptItem, runtimePromptItem, recentMessages: [], clarificationAttemptCount: 0, isFirstPromptOfNode: true, isFirstPromptOfSession: false });
}

describe("the contract follows the decided scope", () => {
  // S01 n10 preview: administrative turn, no protected field in the node.
  // S01 candidate-one-emotion: participant-owned turn in a protected node.
  // S02 review-distortion (the fifteen-distortion walkthrough): participant-
  // owned, node not protected. (Was problem-framing until S02 dropped
  // CCPH/CCGH for the cognitive-distortions session.)
  const cases: Array<[string, string, string, boolean]> = [
    ["administrative_only", "-preview", "tbct-s01", true],
    ["administrative_only", "review-distortion", "tbct-s02", false],
    ["unprotected_nodes", "review-distortion", "tbct-s02", true],
    ["unprotected_nodes", "candidate-one-emotion", "tbct-s01", false],
    ["all_turns", "candidate-one-emotion", "tbct-s01", true],
  ];
  it.each(cases)("scope %s: %s (%s) carries memory = %s", (scope, prompt, sessionId, expected) => {
    setPolicy({ injectionScope: scope as LongitudinalMemoryPolicy["injectionScope"] });
    expect(compile(prompt, sessionId).participantMemory !== undefined).toBe(expected);
  });

  it("carries memory on the shipped default config, with no setting at all", () => {
    setPolicy(undefined);
    expect(compile("-preview", "tbct-s01").participantMemory).toEqual(ITEMS);
  });

  it("never mixes memory into confirmedState, in any scope", () => {
    // The scope decides where memory APPEARS; it can never make memory
    // quotable. confirmedState is message-composition.ts's quote-source pool,
    // so keeping memory out of it is what stops the assistant presenting a
    // prior-session summary as the participant's own words -- and that holds
    // even at all_turns, where every turn carries memory.
    for (const scope of MEMORY_INJECTION_SCOPES) {
      setPolicy({ injectionScope: scope });
      for (const [prompt, sessionId] of [["-preview", "tbct-s01"], ["automatic-thought", "tbct-s03"], ["review-distortion", "tbct-s02"]] as const) {
        expect(JSON.stringify(compile(prompt, sessionId).confirmedState)).not.toContain("산책");
      }
    }
  });
});

describe("retrieval follows the decision", () => {
  function approved(participantId: string, id: string, memoryType: LongitudinalMemory["memoryType"], retentionPolicyId: string): LongitudinalMemory {
    const now = new Date().toISOString();
    return { id, participantId, projectId: "TBCT-BR-001", memoryType, title: memoryType, content: `content ${id}`, status: "approved", sensitivity: "standard", sourceType: "session_summary", sourceSessionId: "RS-earlier", sourceMessageIds: [], sourceNodeIds: [], sourceExecutionLogIds: [], isDirectlyReported: true, isSystemDerived: false, validFrom: now, retentionPolicyId, createdAt: now, updatedAt: now, createdBy: "System" };
  }

  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("retrieves on the shipped default config, with no setting at all", async () => {
    setPolicy(undefined);
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    await saveLongitudinalMemory(approved(session.participantId, "MEM-1", "treatment_goal", "RET-GOAL"));
    await startRuntimeSession(session.id);
    const runs = await listMemoryRetrievalRuns(session.id);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((run) => run.selectedMemoryIds.includes("MEM-1"))).toBe(true);
    expect((await getRuntimeSession(session.id))?.session.runtimeContext.longitudinalMemory?.items).toEqual([
      { id: "MEM-1", type: "treatment_goal", content: "content MEM-1" },
    ]);
  });

  it("still withholds everything from a participant who has not consented -- the one remaining gate", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    const participant = (await getParticipant(session.participantId))!;
    await saveParticipant({ ...participant, consent: { ...participant.consent, crossSessionUseAllowed: false } });
    await saveLongitudinalMemory(approved(session.participantId, "MEM-1", "treatment_goal", "RET-GOAL"));

    await startRuntimeSession(session.id);

    const view = await getRuntimeSession(session.id);
    expect(view?.session.runtimeContext.longitudinalMemory).toBeUndefined();
    expect(await listMemoryRetrievalRuns(session.id)).toEqual([]);
    // Logged as skipped, not as a failure -- declining consent is expected.
    expect(view?.logs.some((log) => log.status === "skipped" && log.summary.includes("cross-session use not consented"))).toBe(true);
  });

  it("applies maxItemsPerNode and allowedMemoryTypes", async () => {
    setPolicy({ maxItemsPerNode: 1, allowedMemoryTypes: ["homework_assignment"] });
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    await saveLongitudinalMemory(approved(session.participantId, "MEM-goal", "treatment_goal", "RET-GOAL"));
    await saveLongitudinalMemory(approved(session.participantId, "MEM-hw-1", "homework_assignment", "RET-HW-ASG"));
    await saveLongitudinalMemory(approved(session.participantId, "MEM-hw-2", "homework_assignment", "RET-HW-ASG"));
    await startRuntimeSession(session.id);
    const runs = await listMemoryRetrievalRuns(session.id);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.selectedMemoryIds).toHaveLength(1);
      expect(run.selectedMemoryIds[0]).toMatch(/^MEM-hw-/);
      expect(run.excluded).toEqual(expect.arrayContaining([{ memoryId: "MEM-goal", reason: "memory type not requested" }]));
    }
  });
});

describe("a new participant's consent default follows the decision", () => {
  it("defaults crossSessionUseAllowed from the policy", async () => {
    setPolicy({ crossSessionConsentDefault: false });
    const off = await getOrCreateParticipantForUser(`auth-${Date.now()}-off`, { locale: "ko-KR" });
    expect(off.consent.crossSessionUseAllowed).toBe(false);
    setPolicy({ crossSessionConsentDefault: true });
    const on = await getOrCreateParticipantForUser(`auth-${Date.now()}-on`, { locale: "ko-KR" });
    expect(on.consent.crossSessionUseAllowed).toBe(true);
  });
});
