import { describe, expect, it } from "vitest";
import { systemPromptBlocks } from "@/shared/dialogue-agent/anthropic-dialogue-agent";
import { validateDialogueDecision } from "@/shared/dialogue-agent/dialogue-output-validator";
import { PERSONA_DEFINITION } from "@/shared/dialogue-agent/counselor-persona";
import type { DialogueContract, DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";

// Counselor persona (.claude/TASK_SCOPE.json note2026_09_15_olivia_persona):
// what every turn's prompt carries, and how the validator treats an
// exploration question.

const TASK_KO = "요즘 도움을 받고 싶은 어려움이 있으세요?";

function contract(overrides: Partial<DialogueContract> = {}): DialogueContract {
  return {
    sessionId: "tbct-s01",
    nodeId: "test-node",
    promptItemId: "test-prompt",
    roleId: "tbct_guide",
    therapeuticObjective: "Test objective.",
    currentTaskText: TASK_KO,
    expectedInputType: "free_text",
    isRepeatablePrompt: false,
    nodeRequiresProtectedField: false,
    participantOwned: true,
    assistantMustNotSupply: true,
    worksheetEditAvailable: true,
    confirmedState: {},
    allowedActions: [],
    forbiddenActions: [],
    recentContext: [],
    safetyStatus: "waiting_for_input",
    locale: "ko-KR",
    clarificationAttemptCount: 0,
    isFirstPromptOfSession: false,
    isFirstPromptOfNode: false,
    isRoleTransitionPrompt: false,
    summaryCheckAllowed: true,
    lastParticipantMessage: "예전에 중요했던 원칙이 지금은 부질없게 느껴져요",
    ...overrides,
  };
}

const decision = (extra: Partial<DialogueDecision> = {}): DialogueDecision => ({ responseType: "reflect_and_ask", patientFacingMessage: "그 원칙이 부질없게 느껴지기 시작한 건 언제였나요?", keepCurrentNode: true, participantResponseState: "valid_answer", ...extra });

describe("the prompt every turn carries", () => {
  it("opens the cached block with the team's persona, keeping its name internal, and says what outranks what", () => {
    const { stable } = systemPromptBlocks(contract({ sessionToneGuidance: "Ask, do not tell.", sessionProtocolRules: ["Never summarize or describe the cycle."] }));
    expect(stable.startsWith(`Who you are:\n${PERSONA_DEFINITION}`)).toBe(true);
    expect(stable).toContain("do not introduce yourself by name or title");
    expect(stable).toContain("Order of authority");
    expect(stable.indexOf(PERSONA_DEFINITION)).toBeLessThan(stable.indexOf("Never summarize or describe the cycle."));
    expect(stable).not.toContain("experienced TBCT");
  });

  it("tells Claude the confirmation count and the preferred average, as a guide and not a limit", () => {
    const { turn } = systemPromptBlocks(contract({ reflectionsSoFar: 5 }));
    expect(turn).toContain("Confirmations so far this session: 5; about 4 per session on average is preferred (a guide, not a limit)");
    expect(turn).toContain("not after every answer");
    expect(turn).not.toContain("use this actively");
  });

  it("offers an exploration turn only when the task can wait, with the turns used", () => {
    expect(systemPromptBlocks(contract({ explorationAllowed: true, explorationTurns: { step: 1, session: 4 } })).turn).toContain("Exploration turns used: 1 of 2 for this task, 4 of 6 this session");
    expect(systemPromptBlocks(contract({ explorationAllowed: false })).turn).toContain("exploring is not available here");
  });

  it("shows the participant's themes and asks for them back in their own words", () => {
    const { turn } = systemPromptBlocks(contract({ patientThemes: ["훈육에서의 욕심"] }));
    expect(turn).toContain('["훈육에서의 욕심"]');
    expect(turn).toContain("each copied exactly from something the participant said");
  });

  it("no longer sends outside topics to the therapist, and asks for a faithful rewrite when told to", () => {
    const { turn } = systemPromptBlocks(contract({ fidelityFeedback: "자괴감이라는 감정" }));
    expect(turn).not.toContain("suggest bringing it to their therapist");
    expect(turn).not.toContain("claim to be an AI");
    expect(turn).toContain("added meaning the participant did not express (자괴감이라는 감정)");
  });
});

describe("validating an exploration question", () => {
  it("ships it only where the task can wait", () => {
    expect(validateDialogueDecision(decision({ conversationMove: "explore" }), contract({ explorationAllowed: true }))).toEqual({ accepted: true, exploration: true, guardLogs: [] });
    expect(validateDialogueDecision(decision({ conversationMove: "explore" }), contract({ explorationAllowed: false }))).toEqual({ accepted: false, reason: "exploration_not_held", guardLogs: [] });
    expect(validateDialogueDecision(decision({ conversationMove: "advance" }), contract())).toEqual({ accepted: true, guardLogs: [] });
  });

  it("lets a confirmation win when a turn both confirms and explores", () => {
    const both = decision({ conversationMove: "explore", needsConfirmation: true, reflectionText: "원칙이 부질없게 느껴진다", patientFacingMessage: "원칙이 부질없게 느껴지신다는 말씀이 맞으실까요?" });
    expect(validateDialogueDecision(both, contract({ explorationAllowed: true }))).toEqual({ accepted: true, summaryCheck: { summaryText: "원칙이 부질없게 느껴진다" }, guardLogs: [] });
  });
});
