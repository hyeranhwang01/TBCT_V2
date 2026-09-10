import type { DialogueContract, DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { hasUnresolvedTemplateVariable } from "@/shared/dialogue-agent/unresolved-template-detector";
import { isPatientFacingLocaleConsistent } from "@/shared/runtime/runtime-output-validator";
import { assembleMessage, requiresAssembledMessage } from "@/shared/dialogue-agent/message-composition";

export type DialogueValidationResult =
  // finalText is present only when assembleMessage produced the shipped
  // text (see requiresAssembledMessage below) -- callers must ship finalText
  // instead of decision.patientFacingMessage whenever it is set, since
  // patientFacingMessage was never trusted or even inspected in that case.
  | { accepted: true; finalText?: string }
  | { accepted: false; reason: string };

const DIAGNOSIS_PATTERN = /\b(?:you have|this (?:is|sounds like|indicates)) (?:a |an )?(?:diagnos|disorder|clinical depression|generalized anxiety disorder|bipolar|PTSD|OCD)\b/i;
const TREATMENT_ADVICE_PATTERN = /\b(?:you should (?:take|try)|i recommend (?:medication|therapy|seeing a)|consider (?:medication|antidepressants))\b/i;
const PROTOCOL_STATE_PATTERN = /\b(?:node[-_ ]?id|prompt ?item|runtime state|completion status|advance the protocol|next node|session state)\b/i;
const AI_SELF_REFERENCE_PATTERN = /\b(?:as an ai|i am an ai language model|as a language model)\b/i;
const READINESS_CHECK_PATTERN = /(?:are you ready|ready to (?:begin|continue)|shall we (?:begin|start)|준비되셨나요|준비됐나요|시작할 준비가 되셨나요|괜찮으실까요)\s*[?.!]?\s*$/i;

function normalizeForRepeatCheck(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Section 15's pre-display gate: everything here is a REFUSAL check, not a
 * rewrite -- if patientFacingMessage fails any of these, the caller falls
 * back to deterministic source-faithful text (dialogue-agent-orchestrator.ts)
 * rather than trying to patch Claude's output. This keeps the guarantee
 * simple: whatever reaches the participant either passed every check here
 * verbatim, or it's the known-safe fallback.
 */
export function validateDialogueDecision(decision: DialogueDecision, contract: DialogueContract): DialogueValidationResult {
  // Patient Authorship Invariant (.claude/TASK_SCOPE.json note2026_09_05,
  // plan file goofy-orbiting-noodle.md Phase 2): for a turn that talks
  // ABOUT a participant-owned field's content, decision.patientFacingMessage
  // is never even inspected below -- a free string cannot be verified
  // against anything, which is exactly how 32 real turns (stored real-Claude
  // transcripts, artifacts/session-fidelity/live-claude-s07-s08/,
  // live-claude/) smoothed, invented, concluded, or supplied content on the
  // participant's behalf without tripping the checks further down (those
  // checks are real content-hygiene rules, not an authorship check). Claude
  // must instead submit messageParts, which the server assembles and
  // independently verifies against real transcript/confirmed-state data --
  // see message-composition.ts's header comment for why this closes the gap
  // a denylist of bad phrases structurally cannot. This branch deliberately
  // skips the free-text hygiene checks below (they would only be checking
  // Claude's now-irrelevant patientFacingMessage guess, never the shipped
  // text) and rejoins the shared candidateFieldMention/keepCurrentNode
  // checks with the server-assembled text instead.
  if (requiresAssembledMessage(contract, decision)) {
    if (!decision.messageParts?.length) return { accepted: false, reason: "missing_message_parts" };
    const assembled = assembleMessage(decision.messageParts, contract);
    if (!assembled.ok) return { accepted: false, reason: assembled.reason };
    return finishValidation(decision, contract, assembled.text);
  }

  const text = decision.patientFacingMessage;

  if (hasUnresolvedTemplateVariable(text)) return { accepted: false, reason: "unresolved_template_variable" };
  if (!text.trim()) return { accepted: false, reason: "empty_message" };
  if (text.length > 700) return { accepted: false, reason: "message_too_long" };
  // The older structured-output validator (runtime-output-validator.ts) has
  // always rejected a locale mismatch -- this dialogue-agent path grew
  // independently and never carried that check over, so a Korean session
  // could silently ship an English Claude reply (or vice versa) with
  // nothing here to catch it before display. (A near-duplicate-message
  // check was considered too, mirroring that same older validator, but a
  // repeat_until prompt -- e.g. "what is one specific example of X
  // evidence?" asked 2-4 times to collect a list -- legitimately repeats
  // near-identical text across iterations, so a blanket duplicate check
  // over recent assistant turns rejects correct behavior; see the
  // simulated-patient audit's fallback counts before ruling this back in.)
  if (!isPatientFacingLocaleConsistent(text, contract.locale)) return { accepted: false, reason: "locale_mismatch" };
  if (DIAGNOSIS_PATTERN.test(text)) return { accepted: false, reason: "diagnosis_language" };
  if (TREATMENT_ADVICE_PATTERN.test(text)) return { accepted: false, reason: "unsolicited_treatment_advice" };
  if (PROTOCOL_STATE_PATTERN.test(text)) return { accepted: false, reason: "protocol_state_language" };
  if (AI_SELF_REFERENCE_PATTERN.test(text)) return { accepted: false, reason: "ai_self_reference" };
  // Widening this to every prompt (not just ordered_list) was tried and
  // reverted: "괜찮으실까요?" in particular is common Korean phrasing inside
  // otherwise-legitimate confirmation questions elsewhere (S06/S07's real
  // check-in moments), and the 8-session simulated audit caught it
  // regressing both to "partial". Left scoped to ordered_list, where the
  // phrase can only ever be decorative filler after a list-collection task.
  if (contract.expectedInputType === "ordered_list" && READINESS_CHECK_PATTERN.test(text)) return { accepted: false, reason: "readiness_question_instead_of_task" };
  // Confirmed live: the model asked "그 상황에서 그 사람이 느낀 감정은
  // 무엇인가요?" twice in a row despite a valid answer to the first ask --
  // the system prompt's own anti-repeat instruction (check recentContext,
  // never send the identical/near-identical message two turns running) is
  // advisory-only with no deterministic backstop. Excludes isRepeatablePrompt
  // (see the comment above isPatientFacingLocaleConsistent and
  // isRepeatablePrompt's own doc comment in dialogue-agent-contract.ts): a
  // repeat_until prompt legitimately repeats near-identical wording across
  // iterations (S02's ordered_list evidence collection, S05's per-contributor
  // re-rating loop, ...), so a blanket check there would reject correct
  // behavior -- confirmed by the 8-session simulated audit regressing S05
  // when this was scoped to expectedInputType==="ordered_list" alone.
  if (!contract.isRepeatablePrompt) {
    const lastAssistantTurn = [...contract.recentContext].reverse().find((message) => message.role === "assistant");
    if (lastAssistantTurn && normalizeForRepeatCheck(lastAssistantTurn.content) === normalizeForRepeatCheck(text)) {
      return { accepted: false, reason: "repeated_identical_message" };
    }
  }

  return finishValidation(decision, contract);
}

/** Shared tail for both the assembled-message path and the free-text path
 * above -- these two checks apply regardless of how patientFacingMessage
 * was produced. finalText is passed through only for the assembled path
 * (see DialogueValidationResult's doc comment). */
function finishValidation(decision: DialogueDecision, contract: DialogueContract, finalText?: string): DialogueValidationResult {
  // "assistantMustNotSupply" fields: Claude may report what the participant
  // themselves said (candidateFieldMention is documented as non-authoritative
  // logging only -- it never reaches extractRuntimeState, which remains the
  // sole writer of this field), but must never hand them an INVENTED value
  // for a field they're supposed to generate themselves (e.g.
  // participantSummary in S03). Distinguish the two by checking the mention
  // actually echoes something the participant said this turn, rather than
  // flagging every mention outright -- that flagged even an honest "the
  // participant just said: ..." log entry as a violation.
  const candidateFieldMention = decision.candidateFieldMention;
  if (contract.assistantMustNotSupply && candidateFieldMention && candidateFieldMention.field === contract.targetField) {
    const mentionedValue = String(candidateFieldMention.value ?? "").trim().toLowerCase();
    const participantSaid = (contract.lastParticipantMessage ?? "").trim().toLowerCase();
    const isHonestEcho = mentionedValue.length > 0 && participantSaid.length > 0 && (participantSaid.includes(mentionedValue) || mentionedValue.includes(participantSaid));
    if (!isHonestEcho) return { accepted: false, reason: "assistant_supplied_participant_owned_content" };
  }

  // keepCurrentNode is a type-level guarantee (z.literal(true)) that this
  // schema can never express "advance" -- checked again here defensively in
  // case a future schema change loosens that.
  if (decision.keepCurrentNode !== true) return { accepted: false, reason: "attempted_node_advance" };

  return finalText !== undefined ? { accepted: true, finalText } : { accepted: true };
}
