import type { RuntimeMessage } from "@/types/runtime-session";
import { MAX_PATIENT_THEMES } from "@/shared/dialogue-agent/counselor-persona";

/**
 * Adaptive dialogue (.claude/TASK_SCOPE.json note2026_09_15_olivia_persona).
 *
 * The program picks the next task before Claude writes a turn, so on its own
 * the conversation always returns to the script. Three things let what the
 * participant says steer it instead, all kept on assistant message metadata
 * (like reflection-check.ts, and for the same reason: executeCurrentNode
 * rewrites runtimeContext from a pre-delivery snapshot):
 *   - pendingExploration: Claude asked a follow-up about what the participant
 *     said while the next task waits. Their reply is not an answer to that
 *     task (runtime-execution-api.ts deliverExplorationReplyTurn).
 *   - patientThemes: the participant's own key phrases, carried across the
 *     session so later steps can build on them. Only words they really said
 *     are kept.
 *   - reflection count: how many confirmations this session has had, given
 *     to Claude as guidance (counselor-persona.ts).
 */

export type PendingExploration = {
  status: "pending";
  /** Id of the assistant message that started this run of exploration turns. */
  explorationId: string;
  /** Consecutive exploration turns for the waiting task, 1-based. */
  turn: number;
  /** The task that waits. */
  forPromptItemId: string;
};

function isPendingExploration(value: unknown): value is PendingExploration {
  if (!value || typeof value !== "object") return false;
  const pending = value as Partial<PendingExploration>;
  return pending.status === "pending" && typeof pending.explorationId === "string" && typeof pending.turn === "number" && typeof pending.forPromptItemId === "string";
}

function lastConversationalMessage(messages: RuntimeMessage[]) {
  return [...messages].reverse().find((message) => message.role === "patient" || message.role === "assistant");
}

/** The exploration question the participant is answering now, if any: only
 * when the last conversational message is the assistant turn that asked it. */
export function findPendingExploration(messages: RuntimeMessage[]): PendingExploration | undefined {
  const last = lastConversationalMessage(messages);
  if (!last || last.role !== "assistant") return undefined;
  const pending = last.metadata?.pendingExploration;
  return isPendingExploration(pending) ? pending : undefined;
}

export function countExplorationTurns(messages: RuntimeMessage[]): number {
  return messages.filter((message) => message.role === "assistant" && isPendingExploration(message.metadata?.pendingExploration)).length;
}

/** Confirmations opened this session: each check once (a revised summary
 * keeps its check's id), and not a proposed record correction. */
export function countReflectionChecks(messages: RuntimeMessage[]): number {
  return messages.filter((message) => {
    const check = message.metadata?.reflectionCheck as { checkId?: unknown; correction?: unknown } | undefined;
    return message.role === "assistant" && check?.checkId === message.id && !check.correction;
  }).length;
}

export function latestPatientThemes(messages: RuntimeMessage[]): string[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const themes = messages[index].metadata?.patientThemes;
    if (messages[index].role === "assistant" && Array.isArray(themes)) return themes.filter((theme): theme is string => typeof theme === "string");
  }
  return [];
}

function quoteKey(text: string) {
  return text.normalize("NFC").toLowerCase().replace(/[\s"'“”‘’`.,!?~…·()[\]-]/g, "");
}

/** The themes the participant really said: each must appear in one of their
 * own messages, ignoring spacing and punctuation. A paraphrase or an
 * interpretation is dropped. */
export function keepVerbatimThemes(themes: string[], participantTexts: string[]): string[] {
  const said = participantTexts.map(quoteKey);
  const kept: string[] = [];
  for (const theme of themes) {
    const text = theme.trim().slice(0, 120);
    const key = quoteKey(text);
    if (key.length < 2 || kept.some((item) => quoteKey(item) === key)) continue;
    if (said.some((message) => message.includes(key))) kept.push(text);
    if (kept.length >= MAX_PATIENT_THEMES) break;
  }
  return kept;
}
