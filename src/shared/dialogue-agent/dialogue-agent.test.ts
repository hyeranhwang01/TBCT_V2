import { describe, expect, it } from "vitest";
import { dialogueDecisionSchema, type DialogueContract, type DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { DIALOGUE_GUARDS, validateDialogueDecision } from "@/shared/dialogue-agent/dialogue-output-validator";
import { hasUnresolvedTemplateVariable } from "@/shared/dialogue-agent/unresolved-template-detector";
import { fakeDialogueDecision } from "@/test/fakes/dialogue-agent.fake";
import { isDialogueAgentEnabled } from "@/shared/dialogue-agent/dialogue-agent-orchestrator";

function baseContract(overrides: Partial<DialogueContract> = {}): DialogueContract {
  return {
    sessionId: "tbct-s03",
    nodeId: "tbct-s03-n02",
    promptItemId: "tbct-s03-n02-p01-automatic-thought",
    roleId: "tbct_guide",
    therapeuticObjective: "Identify one automatic thought linked to the selected situation.",
    currentTaskText: "What went through your mind in that moment?",
    targetField: "automaticThought",
    expectedConstruct: "A thought, interpretation, prediction, judgment, or meaning. Not an emotion and not a description of the situation.",
    expectedInputType: "free_text",
    isRepeatablePrompt: false,
    nodeRequiresProtectedField: false,
    participantOwned: true,
    assistantMustNotSupply: false,
    worksheetEditAvailable: true,
    confirmedState: { situation: "My partner did not reply to my messages yesterday afternoon." },
    allowedActions: ["acknowledge", "reflect_and_ask", "clarify"],
    forbiddenActions: ["advance_protocol", "supply_participant_answer"],
    recentContext: [],
    safetyStatus: "waiting_for_input",
    locale: "en-US",
    clarificationAttemptCount: 0,
    isFirstPromptOfSession: false,
    isFirstPromptOfNode: false,
    isRoleTransitionPrompt: false,
    ...overrides,
  };
}

describe("dialogue agent scope", () => {
  it("is enabled for all eight sessions", () => {
    for (const id of ["tbct-s01", "tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"]) {
      expect(isDialogueAgentEnabled(id)).toBe(true);
    }
    expect(isDialogueAgentEnabled("tbct-s09")).toBe(false);
  });
});

describe("case 1: participant asks what the current question means", () => {
  it("classifies as question_not_understood and clarifies using the expected construct", () => {
    const contract = baseContract({ lastParticipantMessage: "What do you mean by automatic thought?" });
    const decision = fakeDialogueDecision(contract);
    expect(decision.responseType).toBe("clarify");
    expect(decision.participantResponseState).toBe("question_not_understood");
    expect(decision.patientFacingMessage).toContain(contract.expectedConstruct);
    // Open dialogue v1 (note2026_09_14): Claude's own clarification ships as written.
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, guardLogs: [] });
  });
});

describe("case 2: participant says a required visual/list is missing", () => {
  it("classifies as missing_visual and requests restoring the worksheet", () => {
    const contract = baseContract({ targetField: "cognitiveDistortion", lastParticipantMessage: "I don't see the list of distortions anymore." });
    const decision = fakeDialogueDecision(contract);
    expect(decision.responseType).toBe("show_required_visual");
    expect(decision.participantResponseState).toBe("missing_visual");
    expect(decision.visualAction).toBe("restore_worksheet");
  });
});

describe("case 6: participant asks an in-scope task question", () => {
  it("classifies as participant_question and returns to the current task without changing node", () => {
    const contract = baseContract({ lastParticipantMessage: "Why are you asking me this?" });
    const decision = fakeDialogueDecision(contract);
    expect(decision.participantResponseState).toBe("participant_question");
    expect(decision.keepCurrentNode).toBe(true);
  });
});

describe("case 10: Claude attempts to provide participant-owned content", () => {
  // Open dialogue v1 (.claude/TASK_SCOPE.json note2026_09_14): recorded, not
  // enforced, so later regulation can be based on how often it really happens.
  it("logs an invented value on an assistantMustNotSupply field without blocking the turn", () => {
    const contract = baseContract({ targetField: "participantSummary", assistantMustNotSupply: true, lastParticipantMessage: "okay" });
    const invented: DialogueDecision = { responseType: "reflect_and_ask", patientFacingMessage: "How would you put that into a summary in your own words?", keepCurrentNode: true, participantResponseState: "valid_answer", candidateFieldMention: { field: "participantSummary", value: "you feel anxious because your partner ignored you" } };
    expect(validateDialogueDecision(invented, contract)).toEqual({ accepted: true, guardLogs: ["guard_log:assistant_supplied_participant_owned_content"] });
  });

  it("lets an unflagged free-prose summary through -- the v1 gap live review watches for", () => {
    const contract = baseContract({ targetField: "participantSummary", assistantMustNotSupply: true, lastParticipantMessage: "okay" });
    const invented: DialogueDecision = { responseType: "reflect_and_ask", patientFacingMessage: "Your summary is: you feel anxious because your partner ignored you.", keepCurrentNode: true, participantResponseState: "valid_answer" };
    expect(validateDialogueDecision(invented, contract)).toEqual({ accepted: true, guardLogs: [] });
  });

  it("accepts an honest echo of the participant's own words on the same field", () => {
    const contract = baseContract({ targetField: "participantSummary", assistantMustNotSupply: true, lastParticipantMessage: "I keep avoiding my partner because I think they're mad at me." });
    const honestEcho: DialogueDecision = { responseType: "acknowledge", patientFacingMessage: "Thank you for sharing that.", keepCurrentNode: true, participantResponseState: "valid_answer", candidateFieldMention: { field: "participantSummary", value: "I keep avoiding my partner because I think they're mad at me." } };
    expect(validateDialogueDecision(honestEcho, contract)).toEqual({ accepted: true, guardLogs: [] });
  });
});

describe("case 9: unresolved template variable", () => {
  it("detects a literal bracket placeholder and never lets it through validation", () => {
    expect(hasUnresolvedTemplateVariable("So your conclusion is: '[initial conclusion], therefore [extended conclusion].'")).toBe(true);
    expect(hasUnresolvedTemplateVariable("So your conclusion is: 'things feel manageable now.'")).toBe(false);
    const contract = baseContract();
    const decision = { responseType: "explain_rationale", patientFacingMessage: "And what about [emotion named at Q3a]?", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: false, reason: "unresolved_template_variable", guardLogs: [] });
  });
});

describe("case 11: Claude output schema invalid", () => {
  it("rejects a decision missing required fields via the zod schema", () => {
    const malformed = { responseType: "reflect_and_ask", patientFacingMessage: "ok" }; // missing keepCurrentNode, participantResponseState
    expect(dialogueDecisionSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects an attempt to express keepCurrentNode: false at the schema level", () => {
    const malformed = { responseType: "reflect_and_ask", patientFacingMessage: "ok", keepCurrentNode: false, participantResponseState: "valid_answer" };
    expect(dialogueDecisionSchema.safeParse(malformed).success).toBe(false);
  });
});

describe("guards: what v1 enforces, logs and ignores", () => {
  it("enforces only what would ship a broken message", () => {
    expect(DIALOGUE_GUARDS).toMatchObject({ unresolved_template_variable: "enforce", empty_message: "enforce", message_too_long: "enforce", locale_mismatch: "enforce" });
  });

  it("still rejects a reply in the wrong language", () => {
    const contract = baseContract({ locale: "ko-KR", currentTaskText: "그 순간 어떤 생각이 드셨나요?" });
    const decision = { responseType: "reflect_and_ask", patientFacingMessage: "What went through your mind in that moment?", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toMatchObject({ accepted: false, reason: "locale_mismatch" });
  });

  it("no longer rejects a readiness question on a list task", () => {
    const contract = baseContract({ expectedInputType: "ordered_list", targetField: "problems", currentTaskText: "첫 번째 문제를 말씀해 주세요.", locale: "ko-KR" });
    const decision = { responseType: "explain_rationale", patientFacingMessage: "앞으로 함께 살펴볼 중요한 문제를 하나씩 말씀해 주세요. 준비되셨나요?", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, guardLogs: [] });
  });

  it.each([
    ["diagnosis_language", "This sounds like generalized anxiety disorder."],
    ["unsolicited_treatment_advice", "I recommend seeing a therapist about medication."],
    ["protocol_state_language", "Once this node's completion status is met, we'll advance the protocol."],
    ["ai_self_reference", "As an AI language model, I understand that must be hard."],
  ])("logs %s instead of rejecting", (guard, patientFacingMessage) => {
    const contract = baseContract();
    const decision = { responseType: "explain_rationale", patientFacingMessage, keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, guardLogs: [`guard_log:${guard}`] });
  });
});
