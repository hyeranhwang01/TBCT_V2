import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/shared/protocol/source-fidelity-catalog";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { resolveDialogueAgentMessage } from "@/shared/dialogue-agent/dialogue-agent-orchestrator";
import { fakeDialogueDecision } from "@/test/fakes/dialogue-agent.fake";
import { validateDialogueDecision } from "@/shared/dialogue-agent/dialogue-output-validator";
import type { RuntimeSession } from "@/types/runtime-session";
import type { RuntimePromptItem } from "@/types/protocol-runtime";

// Sessions 1-2 now have worksheet-binding registry entries too (see
// worksheet-binding-registry.ts), but these tests still exercise
// dialogue-contract-compiler.ts's GENERIC fallback classification (derived
// from PromptItem.validation + field-name shape) for whichever signal
// should actually win for a given field: a plain-text field still falls
// through to the pattern-based terminology lookup, and a repeated
// per-turn rating (S02's problemRatings) still resolves to "integer_0_5"
// from the PromptItem's own validation even though the binding's valueType
// is the aggregate-storage "text_list" -- see
// VALIDATION_KINDS_AUTHORITATIVE_OVER_BINDING's header comment for why.

function minimalSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: "session-1",
    projectId: "TBCT-BR-001",
    protocolId: "tbct-br-001",
    protocolVersion: "1",
    releaseId: "release-1",
    sessionDefinitionId: "tbct-s03",
    participantId: "participant-1",
    status: "waiting_for_input",
    patientAlias: "Synthetic",
    locale: "en-US",
    runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {} },
    ...overrides,
  } as RuntimeSession;
}

function minimalRuntimePromptItem(overrides: Partial<RuntimePromptItem> = {}): RuntimePromptItem {
  return {
    id: "runtime-prompt-1",
    nodeId: "node-1",
    roleId: "tbct_guide",
    scope: "node",
    sequenceIndex: 1,
    executionMode: "serial",
    modelGuidance: "",
    fallbackPatientText: "What went through your mind in that moment?",
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

// S01 and S02 are prompt-driven (note2026_09_25_prompt_driven_s01_s02) and
// never compile a dialogue contract, so the generic cases below use S03.
function s03Prompt(slug: string) {
  const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.sessionId === "tbct-s03" && item.id.endsWith(`-${slug}`))!;
  const node = CANONICAL_STAGE_NODES.find((item) => item.id === promptItem.nodeId)!;
  return { node, promptItem };
}
// No S03-S08 node carries a participantRationale; the mechanism is generic, so
// the rationale is set on a real S03 node here.
const RATIONALE = "Picking one concrete moment helps separate what actually happened from the thought your mind added about it.";

describe("dialogue contract compiler: generic classification", () => {
  it("marks a real content field (primaryEmotion) as participant-owned and assistantMustNotSupply", () => {
    const { node, promptItem } = s03Prompt("primary-emotion");
    expect(node).toBeDefined();
    expect(promptItem).toBeDefined();

    const contract = compileDialogueContract({
      session: minimalSession(),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id, fallbackPatientText: promptItem.fallbackPatientText ?? "What comes to mind?" }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });

    expect(contract.targetField).toBe("primaryEmotion");
    expect(contract.participantOwned).toBe(true);
    expect(contract.assistantMustNotSupply).toBe(true);
    // S03 has a reviewed worksheet-binding registry entry.
    expect(contract.worksheetEditAvailable).toBe(true);
    // Pattern-based terminology should recognize "Emotion" in the field name.
    expect(contract.expectedConstruct).toContain("feeling");
  });

  it("marks an administrative gate field (redirectionContractAcknowledged) as not participant-owned", () => {
    const { node, promptItem } = s03Prompt("redirection-contract");
    expect(promptItem.outputFields).toContain("redirectionContractAcknowledged");

    const contract = compileDialogueContract({
      session: minimalSession(),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });

    expect(contract.participantOwned).toBe(false);
    expect(contract.assistantMustNotSupply).toBe(false);
  });

  it("derives a 0-5 scale from a rating validation kind (max 5), not the S03 percentage scale", () => {
    // Was S02's reflect-problem-score until that session was redesigned
    // (note2026_09_21_s02_cognitive_distortions), which also removed the only
    // rating-kind prompt in the catalog whose field is bound as text_list --
    // so the "not the binding's aggregate storage shape either" half of this
    // check no longer has a case to exercise. S06's calibration anchor is the
    // remaining rating-kind prompt with max 5.
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s06" && item.promptItemIds.some((id) => id.includes("calibration-anchor")))!;
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.includes("calibration-anchor"))!;

    const contract = compileDialogueContract({
      session: minimalSession({ sessionDefinitionId: "tbct-s06" }),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });

    expect(contract.expectedInputType).toBe("integer_0_5");
    expect(contract.scaleExplanation).toMatch(/0 means/);
    expect(contract.scaleExplanation).not.toContain("100");
  });

  it("carries the node's participantRationale through to the contract", () => {
    const { node: q1, promptItem } = s03Prompt("describe-situation");
    const node = { ...q1, participantRationale: RATIONALE };
    const contract = compileDialogueContract({
      session: minimalSession(),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });

    expect(contract.participantRationale).toContain("separate what actually happened");
  });
});

describe("safety-critical prompts are excluded from the dialogue agent", () => {
  it("never calls Claude for the S03 safety-check prompt, and does not count as a fallback", async () => {
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s03" && item.title === "Safety Protocol")!;
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.includes("safety-check"))!;
    expect(promptItem.safetyRuleIds.length).toBeGreaterThan(0);

    const result = await resolveDialogueAgentMessage({
      session: minimalSession({ sessionDefinitionId: "tbct-s03" }),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id, fallbackPatientText: "Before we start, how are you doing today?" }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      turnId: "turn-1",
      deterministicFallbackText: "Before we start, how are you doing today?",
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });

    expect(result.decision).toBeNull();
    expect(result.usedFallback).toBe(false);
    expect(result.excludedBySafety).toBe(true);
    expect(result.patientMessage).toBe("Before we start, how are you doing today?");
  });
});

describe("revision_request: honest handling depends on worksheetEditAvailable", () => {
  it("points to the real worksheet-edit path when the session has one (S03)", () => {
    const contract = compileDialogueContract({
      session: minimalSession({ sessionDefinitionId: "tbct-s03" }),
      node: CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s03" && item.id.includes("q1"))!,
      sourcePromptItem: CANONICAL_PROMPT_ITEMS.find((item) => item.sessionId === "tbct-s03" && item.outputFields.includes("situation"))!,
      runtimePromptItem: minimalRuntimePromptItem({}),
      lastParticipantMessage: "Actually, can I go back and change what I said earlier?",
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    expect(contract.worksheetEditAvailable).toBe(true);
    const decision = fakeDialogueDecision(contract);
    expect(decision.participantResponseState).toBe("revision_request");
    expect(decision.patientFacingMessage).toContain("edit");
    // Open dialogue v1 (note2026_09_14): Claude's own reply ships as written.
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, guardLogs: [] });
  });

  it("says plainly that it isn't automated yet when the session has no worksheet", () => {
    // Every real TBCT session (s01-s08) now has a reviewed worksheet-binding
    // registry entry, so this exercises the still-real "no worksheet"
    // branch with a session id the registry has never heard of, rather than
    // pretending a real session has no worksheet. The node/promptItem are
    // still a real S03 pair -- compileDialogueContract looks up bindings by
    // session.sessionDefinitionId independently of node.sessionId.
    const { node, promptItem } = s03Prompt("describe-situation");
    const contract = compileDialogueContract({
      session: minimalSession({ sessionDefinitionId: "unregistered-session-definition" }),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id }),
      lastParticipantMessage: "I want to change my earlier answer.",
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    expect(contract.worksheetEditAvailable).toBe(false);
    const decision = fakeDialogueDecision(contract);
    expect(decision.participantResponseState).toBe("revision_request");
    expect(decision.patientFacingMessage).toMatch(/isn't automated|don't have a way/);
    // Open dialogue v1 (note2026_09_14): Claude's own reply ships as written.
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, guardLogs: [] });
  });
});

describe("transition framing signals (isFirstPromptOfSession / isFirstPromptOfNode / isRoleTransitionPrompt)", () => {
  it("passes isFirstPromptOfSession and isFirstPromptOfNode through as given by the caller", () => {
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s03")!;
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.nodeId === node.id)!;

    const sessionOpening = compileDialogueContract({
      session: minimalSession({ sessionDefinitionId: "tbct-s03" }),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: true,
      isFirstPromptOfSession: true,
    });
    expect(sessionOpening.isFirstPromptOfSession).toBe(true);
    expect(sessionOpening.isFirstPromptOfNode).toBe(true);

    const midSessionTurn = compileDialogueContract({
      session: minimalSession({ sessionDefinitionId: "tbct-s03" }),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    expect(midSessionTurn.isFirstPromptOfSession).toBe(false);
    expect(midSessionTurn.isFirstPromptOfNode).toBe(false);
  });

  it("derives isRoleTransitionPrompt from the prompt's own type, not a caller-supplied flag", () => {
    // S07's chair-arrangement prompt is authored as type: "role_transition"
    // (the empty-chair Emotion/Reason move) -- see source-fidelity-catalog.ts.
    const roleTransitionPrompt = CANONICAL_PROMPT_ITEMS.find((item) => item.sessionId === "tbct-s07" && item.type === "role_transition")!;
    expect(roleTransitionPrompt).toBeDefined();
    const roleTransitionNode = CANONICAL_STAGE_NODES.find((item) => item.id === roleTransitionPrompt.nodeId)!;

    const roleTransitionContract = compileDialogueContract({
      session: minimalSession({ sessionDefinitionId: "tbct-s07" }),
      node: roleTransitionNode,
      sourcePromptItem: roleTransitionPrompt,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: roleTransitionNode.id }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: true,
      isFirstPromptOfSession: false,
    });
    expect(roleTransitionContract.isRoleTransitionPrompt).toBe(true);

    // An ordinary S03 prompt (not a role transition) must not be flagged.
    const { node: ordinaryNode, promptItem: ordinaryPrompt } = s03Prompt("primary-emotion");
    const ordinaryContract = compileDialogueContract({
      session: minimalSession(),
      node: ordinaryNode,
      sourcePromptItem: ordinaryPrompt,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: ordinaryNode.id }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    expect(ordinaryContract.isRoleTransitionPrompt).toBe(false);
  });
});

describe("explain_rationale: answers 'why are you asking this' using the node's own rationale", () => {
  it("uses participantRationale instead of the generic objective-based repair when one exists", () => {
    const { node: q1, promptItem } = s03Prompt("describe-situation");
    const node = { ...q1, participantRationale: RATIONALE };
    const contract = compileDialogueContract({
      session: minimalSession(),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id }),
      lastParticipantMessage: "Why are you asking me this?",
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    const decision = fakeDialogueDecision(contract);
    expect(decision.responseType).toBe("explain_rationale");
    expect(decision.patientFacingMessage).toContain("separate what actually happened");
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, guardLogs: [] });
  });
});
