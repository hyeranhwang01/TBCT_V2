import type { DialogueAgentResult, DialogueContract, DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";

/** Tests put this in a participant message to make the fake answer with a
 * confirmation turn (see fakeDialogueDecision). */
export const SUMMARY_CHECK_TRIGGER = "#요약확인";

/** The summary the fake gives for `said` -- exported so tests can assert the
 * value a confirmed summary writes to the record. */
export function fakeSummaryText(locale: string, said: string) {
  return locale.toLowerCase().startsWith("ko") ? `정리하면: ${said}` : `In short: ${said}`;
}

// Deterministic stand-in for the real Anthropic dialogue agent
// (anthropic-dialogue-agent.ts) -- tests need a REALISTIC classifier (not
// just the constant "provider unavailable" fallback every call would hit in
// a jsdom test environment with no live network), so this applies simple
// keyword heuristics against the participant's message. It exists purely to
// verify the WIRING (runtime correctly logs/uses whatever comes back,
// deterministic engine ignores keepCurrentNode/participantResponseState for
// actual state decisions) -- it is not a substitute for judging real
// dialogue quality, which needs the live model (see the manual S03 QA pass).
export function fakeDialogueDecision(contract: DialogueContract): DialogueDecision {
  const message = (contract.lastParticipantMessage ?? "").trim();
  const lower = message.toLowerCase();

  // Confirmation re-ask (open dialogue v1, note2026_09_14): a real Claude
  // decides for itself when to confirm, and is asked to summarize every long
  // answer. This fake only confirms when a test asks it to (SUMMARY_CHECK_TRIGGER
  // in the participant's message) or when revising a summary the participant
  // corrected -- so every other test's transcript is unchanged.
  if (contract.summaryCheckAllowed && (contract.reflectionCheckContext || message.includes(SUMMARY_CHECK_TRIGGER))) {
    const said = message.replace(SUMMARY_CHECK_TRIGGER, "").trim();
    const reflectionText = fakeSummaryText(contract.locale, said);
    return {
      responseType: "summarize_and_confirm",
      patientFacingMessage: contract.locale.toLowerCase().startsWith("ko") ? `${reflectionText}, 이렇게 이해하면 될까요?` : `${reflectionText} -- did I get that right?`,
      reflectionText,
      needsConfirmation: true,
      keepCurrentNode: true,
      participantResponseState: "valid_answer",
    };
  }

  if (!message) {
    return { responseType: "reflect_and_ask", patientFacingMessage: contract.currentTaskText, keepCurrentNode: true, participantResponseState: "valid_answer" };
  }
  if (/\b(what does .* mean|what do you mean|i don'?t understand|무슨 뜻|이해가 안)\b/i.test(lower)) {
    return {
      responseType: "clarify",
      patientFacingMessage: contract.expectedConstruct ? `By ${contract.targetField ?? "that"}, I mean ${contract.expectedConstruct} ${contract.currentTaskText}` : contract.currentTaskText,
      keepCurrentNode: true,
      participantResponseState: "question_not_understood",
      clarificationReason: "participant_asked_for_definition",
    };
  }
  if (/\b(where'?s the list|i don'?t see the (?:list|options)|missing|목록이 안|안 보여)\b/i.test(lower)) {
    return {
      responseType: "show_required_visual",
      patientFacingMessage: "You're right — let me show that again.",
      keepCurrentNode: true,
      participantResponseState: "missing_visual",
      visualAction: "restore_worksheet",
    };
  }
  if (/\bwhy (?:are you|do you) ask|why does this matter|왜 물어/i.test(lower)) {
    return contract.participantRationale
      ? {
          responseType: "explain_rationale",
          patientFacingMessage: `${contract.participantRationale} ${contract.currentTaskText}`,
          keepCurrentNode: true,
          participantResponseState: "participant_question",
          explanationDepth: "standard",
        }
      : {
          responseType: "repair",
          patientFacingMessage: `This helps us ${contract.therapeuticObjective.toLowerCase()} ${contract.currentTaskText}`,
          keepCurrentNode: true,
          participantResponseState: "participant_question",
        };
  }
  if (/\bpercent|score|number|scale\?/i.test(lower) && contract.scaleExplanation) {
    return {
      responseType: "explain_scale",
      patientFacingMessage: `${contract.scaleExplanation} ${contract.currentTaskText}`,
      keepCurrentNode: true,
      participantResponseState: "question_not_understood",
    };
  }
  if (/\bpause|stop for now|i need a break|잠깐만/i.test(lower)) {
    return { responseType: "acknowledge_pause", patientFacingMessage: "Of course — we can pause here.", keepCurrentNode: true, participantResponseState: "pause_request" };
  }
  if (/\b(i answered that wrong|can i (?:go back|change)|i want to change|correct (?:my|an) (?:earlier|previous) answer|다시 바꾸고 싶어요)\b/i.test(lower)) {
    return {
      responseType: contract.worksheetEditAvailable ? "restore_context" : "clarify",
      patientFacingMessage: contract.worksheetEditAvailable
        ? "Of course — you can edit that directly, and I'll use your updated answer from here on."
        : "I hear you. I don't have a way to change that earlier answer automatically in this conversation yet, but let's continue and you can tell me the correction.",
      keepCurrentNode: true,
      participantResponseState: "revision_request",
    };
  }
  return {
    responseType: "reflect_and_ask",
    patientFacingMessage: contract.currentTaskText,
    keepCurrentNode: true,
    participantResponseState: "valid_answer",
    candidateFieldMention: contract.targetField ? { field: contract.targetField, value: message } : undefined,
  };
}

export function dispatchFakeDialogueAgent(contract: DialogueContract): DialogueAgentResult {
  return { decision: fakeDialogueDecision(contract), provider: "mock", model: "dialogue-agent-fake", latencyMs: 0, failed: false };
}
