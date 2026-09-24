import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/shared/protocol/source-fidelity-catalog";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { assembleMessage } from "@/shared/dialogue-agent/message-composition";
import { generateDialogueDecision } from "@/shared/dialogue-agent/anthropic-dialogue-agent";
import { resolveDialogueAgentMessage } from "@/shared/dialogue-agent/dialogue-agent-orchestrator";
import type { DialogueContract } from "@/shared/dialogue-agent/dialogue-agent-contract";
import type { RuntimeSession } from "@/types/runtime-session";
import type { RuntimePromptItem } from "@/types/protocol-runtime";

// Stage 4 of the longitudinal-memory pipeline (.claude/TASK_SCOPE.json
// note2026_09_13_ari_memory_pipeline_plumbing): the memories on the session
// reach the dialogue contract and the system prompt -- but only on turns
// where the Patient Authorship Invariant allows reference context at all,
// never as quotable participant words, and never through the Groq fallback.

// No policy setup here on purpose: cross-session memory is always on
// (memory-policy.ts), so the shipped default config is what these tests
// exercise. If an off switch is ever reintroduced, these fail.
const savedPolicyEnv = process.env.LONGITUDINAL_MEMORY_POLICY;
beforeEach(() => { delete process.env.LONGITUDINAL_MEMORY_POLICY; });
afterEach(() => { if (savedPolicyEnv !== undefined) process.env.LONGITUDINAL_MEMORY_POLICY = savedPolicyEnv; });

const MEMORY_ITEMS = [
  { id: "MEM-goal", type: "treatment_goal", content: "아침에 10분 산책하기" },
  { id: "MEM-hw", type: "homework_assignment", content: "이번 주에 자동적 사고 3개 기록하기" },
];

function session(sessionDefinitionId: string, withMemory = true): RuntimeSession {
  return {
    id: "memory-injection-session",
    projectId: "TBCT-BR-001",
    protocolId: "tbct-br-001",
    protocolVersion: "1",
    releaseId: "release-1",
    sessionDefinitionId,
    participantId: "memory-injection-participant",
    status: "waiting_for_input",
    patientAlias: "Synthetic",
    locale: "ko-KR",
    runtimeContext: {
      fields: {},
      riskSignals: [],
      iterationCounts: {},
      longitudinalMemory: withMemory
        ? { treatmentGoals: ["아침에 10분 산책하기"], patientPreferences: [], activeHomework: ["이번 주에 자동적 사고 3개 기록하기"], relevantBarriers: [], copingStrategies: [], items: MEMORY_ITEMS }
        : undefined,
    },
  } as unknown as RuntimeSession;
}

function runtimePromptItem(overrides: Partial<RuntimePromptItem> = {}): RuntimePromptItem {
  return {
    id: "memory-injection-runtime-prompt",
    nodeId: "memory-injection-node",
    roleId: "tbct_guide",
    scope: "node",
    sequenceIndex: 1,
    executionMode: "serial",
    modelGuidance: "",
    fallbackPatientText: "Placeholder task text.",
    completionCondition: { kind: "always" },
    allowedActions: ["ask"],
    forbiddenActions: [],
    requiredFields: [],
    validationRules: [],
    maxAttempts: 3,
    requiresPatientInput: true,
    outputSchemaVersion: "1",
    ...overrides,
  };
}

function compileFor(promptIdFragment: string, sessionDefinitionId: string, withMemory = true) {
  const sourcePromptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.startsWith(sessionDefinitionId) && item.id.includes(promptIdFragment));
  if (!sourcePromptItem) throw new Error(`No prompt item matching ${promptIdFragment} in ${sessionDefinitionId}`);
  const node = CANONICAL_STAGE_NODES.find((item) => item.id === sourcePromptItem.nodeId);
  if (!node) throw new Error(`No node ${sourcePromptItem.nodeId}`);
  return compileDialogueContract({
    session: session(sessionDefinitionId, withMemory),
    node,
    sourcePromptItem,
    runtimePromptItem: runtimePromptItem({ id: sourcePromptItem.id, nodeId: node.id }),
    recentMessages: [],
    clarificationAttemptCount: 0,
    isFirstPromptOfNode: true,
    isFirstPromptOfSession: false,
  });
}

describe("contract compiler: participantMemory", () => {
  it("carries the session's memories (with ids) on an administrative turn that asks for no participant content", () => {
    // S01 n10 "preview" (three-person model) writes threePersonPreviewComplete -- a delivery flag, not participant content, in a node with no protected field.
    const contract = compileFor("preview", "tbct-s01");
    expect(contract.participantOwned).toBe(false);
    expect(contract.participantMemory).toEqual(MEMORY_ITEMS);
    // Never mixed into confirmedState (the quote-source pool).
    expect(JSON.stringify(contract.confirmedState)).not.toContain("산책");
  });

  it("is absent on a participant-owned turn (S01 candidate-one-emotion)", () => {
    const contract = compileFor("candidate-one-emotion", "tbct-s01");
    expect(contract.participantOwned).toBe(true);
    expect(contract.participantMemory).toBeUndefined();
  });

  it("is absent on a protected-field stage (S03 automatic thought)", () => {
    const contract = compileFor("automatic-thought", "tbct-s03");
    expect(contract.participantOwned || contract.nodeRequiresProtectedField).toBe(true);
    expect(contract.participantMemory).toBeUndefined();
  });

  it("is absent when the session carries no memory", () => {
    expect(compileFor("intro-distortions", "tbct-s01", false).participantMemory).toBeUndefined();
  });
});

const baseContract: DialogueContract = {
  sessionId: "tbct-s01",
  nodeId: "tbct-s01-n10",
  promptItemId: "tbct-s01-n10-p01-preview",
  roleId: "tbct_guide",
  therapeuticObjective: "Preview the three-person model.",
  currentTaskText: "이제 같은 생각을 다른 사람들의 눈으로 살펴볼게요.",
  expectedInputType: "yes_no",
  isRepeatablePrompt: false,
  nodeRequiresProtectedField: false,
  participantOwned: false,
  assistantMustNotSupply: false,
  worksheetEditAvailable: false,
  confirmedState: {},
  allowedActions: ["acknowledge"],
  forbiddenActions: ["diagnose"],
  lastParticipantMessage: "네, 이해했어요",
  recentContext: [{ role: "patient", content: "네, 이해했어요" }],
  safetyStatus: "none",
  locale: "ko-KR",
  clarificationAttemptCount: 0,
  isFirstPromptOfSession: false,
  isFirstPromptOfNode: false,
  isRoleTransitionPrompt: false,
  participantMemory: MEMORY_ITEMS,
};

describe("authorship: a memory is never a quotable participant statement", () => {
  it("rejects a quote lifted from a memory even though the memory is on the contract", () => {
    expect(assembleMessage([{ kind: "quote", text: "아침에 10분 산책하기" }], baseContract)).toEqual({ ok: false, reason: "misquoted_participant" });
    // ...while what the participant actually said this turn still quotes fine.
    expect(assembleMessage([{ kind: "quote", text: "네, 이해했어요" }], baseContract)).toMatchObject({ ok: true });
  });
});

describe("providers: memory reaches Claude's system prompt, never the Groq fallback", () => {
  const originalFetch = globalThis.fetch;
  const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, GROQ_API_KEY: process.env.GROQ_API_KEY, AI_PROVIDER: process.env.AI_PROVIDER };
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];

  const decision = { responseType: "acknowledge", patientFacingMessage: "좋아요. 이제 같은 생각을 다른 사람들의 눈으로 살펴볼게요.", keepCurrentNode: true, participantResponseState: "valid_answer" };

  beforeEach(() => {
    captured.length = 0;
    delete process.env.AI_PROVIDER;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      captured.push({ url, body });
      if (url.includes("api.anthropic.com")) {
        return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_dialogue_decision", input: decision }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("api.groq.com")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("puts an additive 'earlier sessions' section in the Claude system prompt and the memory on the user payload", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.GROQ_API_KEY;
    const result = await generateDialogueDecision(baseContract, { sessionId: "tbct-s01", turnId: "turn-1" });
    expect(result.failed).toBe(false);
    const call = captured.find((item) => item.url.includes("api.anthropic.com"));
    expect(call).toBeDefined();
    const system = String(call!.body.system);
    expect(system).toContain("EARLIER sessions");
    expect(system).toContain("[treatment_goal] 아침에 10분 산책하기");
    expect(system).toContain("Do not quote it");
    // Additive layer: after the forbidden-actions hard rules, like the clinician guidance lines.
    expect(system.indexOf("EARLIER sessions")).toBeGreaterThan(system.indexOf("diagnose"));
    const userText = JSON.stringify(call!.body.messages);
    expect(userText).toContain("MEM-goal");
  });

  it("omits the memory from the prompt when the contract carries none", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.GROQ_API_KEY;
    await generateDialogueDecision({ ...baseContract, participantMemory: undefined }, { sessionId: "tbct-s01", turnId: "turn-2" });
    const call = captured.find((item) => item.url.includes("api.anthropic.com"));
    expect(String(call!.body.system)).not.toContain("EARLIER sessions");
  });

  it("never sends the memory to the Groq continuity fallback", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GROQ_API_KEY = "test-groq-key";
    const result = await generateDialogueDecision(baseContract, { sessionId: "tbct-s01", turnId: "turn-3" });
    expect(result.failed).toBe(false);
    const call = captured.find((item) => item.url.includes("api.groq.com"));
    expect(call).toBeDefined();
    const serialized = JSON.stringify(call!.body);
    expect(serialized).not.toContain("산책");
    expect(serialized).not.toContain("MEM-goal");
    expect(serialized).not.toContain("participantMemory");
  });
});

describe("turn record: injected memory ids", () => {
  it("reports the ids of the memories that were on the contract", async () => {
    const sourcePromptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.startsWith("tbct-s01") && item.id.includes("-preview"))!;
    const node = CANONICAL_STAGE_NODES.find((item) => item.id === sourcePromptItem.nodeId)!;
    const result = await resolveDialogueAgentMessage({
      session: session("tbct-s01"),
      node,
      sourcePromptItem,
      runtimePromptItem: runtimePromptItem({ id: sourcePromptItem.id, nodeId: node.id }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      turnId: "turn-4",
      deterministicFallbackText: "Placeholder task text.",
      isFirstPromptOfNode: true,
      isFirstPromptOfSession: false,
    });
    expect(result.injectedMemoryIds).toEqual(["MEM-goal", "MEM-hw"]);
  });
});
