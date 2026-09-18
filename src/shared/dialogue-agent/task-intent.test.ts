import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/shared/protocol/source-fidelity-catalog";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { generateDialogueDecision, systemPromptBlocks } from "@/shared/dialogue-agent/anthropic-dialogue-agent";
import { resolveDialogueAgentMessage } from "@/shared/dialogue-agent/dialogue-agent-orchestrator";
import { koreanText } from "@/patient/sessions/s01/messages";
import { FAKE_TURN_WITHOUT_INTENT_CONTENT, KEEP_OMITTING_INTENT_CONTENT_TRIGGER, OMIT_INTENT_CONTENT_TRIGGER } from "@/test/fakes/dialogue-agent.fake";
import type { RuntimeSession } from "@/types/runtime-session";
import type { RuntimePromptItem } from "@/types/protocol-runtime";

// Task intents (.claude/TASK_SCOPE.json note2026_09_19_s01_task_intents):
// S01 turns carry what the step must obtain instead of the approved sentence,
// and a turn that leaves out must-include content is written once more, then
// replaced by the approved sentence.

function session(sessionDefinitionId: string, locale = "ko-KR"): RuntimeSession {
  return {
    id: "task-intent-session",
    projectId: "TBCT-BR-001",
    protocolId: "tbct-br-001",
    protocolVersion: "1",
    releaseId: "release-1",
    sessionDefinitionId,
    participantId: "task-intent-participant",
    status: "waiting_for_input",
    patientAlias: "Synthetic",
    locale,
    runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {} },
    messageIds: [],
    executionLogIds: [],
    escalationIds: [],
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  } as RuntimeSession;
}

function runtimePromptItemFor(nodeId: string): RuntimePromptItem {
  return {
    id: "task-intent-runtime-prompt",
    nodeId,
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
  };
}

function promptEndingWith(sessionId: string, suffix: string) {
  const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.sessionId === sessionId && item.id.endsWith(suffix));
  if (!promptItem) throw new Error(`Missing ${sessionId} prompt *${suffix}`);
  const node = CANONICAL_STAGE_NODES.find((item) => item.id === promptItem.nodeId);
  if (!node) throw new Error(`Missing node for ${promptItem.id}`);
  return { promptItem, node };
}

function compile(sessionId: string, suffix: string) {
  const { promptItem, node } = promptEndingWith(sessionId, suffix);
  return compileDialogueContract({
    session: session(sessionId),
    node,
    sourcePromptItem: promptItem,
    runtimePromptItem: runtimePromptItemFor(node.id),
    recentMessages: [],
    clarificationAttemptCount: 0,
    isFirstPromptOfNode: false,
    isFirstPromptOfSession: false,
    currentTaskTextOverride: koreanText[promptItem.id],
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the contract", () => {
  it("carries an S01 step's intent, with its must-include content for this locale", () => {
    const contract = compile("tbct-s01", "-first-emotion-intensity");
    expect(contract.taskIntent?.obtain).toContain("from 0 to 100");
    expect(contract.taskIntent?.mustMention).toHaveLength(1);
    expect(compile("tbct-s01", "-first-emotion").taskIntent?.mustMention).toEqual([]);
  });

  it("has no intent in other sessions, or when switched off", () => {
    const s02 = CANONICAL_PROMPT_ITEMS.find((item) => item.sessionId === "tbct-s02" && item.outputFields.length > 0);
    expect(compile("tbct-s02", s02!.id).taskIntent).toBeUndefined();
    vi.stubEnv("S01_TASK_INTENTS", "off");
    expect(compile("tbct-s01", "-first-emotion-intensity").taskIntent).toBeUndefined();
  });
});

describe("the prompt", () => {
  it("states what the turn must get, and leaves the approved sentence out", () => {
    const contract = compile("tbct-s01", "-representative-difficulty");
    const { turn } = systemPromptBlocks(contract);
    expect(turn).toContain("The current task -- what this turn must get from the participant:");
    expect(turn).toContain("Never ask for a number or a position in a list");
    expect(turn).toContain("there is no script to follow");
    expect(turn).not.toContain(contract.currentTaskText);
  });

  it("is unchanged for a step without an intent", () => {
    vi.stubEnv("S01_TASK_INTENTS", "off");
    const contract = compile("tbct-s01", "-representative-difficulty");
    expect(systemPromptBlocks(contract).turn).toContain(`the wording is yours: ${contract.currentTaskText}`);
  });

  it("names what a rewrite must add", () => {
    const contract = { ...compile("tbct-s01", "-first-emotion-intensity"), intentFeedback: "the scale's two ends" };
    expect(systemPromptBlocks(contract).turn).toContain("left out what it must include: the scale's two ends");
  });

  it("keeps the approved sentence out of the request body too", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("AI_PROVIDER", "");
    const contract = compile("tbct-s01", "-representative-difficulty");
    const original = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.anthropic.com/")) {
        body = String(init?.body ?? "");
        return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_dialogue_decision", input: { responseType: "reflect_and_ask", patientFacingMessage: "그중에서 어떤 게 가장 마음을 무겁게 하세요?", keepCurrentNode: true, participantResponseState: "valid_answer" } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const result = await generateDialogueDecision(contract, { sessionId: "task-intent-session", turnId: "TURN-1" });
      expect(result.failed).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
    expect(body).toContain("must get from the participant");
    expect(body).not.toContain(contract.currentTaskText);
  });
});

describe("must-include content", () => {
  async function resolve(lastParticipantMessage: string) {
    const { promptItem, node } = promptEndingWith("tbct-s01", "-first-emotion-intensity");
    const approved = koreanText[promptItem.id];
    return resolveDialogueAgentMessage({
      session: session("tbct-s01"),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: runtimePromptItemFor(node.id),
      lastParticipantMessage,
      recentMessages: [],
      clarificationAttemptCount: 0,
      turnId: "TURN-1",
      deterministicFallbackText: approved,
      currentTaskTextOverride: approved,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
  }

  it("ships a turn that includes it as written", async () => {
    const result = await resolve("불안했어요");
    expect(result.usedFallback).toBe(false);
    expect(result.guardLogs ?? []).not.toContain("guard_log:task_intent_missing_content");
  });

  it("writes a turn that left it out once more, and ships the rewrite", async () => {
    const result = await resolve(`불안했어요 ${OMIT_INTENT_CONTENT_TRIGGER}`);
    expect(result.usedFallback).toBe(false);
    expect(result.patientMessage).not.toBe(FAKE_TURN_WITHOUT_INTENT_CONTENT.ko);
    expect(result.patientMessage).toMatch(/100/);
    expect(result.guardLogs).toContain("guard_log:task_intent_missing_content");
  });

  it("falls back to the approved sentence when the rewrite leaves it out too", async () => {
    const result = await resolve(`불안했어요 ${KEEP_OMITTING_INTENT_CONTENT_TRIGGER}`);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("task_intent_missing_content");
    expect(result.patientMessage).toBe(koreanText[promptEndingWith("tbct-s01", "-first-emotion-intensity").promptItem.id]);
  });
});
