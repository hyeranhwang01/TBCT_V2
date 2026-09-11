import { describe, expect, it } from "vitest";
import { dialogueDecisionSchema, type DialogueContract, type DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { validateDialogueDecision } from "@/shared/dialogue-agent/dialogue-output-validator";
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
    // Every turn is gated since the 2026-09-11 follow-up (note2026_09_11), so
    // what ships is the server-assembled connector + approved task; a real
    // construct definition belongs in explain_term, which stays free prose.
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: true, finalText: `Thank you for sharing that. ${contract.currentTaskText}` });
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
  // Every session is gated now (.claude/TASK_SCOPE.json note2026_09_11), so
  // a protected tbct-s03 turn must submit messageParts; the
  // candidateFieldMention check still applies on top of that.
  it("rejects an invented value on an assistantMustNotSupply field", () => {
    const contract = baseContract({ targetField: "participantSummary", assistantMustNotSupply: true, lastParticipantMessage: "okay" });
    const invented: DialogueDecision = { responseType: "reflect_and_ask", patientFacingMessage: "(ignored once messageParts governs)", keepCurrentNode: true, participantResponseState: "valid_answer", messageParts: [{ kind: "approved_task" }], candidateFieldMention: { field: "participantSummary", value: "you feel anxious because your partner ignored you" } };
    expect(validateDialogueDecision(invented, contract)).toEqual({ accepted: false, reason: "assistant_supplied_participant_owned_content" });
  });

  it("rejects the same invented summary as free prose -- a protected turn cannot ship free prose at all", () => {
    const contract = baseContract({ targetField: "participantSummary", assistantMustNotSupply: true, lastParticipantMessage: "okay" });
    const invented: DialogueDecision = { responseType: "reflect_and_ask", patientFacingMessage: "Your summary is: you feel anxious because your partner ignored you.", keepCurrentNode: true, participantResponseState: "valid_answer" };
    expect(validateDialogueDecision(invented, contract)).toEqual({ accepted: false, reason: "missing_message_parts" });
  });

  it("accepts an honest echo of the participant's own words on the same field", () => {
    const contract = baseContract({ targetField: "participantSummary", assistantMustNotSupply: true, lastParticipantMessage: "I keep avoiding my partner because I think they're mad at me." });
    const honestEcho: DialogueDecision = { responseType: "acknowledge", patientFacingMessage: "(ignored once messageParts governs)", keepCurrentNode: true, participantResponseState: "valid_answer", messageParts: [{ kind: "connector", id: "acknowledge_neutral" }], candidateFieldMention: { field: "participantSummary", value: "I keep avoiding my partner because I think they're mad at me." } };
    expect(validateDialogueDecision(honestEcho, contract)).toEqual({ accepted: true, finalText: "Thank you for sharing that." });
  });
});

describe("case 9: unresolved template variable", () => {
  it("detects a literal bracket placeholder and never lets it through validation", () => {
    expect(hasUnresolvedTemplateVariable("So your conclusion is: '[initial conclusion], therefore [extended conclusion].'")).toBe(true);
    expect(hasUnresolvedTemplateVariable("So your conclusion is: 'things feel manageable now.'")).toBe(false);
    const contract = baseContract();
    const decision = { responseType: "explain_rationale", patientFacingMessage: "And what about [emotion named at Q3a]?", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: false, reason: "unresolved_template_variable" });
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

// Free-prose hygiene now only ever applies to the response types that may
// still carry free prose (explain_* and a summarize_and_confirm body) --
// every other response type is assembled from parts in all eight sessions
// (note2026_09_11) -- so these cases use explain_rationale.
describe("case: banned content categories", () => {
  it("rejects a readiness question appended to a list task", () => {
    const contract = baseContract({ expectedInputType: "ordered_list", targetField: "problems", currentTaskText: "첫 번째 문제를 말씀해 주세요.", locale: "ko-KR" });
    const decision = { responseType: "explain_rationale", patientFacingMessage: "앞으로 함께 살펴볼 중요한 문제를 하나씩 말씀해 주세요. 준비되셨나요?", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: false, reason: "readiness_question_instead_of_task" });
  });
  it("rejects diagnosis language", () => {
    const contract = baseContract();
    const decision = { responseType: "explain_rationale", patientFacingMessage: "This sounds like generalized anxiety disorder.", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: false, reason: "diagnosis_language" });
  });

  it("rejects unsolicited treatment advice", () => {
    const contract = baseContract();
    const decision = { responseType: "explain_rationale", patientFacingMessage: "I recommend seeing a therapist about medication.", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: false, reason: "unsolicited_treatment_advice" });
  });

  it("rejects protocol-state language leaking to the participant", () => {
    const contract = baseContract();
    const decision = { responseType: "explain_rationale", patientFacingMessage: "Once this node's completion status is met, we'll advance the protocol.", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: false, reason: "protocol_state_language" });
  });

  it("rejects AI self-reference", () => {
    const contract = baseContract();
    const decision = { responseType: "explain_rationale", patientFacingMessage: "As an AI language model, I understand that must be hard.", keepCurrentNode: true, participantResponseState: "valid_answer" } as const;
    expect(validateDialogueDecision(decision, contract)).toEqual({ accepted: false, reason: "ai_self_reference" });
  });
});
