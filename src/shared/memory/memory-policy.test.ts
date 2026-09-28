import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/shared/protocol/source-fidelity-catalog";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { getOrCreateParticipantForUser } from "@/shared/api/participant-api";
import {
  DEFAULT_LONGITUDINAL_MEMORY_POLICY,
  LONGITUDINAL_MEMORY_POLICY_ENV,
  MEMORY_INJECTION_SCOPES,
  memoryAllowedOnTurn,
  resolveLongitudinalMemoryPolicy,
  type LongitudinalMemoryPolicy,
} from "@/shared/memory/memory-policy";
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
    runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {}, longitudinalMemory: { treatmentGoals: ["아침에 10분 산책하기"], patientPreferences: [], activeHomework: [], relevantBarriers: [], copingStrategies: [], items: ITEMS } } } as unknown as RuntimeSession;
}

function compile(promptIdFragment: string, sessionDefinitionId: string) {
  const sourcePromptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.startsWith(sessionDefinitionId) && item.id.includes(promptIdFragment))!;
  const node = CANONICAL_STAGE_NODES.find((item) => item.id === sourcePromptItem.nodeId)!;
  const runtimePromptItem: RuntimePromptItem = { id: sourcePromptItem.id, nodeId: node.id, roleId: "tbct_guide", scope: "node", sequenceIndex: 1, executionMode: "serial", modelGuidance: "", fallbackPatientText: "t", completionCondition: { kind: "always" }, allowedActions: ["ask"], forbiddenActions: [], requiredFields: [], validationRules: [], maxAttempts: 3, requiresPatientInput: true, outputSchemaVersion: "1" };
  return compileDialogueContract({ session: sessionWithMemory(sessionDefinitionId), node, sourcePromptItem, runtimePromptItem, recentMessages: [], clarificationAttemptCount: 0, isFirstPromptOfNode: true, isFirstPromptOfSession: false });
}

describe("the contract never carries the retired memories", () => {
  // Whatever the old policy scope says: the compiler no longer reads
  // runtimeContext.longitudinalMemory (note2026_09_27_memory_rag_m3_m7).
  it.each(MEMORY_INJECTION_SCOPES)("scope %s", (scope) => {
    setPolicy({ injectionScope: scope });
    for (const [prompt, sessionId] of [["-ccd-connection", "tbct-s03"], ["-automatic-thought", "tbct-s03"], ["-primary-emotion", "tbct-s03"]] as const) {
      const contract = compile(prompt, sessionId);
      expect(contract.participantMemory).toBeUndefined();
      expect(JSON.stringify(contract)).not.toContain("산책");
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
