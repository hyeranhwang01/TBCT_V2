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
    sessionDefinitionId: "tbct-s01",
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

describe("dialogue contract compiler: generic classification (S01/S02 fields)", () => {
  it("marks a real content field (candidateOneEmotion) as participant-owned and assistantMustNotSupply", () => {
    // S01's Neutral Example was simplified so the automatic thought is
    // stated by the counselor (recorded deterministically via
    // completionEffect) rather than elicited from the participant -- see
    // .claude/TASK_SCOPE.json's note2026_08_17 entry. candidateOneEmotion is
    // now the first genuinely participant-owned field in this node.
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s01" && item.title.includes("First Person"))!;
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.includes("candidate-one-emotion"))!;
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

    expect(contract.targetField).toBe("candidateOneEmotion");
    expect(contract.participantOwned).toBe(true);
    expect(contract.assistantMustNotSupply).toBe(true);
    // S01 now has a reviewed worksheet-binding registry entry (tbct-s01.ts).
    expect(contract.worksheetEditAvailable).toBe(true);
    // Pattern-based terminology should recognize "Emotion" in the field name.
    expect(contract.expectedConstruct).toContain("feeling");
  });

  it("marks an administrative gate field (distortionsIntroductionAcknowledged) as not participant-owned", () => {
    // S01's cognitive-distortions node no longer gates on a physical list
    // (distortionListAvailable/confirm-list removed -- see
    // .claude/TASK_SCOPE.json's note2026_08_17d entry); its remaining
    // administrative field is the intro-distortions delivery marker.
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s01" && item.title.includes("Cognitive Distortions"))!;
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.includes("intro-distortions"))!;
    expect(promptItem.outputFields).toContain("distortionsIntroductionAcknowledged");

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

  it("derives a 0-5 scale from a S02 rating validation kind (max 5), not the S03 percentage scale -- and not the binding's aggregate text_list storage shape either", () => {
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s02" && item.title.includes("Rate Each Problem"))!;
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id.includes("reflect-problem-score"))!;
    // reflect-problem-score's outputFields[0] is "problemRatings", which now
    // has a tbct-s02.ts binding of valueType "text_list" (the worksheet
    // displays every problem's accumulated score at once) -- but this
    // PromptItem re-asks the same rating once per listed problem, so the
    // single-turn expectation is still one 0-5 rating, not an ordered list.

    const contract = compileDialogueContract({
      session: minimalSession({ sessionDefinitionId: "tbct-s02" }),
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
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s01" && item.title.includes("Step 1 - Distinguish Situation"))!;
    // Not outputFields.includes("situationThoughtDistinction") -- this
    // node's own "situation-or-thought" prompt no longer declares that
    // outputField (see source-fidelity-catalog.ts's fix comment on it); it
    // was an unconditional re-ask of the *same* field a genuinely
    // conditional clarification (like specific-moment/emotion-to-thought-redirect)
    // would use, and it silently overwrote the participant's real situation
    // answer with whatever they said in reply to "is that a situation or a
    // thought?" instead. Locate it by slug, same as other tests in this
    // file do for prompts with no output field to search by.
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.nodeId === node.id && item.id.includes("situation-or-thought"))!;

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
    // Gated since note2026_09_11 (every session): the shipped text is the
    // server-assembled worksheet_edit_available connector.
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, finalText: "Of course -- you can edit that directly, and I'll use your updated answer from here on." });
  });

  it("says plainly that it isn't automated yet when the session has no worksheet", () => {
    // Every real TBCT session (s01-s08) now has a reviewed worksheet-binding
    // registry entry, so this exercises the still-real "no worksheet"
    // branch with a session id the registry has never heard of, rather than
    // pretending a real session has no worksheet. The node/promptItem are
    // still a real S01 pair -- compileDialogueContract looks up bindings by
    // session.sessionDefinitionId independently of node.sessionId.
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s01" && item.title.includes("Step 1 - Distinguish Situation"))!;
    // No outputFields on this node's own prompt to search by (see the fix
    // comment on "situation-or-thought" in source-fidelity-catalog.ts) --
    // locate it by slug instead, same as the earlier test in this file does.
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.nodeId === node.id && item.id.includes("situation-or-thought"))!;
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
    // Gated since note2026_09_11 (the contract's sessionId comes from the
    // real S01 node): the shipped text is the worksheet_edit_unavailable connector.
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, finalText: "I hear you. Changing an earlier answer isn't automated in this conversation yet, but let's continue and you can tell me the correction." });
  });
});

describe("transition framing signals (isFirstPromptOfSession / isFirstPromptOfNode / isRoleTransitionPrompt)", () => {
  it("passes isFirstPromptOfSession and isFirstPromptOfNode through as given by the caller", () => {
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s02")!;
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.nodeId === node.id)!;

    const sessionOpening = compileDialogueContract({
      session: minimalSession({ sessionDefinitionId: "tbct-s02" }),
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
      session: minimalSession({ sessionDefinitionId: "tbct-s02" }),
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

    // An ordinary S01 prompt (not a role transition) must not be flagged.
    const ordinaryNode = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s01" && item.title.includes("First Person"))!;
    const ordinaryPrompt = CANONICAL_PROMPT_ITEMS.find((item) => item.id.includes("candidate-one-emotion"))!;
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
    const node = CANONICAL_STAGE_NODES.find((item) => item.sessionId === "tbct-s01" && item.title.includes("Step 1 - Distinguish Situation"))!;
    // No outputFields on this node's own prompt to search by (see the fix
    // comment on "situation-or-thought" in source-fidelity-catalog.ts) --
    // locate it by slug instead, same as the earlier test in this file does.
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.nodeId === node.id && item.id.includes("situation-or-thought"))!;
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
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true });
  });
});
