import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/shared/protocol/source-fidelity-catalog";
import { compileDialogueContract, SUMMARY_CHECK_FORBIDDEN_PROMPT_ID_LIST, summaryCheckForbiddenFor } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { assembleSummaryCheck } from "@/shared/dialogue-agent/message-composition";
import { validateDialogueDecision } from "@/shared/dialogue-agent/dialogue-output-validator";
import type { DialogueContract, DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { classifyReflectionCheckReply, findPendingReflectionCheck, summaryCheckAlreadyUsedInNode } from "@/shared/runtime/reflection-check";
import type { RuntimeMessage, RuntimeSession } from "@/types/runtime-session";
import type { RuntimePromptItem } from "@/types/protocol-runtime";

// Reflect-and-Confirm (.claude/TASK_SCOPE.json note2026_09_11): the
// assistant may summarize or conclude again, but only through
// summarize_and_confirm, which the server always closes with a fixed
// confirmation question -- and never at a step where the participant must
// form the summary/conclusion themselves.

const TASK_KO = "그 순간 어떤 생각이 머릿속을 스쳐 지나갔나요?";

function baseContract(overrides: Partial<DialogueContract> = {}): DialogueContract {
  return {
    sessionId: "tbct-s03",
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
    lastParticipantMessage: "상사가 저를 무능하다고 생각하는 것 같았어요",
    ...overrides,
  };
}

function summaryDecision(patientFacingMessage: string): DialogueDecision {
  return { responseType: "summarize_and_confirm", patientFacingMessage, keepCurrentNode: true, participantResponseState: "valid_answer" };
}

describe("summarize_and_confirm: the server closes every summary with the confirmation question", () => {
  it("appends the fixed Korean question and reports the summary for the pending check", () => {
    const summary = "상사분이 나를 무능하게 본다고 느끼셨던 거군요.";
    expect(validateDialogueDecision(summaryDecision(summary), baseContract())).toEqual({
      accepted: true,
      finalText: `${summary} 제가 제대로 이해했나요?`,
      summaryCheck: { summaryText: summary },
    });
  });

  it("appends the English question in an English session", () => {
    const contract = baseContract({ locale: "en-US", currentTaskText: "What went through your mind?", lastParticipantMessage: "My boss thinks I'm useless." });
    const result = validateDialogueDecision(summaryDecision("It sounds like you felt your boss sees you as useless."), contract);
    expect(result).toMatchObject({ accepted: true, finalText: "It sounds like you felt your boss sees you as useless. Did I get that right?" });
  });

  it("is rejected outright where summaries are not allowed", () => {
    expect(validateDialogueDecision(summaryDecision("상사분이 나를 무능하게 본다고 느끼셨던 거군요."), baseContract({ summaryCheckAllowed: false }))).toEqual({ accepted: false, reason: "summary_check_not_allowed" });
    expect(validateDialogueDecision(summaryDecision("상사분이 나를 무능하게 본다고 느끼셨던 거군요."), baseContract({ summaryCheckAllowed: undefined }))).toEqual({ accepted: false, reason: "summary_check_not_allowed" });
  });

  it("never lets the summary body ask anything itself -- the confirmation is the turn's only question", () => {
    expect(assembleSummaryCheck("무능하게 보인다고 느끼셨군요. 그때 기분이 어땠어요?", baseContract())).toEqual({ ok: false, reason: "summary_contains_question" });
    expect(assembleSummaryCheck("무능하게 보인다고 느끼셨군요. 그때 많이 불안하셨나요.", baseContract())).toEqual({ ok: false, reason: "summary_contains_question" });
    expect(assembleSummaryCheck("무능하게 보인다고 느끼셨군요. 이제 다음 단계로 갈까요", baseContract())).toEqual({ ok: false, reason: "summary_contains_question" });
  });

  it("never smuggles the held-back task into the summary turn", () => {
    expect(assembleSummaryCheck(`요약하면 이렇습니다. ${TASK_KO.replace("?", "")}`, baseContract())).toEqual({ ok: false, reason: "summary_contains_task" });
  });

  it("keeps an ordinary Korean declarative ending in 니까 (because) as a valid summary", () => {
    expect(assembleSummaryCheck("상사분이 보고서를 고치라고 하셨으니까 무능하게 보였다고 느끼셨군요.", baseContract())).toMatchObject({ ok: true });
  });

  it("rejects an over-long summary", () => {
    expect(assembleSummaryCheck("가".repeat(301), baseContract())).toEqual({ ok: false, reason: "summary_too_long" });
  });

  it("runs the same content-hygiene checks as any free prose on the summary body", () => {
    expect(validateDialogueDecision(summaryDecision("It sounds like you felt your boss sees you as useless."), baseContract())).toEqual({ accepted: false, reason: "locale_mismatch" });
    const english = baseContract({ locale: "en-US", currentTaskText: "What went through your mind?" });
    expect(validateDialogueDecision(summaryDecision("This sounds like generalized anxiety disorder."), english)).toEqual({ accepted: false, reason: "diagnosis_language" });
    expect(validateDialogueDecision(summaryDecision("So your conclusion is [initial conclusion]."), english)).toEqual({ accepted: false, reason: "unresolved_template_variable" });
  });

  it("does not open a free-prose channel for any OTHER patient-content response type", () => {
    const freeProse: DialogueDecision = { responseType: "reflect_and_ask", patientFacingMessage: "상사분이 나를 무능하게 본다고 느끼셨던 거군요. 그 순간 어떤 생각이 머릿속을 스쳐 지나갔나요?", keepCurrentNode: true, participantResponseState: "valid_answer" };
    expect(validateDialogueDecision(freeProse, baseContract({ sessionId: "tbct-s01" }))).toEqual({ accepted: false, reason: "missing_message_parts" });
  });
});

function minimalSession(sessionDefinitionId: string): RuntimeSession {
  return {
    id: "summary-check-session",
    projectId: "TBCT-BR-001",
    protocolId: "tbct-br-001",
    protocolVersion: "1",
    releaseId: "release-1",
    sessionDefinitionId,
    participantId: "summary-check-participant",
    status: "waiting_for_input",
    patientAlias: "Synthetic",
    locale: "ko-KR",
    runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {} },
    messageIds: [],
    executionLogIds: [],
    escalationIds: [],
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  } as RuntimeSession;
}

function runtimePromptItemFor(nodeId: string, overrides: Partial<RuntimePromptItem> = {}): RuntimePromptItem {
  return {
    id: "summary-check-runtime-prompt",
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
    ...overrides,
  };
}

function compileFor(promptItemId: string, options: { summaryCheckAllowed?: boolean; requiresPatientInput?: boolean } = {}) {
  const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id === promptItemId);
  if (!promptItem) throw new Error(`Missing prompt ${promptItemId}`);
  const node = CANONICAL_STAGE_NODES.find((item) => item.id === promptItem.nodeId);
  if (!node) throw new Error(`Missing node for ${promptItemId}`);
  return compileDialogueContract({
    session: minimalSession(promptItem.sessionId),
    node,
    sourcePromptItem: promptItem,
    runtimePromptItem: runtimePromptItemFor(node.id, { requiresPatientInput: options.requiresPatientInput ?? true }),
    recentMessages: [],
    clarificationAttemptCount: 0,
    isFirstPromptOfNode: false,
    isFirstPromptOfSession: false,
    summaryCheckAllowed: options.summaryCheckAllowed ?? true,
  });
}

describe("summarize_and_confirm: where it is allowed", () => {
  it("is allowed on an ordinary question the runtime waits on, and offered as an action", () => {
    const contract = compileFor("tbct-s03-n04-p01-automatic-thought");
    expect(contract.summaryCheckAllowed).toBe(true);
    expect(contract.allowedActions).toContain("summarize_and_confirm");
  });

  it("is not allowed unless the caller allows it (e.g. the clarification path)", () => {
    const contract = compileFor("tbct-s03-n04-p01-automatic-thought", { summaryCheckAllowed: false });
    expect(contract.summaryCheckAllowed).toBe(false);
    expect(contract.allowedActions).not.toContain("summarize_and_confirm");
  });

  it("is not allowed on a prompt the runtime does not wait on -- it would advance straight past the confirmation", () => {
    expect(compileFor("tbct-s03-n04-p01-automatic-thought", { requiresPatientInput: false }).summaryCheckAllowed).toBe(false);
  });

  it.each([
    "tbct-s01-n09-p01-participant-summary",
    "tbct-s03-n08-p03-participant-summary",
    "tbct-s06-n06-p03-participant-capsule-summary",
    "tbct-s06-n10-p05-circuit-two-summary",
  ])("stays forbidden where the participant must summarize themselves (%s: \"Do not summarize -- always ask\")", (promptItemId) => {
    expect(compileFor(promptItemId).summaryCheckAllowed).toBe(false);
  });

  it.each([
    "tbct-s03-n11-p01-balanced-conclusion",
    "tbct-s03-n11-p02-therefore-extension",
    "tbct-s06-n10-p02-patient-formulates-ua",
    "tbct-s07-n06-p02-emotion-to-reason",
    "tbct-s08-n12-p03-participant-therefore",
    "tbct-s08-n14-p04-participant-verdict",
    "tbct-s08-n18-p01-participant-positive-belief",
  ])("stays forbidden at %s", (promptItemId) => {
    expect(compileFor(promptItemId).summaryCheckAllowed).toBe(false);
  });

  it("names only prompts that really exist in the catalog (a typo would silently un-forbid a step)", () => {
    const known = new Set(CANONICAL_PROMPT_ITEMS.map((item) => item.id));
    expect(SUMMARY_CHECK_FORBIDDEN_PROMPT_ID_LIST.filter((id) => !known.has(id))).toEqual([]);
    for (const id of SUMMARY_CHECK_FORBIDDEN_PROMPT_ID_LIST) expect(summaryCheckForbiddenFor(CANONICAL_PROMPT_ITEMS.find((item) => item.id === id)!)).toBe(true);
  });
});

describe("classifyReflectionCheckReply", () => {
  it.each([
    ["네", "affirm"],
    ["네 맞아요", "affirm"],
    ["맞아요!", "affirm"],
    ["정확해요.", "affirm"],
    ["yes", "affirm"],
    ["That's right", "affirm"],
    ["아니요", "deny"],
    ["아뇨.", "deny"],
    ["no", "deny"],
    ["네, 근데 사실 더 불안했어요", "correction"],
    ["네 그리고 화도 났어요", "correction"],
    ["아니요, 사실은 실망했다고 생각했어요", "correction"],
    ["그게 아니라 저를 못 믿는다고 느꼈어요", "correction"],
    ["사실은 상사가 실망했다고 생각했어요", "correction"],
    ["네?", "correction"],
    ["아니면 제가 잘못 말했나봐요", "correction"],
    ["네가 보기엔 어때", "correction"],
  ])("%s -> %s", (reply, expected) => {
    expect(classifyReflectionCheckReply(reply)).toBe(expected);
  });
});

describe("findPendingReflectionCheck", () => {
  const pending = { status: "pending", checkId: "RMSG-1", attempt: 1, summaryText: "요약" };
  const message = (role: RuntimeMessage["role"], metadata?: Record<string, unknown>): RuntimeMessage => ({ id: `${role}-${Math.random()}`, runtimeSessionId: "s", role, content: "x", status: "delivered", createdAt: new Date().toISOString(), metadata } as RuntimeMessage);

  it("finds the check when the last message on screen is the summary turn", () => {
    expect(findPendingReflectionCheck([message("patient"), message("assistant", { reflectionCheck: pending })])).toEqual(pending);
  });

  it("finds nothing once the participant has replied, or when the last assistant turn opened no check", () => {
    expect(findPendingReflectionCheck([message("assistant", { reflectionCheck: pending }), message("patient")])).toBeUndefined();
    expect(findPendingReflectionCheck([message("patient"), message("assistant")])).toBeUndefined();
    expect(findPendingReflectionCheck([])).toBeUndefined();
  });
});

describe("summaryCheckAlreadyUsedInNode: at most one summary check per node", () => {
  const pending = { status: "pending", checkId: "RMSG-1", attempt: 1, summaryText: "요약" };
  const inNode = (nodeId: string, role: RuntimeMessage["role"], metadata?: Record<string, unknown>): RuntimeMessage => ({ id: `${role}-${Math.random()}`, runtimeSessionId: "s", role, nodeId, content: "x", status: "delivered", createdAt: new Date().toISOString(), metadata } as RuntimeMessage);

  it("is true once any check has been opened in the node, even after it was resolved", () => {
    const messages = [inNode("n07", "assistant", { reflectionCheck: pending }), inNode("n07", "patient"), inNode("n07", "assistant", { reflectionCheckResolution: { checkId: "RMSG-1", outcome: "confirmed", summaries: 1 } })];
    expect(summaryCheckAlreadyUsedInNode(messages, "n07")).toBe(true);
  });

  it("is false for another node, and for a node whose turns opened no check", () => {
    const messages = [inNode("n07", "assistant", { reflectionCheck: pending }), inNode("n08", "assistant"), inNode("n08", "patient")];
    expect(summaryCheckAlreadyUsedInNode(messages, "n08")).toBe(false);
    expect(summaryCheckAlreadyUsedInNode([], "n07")).toBe(false);
  });
});
