import type { DialogueContract, DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { hasUnresolvedTemplateVariable } from "@/shared/dialogue-agent/unresolved-template-detector";
import { isPatientFacingLocaleConsistent } from "@/shared/runtime/runtime-output-validator";
import { SUMMARY_CHECK_QUESTION } from "@/shared/dialogue-agent/message-composition";

/**
 * Pre-display gate for a dialogue-agent turn.
 *
 * Open dialogue v1 (.claude/TASK_SCOPE.json note2026_09_14_open_dialogue_v1):
 * every check has a mode. "enforce" rejects the turn, and the caller ships
 * the approved deterministic text instead (dialogue-agent-orchestrator.ts);
 * "log" lets the turn through and records `guard_log:<check>` in the turn's
 * validation issues; "off" ignores the check. v1 enforces only what would
 * ship a broken message and logs the clinical wording checks, so regulation
 * can be added back one check at a time, from real transcripts, by changing a
 * mode here.
 */
export type DialogueGuardMode = "off" | "log" | "enforce";

export const DIALOGUE_GUARDS = {
  unresolved_template_variable: "enforce",
  empty_message: "enforce",
  message_too_long: "enforce",
  locale_mismatch: "enforce",
  diagnosis_language: "log",
  unsolicited_treatment_advice: "log",
  protocol_state_language: "log",
  ai_self_reference: "log",
  assistant_supplied_participant_owned_content: "log",
  readiness_question_instead_of_task: "off",
  repeated_identical_message: "off",
} as const satisfies Record<string, DialogueGuardMode>;

export type DialogueGuard = keyof typeof DIALOGUE_GUARDS;

export type DialogueValidationResult =
  // finalText is set only when the shipped text differs from
  // patientFacingMessage (the server appended a confirmation question).
  // summaryCheck is set when the turn ends in a confirmation the runtime must
  // wait for -- runtime-orchestrator.ts opens a pending check from it.
  // missingRequiredSummary: the contract asked for a summary of a long answer
  // and this turn did not give one, so the caller may ask once more.
  | { accepted: true; finalText?: string; summaryCheck?: { summaryText: string }; guardLogs: string[]; missingRequiredSummary?: boolean }
  | { accepted: false; reason: string; guardLogs: string[] };

const DIAGNOSIS_PATTERN = /\b(?:you have|this (?:is|sounds like|indicates)) (?:a |an )?(?:diagnos|disorder|clinical depression|generalized anxiety disorder|bipolar|PTSD|OCD)\b/i;
const TREATMENT_ADVICE_PATTERN = /\b(?:you should (?:take|try)|i recommend (?:medication|therapy|seeing a)|consider (?:medication|antidepressants))\b/i;
const PROTOCOL_STATE_PATTERN = /\b(?:node[-_ ]?id|prompt ?item|runtime state|completion status|advance the protocol|next node|session state)\b/i;
const AI_SELF_REFERENCE_PATTERN = /\b(?:as an ai|i am an ai language model|as a language model)\b/i;
const READINESS_CHECK_PATTERN = /(?:are you ready|ready to (?:begin|continue)|shall we (?:begin|start)|준비되셨나요|준비됐나요|시작할 준비가 되셨나요|괜찮으실까요)\s*[?.!]?\s*$/i;
const QUESTION_ENDING = /(?:[?？]|나요|까요|습니까|는지요|인가요)\s*[.!~]*$/;

function normalizeForRepeatCheck(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Claude reports (candidateFieldMention, logging only) a value for a field
 * the participant must supply that does not echo what they said this turn. */
function suppliesParticipantOwnedContent(decision: DialogueDecision, contract: DialogueContract): boolean {
  const mention = decision.candidateFieldMention;
  if (!contract.assistantMustNotSupply || !mention || mention.field !== contract.targetField) return false;
  const mentionedValue = String(mention.value ?? "").trim().toLowerCase();
  const participantSaid = (contract.lastParticipantMessage ?? "").trim().toLowerCase();
  const isHonestEcho = mentionedValue.length > 0 && participantSaid.length > 0 && (participantSaid.includes(mentionedValue) || mentionedValue.includes(participantSaid));
  return !isHonestEcho;
}

export function validateDialogueDecision(decision: DialogueDecision, contract: DialogueContract): DialogueValidationResult {
  const guardLogs: string[] = [];
  const guard = (name: DialogueGuard, failed: boolean): string | undefined => {
    if (!failed) return undefined;
    const mode: DialogueGuardMode = DIALOGUE_GUARDS[name];
    if (mode === "enforce") return name;
    if (mode === "log") guardLogs.push(`guard_log:${name}`);
    return undefined;
  };
  const text = decision.patientFacingMessage;
  const lastAssistantTurn = [...contract.recentContext].reverse().find((message) => message.role === "assistant");
  const rejection = guard("unresolved_template_variable", hasUnresolvedTemplateVariable(text))
    ?? guard("empty_message", !text.trim())
    ?? guard("message_too_long", text.length > 700)
    // A Korean session must never ship an English reply, or the reverse.
    ?? guard("locale_mismatch", !isPatientFacingLocaleConsistent(text, contract.locale))
    ?? guard("diagnosis_language", DIAGNOSIS_PATTERN.test(text))
    ?? guard("unsolicited_treatment_advice", TREATMENT_ADVICE_PATTERN.test(text))
    ?? guard("protocol_state_language", PROTOCOL_STATE_PATTERN.test(text))
    ?? guard("ai_self_reference", AI_SELF_REFERENCE_PATTERN.test(text))
    ?? guard("readiness_question_instead_of_task", contract.expectedInputType === "ordered_list" && READINESS_CHECK_PATTERN.test(text))
    // A repeat_until / list prompt legitimately repeats near-identical wording.
    ?? guard("repeated_identical_message", !contract.isRepeatablePrompt && lastAssistantTurn !== undefined && normalizeForRepeatCheck(lastAssistantTurn.content) === normalizeForRepeatCheck(text))
    ?? guard("assistant_supplied_participant_owned_content", suppliesParticipantOwnedContent(decision, contract));
  if (rejection) return { accepted: false, reason: rejection, guardLogs };

  // keepCurrentNode is a type-level guarantee (z.literal(true)); checked again
  // defensively in case a future schema change loosens it.
  if (decision.keepCurrentNode !== true) return { accepted: false, reason: "attempted_node_advance", guardLogs };

  // Confirmation re-ask: Claude put the participant's words into its own and
  // asks whether that is right. When this turn can wait for the answer, the
  // task is held until they reply (runtime-orchestrator.ts). If Claude forgot
  // the question itself, the server adds one.
  const confirms = decision.needsConfirmation === true || decision.responseType === "summarize_and_confirm";
  if (confirms && contract.summaryCheckAllowed) {
    const trimmed = text.trim();
    const finalText = QUESTION_ENDING.test(trimmed) ? undefined : `${trimmed} ${SUMMARY_CHECK_QUESTION[contract.locale.toLowerCase().startsWith("ko") ? "ko" : "en"]}`;
    const summaryText = decision.reflectionText?.trim() || trimmed;
    return { accepted: true, ...(finalText ? { finalText } : {}), summaryCheck: { summaryText }, guardLogs };
  }
  if (confirms) guardLogs.push("guard_log:confirmation_not_held");
  return contract.summarizeLastAnswer ? { accepted: true, guardLogs, missingRequiredSummary: true } : { accepted: true, guardLogs };
}
