import type { RuntimeMessage } from "@/types/runtime-session";
import type { LongAnswerSummaryTarget } from "@/shared/runtime/long-answer";

/**
 * Reflect-and-Confirm (.claude/TASK_SCOPE.json note2026_09_11), as changed by
 * open dialogue v1 (note2026_09_14_open_dialogue_v1).
 *
 * When the dialogue agent puts what the participant said into its own words,
 * that turn ends with "is that right?" and holds back the prompt the runtime
 * is waiting on. The participant's NEXT reply therefore answers that question,
 * not the prompt: runtime-execution-api.ts's deliverReflectionCheckReplyTurn
 * handles it, and extractRuntimeState (runtime-context.ts) writes nothing for
 * it. A "no" is answered with "could you tell me again?" and the check repeats
 * until the participant confirms or asks to move on; a confirmed summary of a
 * long answer is then written to that field (src/shared/runtime/long-answer.ts).
 *
 * The open check lives on the assistant message's own metadata rather than
 * in runtimeContext: executeCurrentNode rewrites runtimeContext from a
 * pre-delivery snapshot right after the delivery commits
 * (runtime-execution-api.ts), which would silently drop a flag set there.
 */

export type PendingReflectionCheck = {
  status: "pending";
  /** Id of the assistant message that opened the check; stays the same
   * across a revised summary so every turn of one check can be grouped. */
  checkId: string;
  /** Number of summaries offered so far in this check (1-based). */
  attempt: number;
  summaryText: string;
  /** True right after a bare "no" was answered with "could you tell me again?". */
  askedAgain?: boolean;
  /** The prompt whose answer was summarized (the one before the held-back
   * prompt), for the audit trail. */
  aboutPromptItemId?: string;
  /** Set when the summary is of a long answer: a confirmed summary is written
   * to this field or list item. */
  summaryTarget?: LongAnswerSummaryTarget;
};

export type ReflectionCheckResolution = {
  checkId: string;
  outcome: "confirmed" | "left_as_participant_words";
  summaries: number;
  /** Set when the confirmed summary was written to the record. */
  recordedSummary?: { key: string; writeField: string; listIndex?: number };
};

export type ReflectionCheckReply = "affirm" | "deny" | "correction" | "stop";

function isPendingReflectionCheck(value: unknown): value is PendingReflectionCheck {
  if (!value || typeof value !== "object") return false;
  const check = value as Partial<PendingReflectionCheck>;
  return check.status === "pending" && typeof check.checkId === "string" && typeof check.summaryText === "string" && typeof check.attempt === "number";
}

/** The check the participant is answering right now, if any: only when the
 * very last conversational message is an assistant turn that opened one. If
 * the runtime said anything else in between (a safety or language-switch
 * turn), the confirmation question is no longer the one on screen. */
export function findPendingReflectionCheck(messages: RuntimeMessage[]): PendingReflectionCheck | undefined {
  const last = [...messages].reverse().find((message) => message.role === "patient" || message.role === "assistant");
  if (!last || last.role !== "assistant") return undefined;
  const check = last.metadata?.reflectionCheck;
  return isPendingReflectionCheck(check) ? check : undefined;
}

/** Whether a node already had a summary check. Open dialogue v1 no longer
 * limits checks per node (the user wants confirmation used actively); kept
 * for a later regulation step. Background: the 2026-09-11 mock-Claude audit
 * showed a model summarizing at every allowed turn nearly doubles the
 * conversation (239 -> 462 patient turns across S01-S08). */
export function summaryCheckAlreadyUsedInNode(messages: RuntimeMessage[], nodeId: string): boolean {
  return messages.some((message) => message.role === "assistant" && message.nodeId === nodeId && isPendingReflectionCheck(message.metadata?.reflectionCheck));
}

// Leading token only, and only as a whole word, so "네가" or "아니면" never
// read as an answer. Longer alternatives come first so "아니요" is not cut to
// "아니".
const AFFIRM_PATTERN = /^(?:네\s*맞아요|네\s*맞습니다|맞아요|맞습니다|맞아|맞네요|그렇죠|그래요|그렇습니다|정확해요|정확합니다|네|예|응|yes|yeah|yep|right|correct|exactly|that's right|that is right)(?=$|[\s.,!~])/i;
const DENY_PATTERN = /^(?:아니요|아니오|아니에요|아니야|아뇨|아니|틀렸어요|틀려요|그게\s*아니라|그건\s*아니고|no|nope|not really|not quite|that's not right)(?=$|[\s.,!~])/i;
// "네, 근데..." / "yes, but..." / "네, 그리고..." carry a correction or an
// addition the participant wants heard -- never collapse those into a bare yes.
const QUALIFIER_PATTERN = /(?:근데|그런데|하지만|다만|그렇지만|그치만|그리고|추가로|\bbut\b|\bexcept\b|\bthough\b|\balso\b)/i;
// The participant wants to leave it and go on -- the one way out of a check
// that otherwise repeats until they confirm.
const STOP_PATTERN = /(?:그만\s*(?:할래요|할게요|하고\s*싶어요|하죠|해요|하자)|넘어가(?:요|죠|주세요|자|도\s*돼요|도\s*될까요)|넘어갈게요|다음으로\s*넘어|이대로\s*(?:두고|넘어|진행)|\bskip\b|\bmove on\b|let'?s move on|leave it as it is)/i;

/** "stop" = asks to leave it and move on; "affirm" = a plain yes; "deny" = a
 * bare no with nothing else said; "correction" = anything else, including a
 * yes/no followed by what they actually meant, or a question back ("네?" is
 * confusion, not agreement). */
export function classifyReflectionCheckReply(text: string): ReflectionCheckReply {
  const normalized = text.normalize("NFC").trim().replace(/\s+/g, " ");
  if (STOP_PATTERN.test(normalized)) return "stop";
  if (/[?？]/.test(normalized)) return "correction";
  const affirm = AFFIRM_PATTERN.exec(normalized);
  if (affirm) return QUALIFIER_PATTERN.test(normalized.slice(affirm[0].length)) ? "correction" : "affirm";
  const deny = DENY_PATTERN.exec(normalized);
  if (deny) return normalized.slice(deny[0].length).replace(/[\s.,!~]/g, "").length >= 4 ? "correction" : "deny";
  return "correction";
}

type LocalizedText = { ko: string; en: string };

/** The user's own wording (2026-09-14) for a bare "no". */
export const REFLECTION_ASK_AGAIN: LocalizedText = {
  ko: "그럼 다시 말씀해 주시겠어요?",
  en: "Could you tell me again, in your own words?",
};

export const REFLECTION_MOVE_ON: LocalizedText = {
  ko: "알겠습니다. 말씀해 주신 그대로 두고 다음으로 넘어갈게요.",
  en: "Understood -- I'll leave it exactly as you put it, and we'll move on.",
};

export function reflectionText(text: LocalizedText, locale: string) {
  return locale.toLowerCase().startsWith("ko") ? text.ko : text.en;
}
