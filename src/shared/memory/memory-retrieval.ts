// The retrieval step of a prompt-driven turn (M4, .claude/TASK_SCOPE.json
// note2026_09_27_memory_rag_m3_m7): before each model call, which of the
// participant's earlier-session chunks go into the <program> block.
//
// Order of checks:
//  1. consent (memory-consent.ts) -- declined or undecided: nothing is read,
//     and the record says so;
//  2. candidates: this participant's chunks from earlier sessions, not
//     suppressed;
//  3. chunk-scorer.ts picks at most three.
// The result is logged (memory_chunk_retrievals) against the message the call
// produces.
//
// Also here: the authorship guard. A value the model tries to record that is
// found in what it was shown from earlier sessions (retrieved chunks, or the
// basic bridge) but in nothing the participant said this session is not
// theirs to have said today (Patient Authorship Invariant, note2026_09_05),
// and is rejected.

import { getParticipant } from "@/shared/data/repositories/participant-repository";
import { listMemoryChunks } from "@/shared/data/repositories/memory-chunk-repository";
import { memoryConsentStatus } from "@/shared/memory/memory-consent";
import { MEMORY_INDEX_VERSION, sessionIndexOf } from "@/shared/memory/chunk-builder";
import { RETRIEVAL_ALGORITHM_VERSION, containment, normalizeForMatch, scoreChunks, selectChunks, type ScoredChunk } from "@/shared/memory/chunk-scorer";
import { retrievalAffinityFor } from "@/shared/memory/chunk-configs";
import { sanitizeTags } from "@/shared/memory/memory-tags";
import type { MemoryChunk, MemoryChunkRetrieval, MemoryChunkTags } from "@/types/memory-chunks";

export type TurnRetrieval = {
  record: Omit<MemoryChunkRetrieval, "id" | "messageId" | "createdAt">;
  selected: ScoredChunk[];
  /** Every earlier-session chunk the participant has (consent given), for the
   * authorship guard: what the model was shown on an earlier call of this
   * session is not re-selected on every call, but must stay unrecordable. */
  earlierTexts: string[];
};

const ELEMENT_LABEL: Partial<Record<MemoryChunk["elementKind"], string>> = {
  problem: "difficulty",
  goal: "goal",
  own_case: "their own moment (cognitive model)",
  cycle: "the cycle",
  alternative_thought: "another way to see it",
  distortion_example: "distortion example",
  distortion_priority: "patterns to work on",
  reflection: "in their own words",
  homework: "homework",
  homework_report: "homework report",
  conversation: "conversation",
  clinician_note: "counsellor's note",
};

export async function retrieveForTurn(input: {
  participantId: string;
  runtimeSessionId: string;
  sessionDefinitionId: string;
  queryText: string;
  focusField?: string;
  themes?: unknown;
  opening: boolean;
}): Promise<TurnRetrieval> {
  const participant = await getParticipant(input.participantId);
  const consentState = memoryConsentStatus(participant);
  const themes = input.themes ? sanitizeTags(input.themes) : undefined;
  const query = { text: input.queryText.slice(0, 300), focusField: input.focusField, themes, opening: input.opening };
  const base = { participantId: input.participantId, runtimeSessionId: input.runtimeSessionId, consentState, algorithmVersion: RETRIEVAL_ALGORITHM_VERSION, indexVersion: MEMORY_INDEX_VERSION, query };
  if (consentState !== "granted") return { record: { ...base, candidateCount: 0, selected: [] }, selected: [], earlierTexts: [] };
  const currentSessionIndex = sessionIndexOf(input.sessionDefinitionId);
  // Only the current cut: after an index-version bump the old chunks stay on
  // record but are not candidates beside the new ones.
  const candidates = (await listMemoryChunks(input.participantId, { beforeSessionIndex: currentSessionIndex })).filter((chunk) => chunk.indexVersion === MEMORY_INDEX_VERSION);
  const selected = selectChunks(scoreChunks(candidates, { ...query, currentSessionIndex }, retrievalAffinityFor(input.sessionDefinitionId)));
  return {
    record: { ...base, candidateCount: candidates.length, selected: selected.map((item) => ({ chunkId: item.chunk.id, score: item.score, parts: item.parts })) },
    selected,
    earlierTexts: candidates.map((chunk) => chunk.content),
  };
}

/** The lines the <program> block carries for the retrieved chunks. */
export function retrievalProgramLines(selected: ScoredChunk[]): string[] {
  const own = selected.filter((item) => item.chunk.chunkKind !== "clinician_note");
  const notes = selected.filter((item) => item.chunk.chunkKind === "clinician_note");
  const line = (chunk: MemoryChunk) => {
    const label = ELEMENT_LABEL[chunk.elementKind] ?? chunk.elementKind;
    const session = chunk.sessionIndex > 0 ? `Session ${chunk.sessionIndex}` : "earlier";
    return `- [${session} · ${chunk.sourceCreatedAt.slice(0, 10)} · ${label}] ${chunk.content.replace(/\n/g, " / ")}`;
  };
  const lines: string[] = [];
  if (own.length) {
    lines.push("Earlier sessions, retrieved for this moment (the participant's own words from before, not said today; check whether it still holds before building on it, and never record it as today's answer):");
    lines.push(...own.map((item) => line(item.chunk)));
  }
  if (notes.length) {
    lines.push("Counsellor's note (background for you only; do not quote it to the participant):");
    lines.push(...notes.map((item) => line(item.chunk)));
  }
  return lines;
}

const MIN_GUARDED_CHARS = 6;

/**
 * Field values that came from earlier sessions rather than from the
 * participant this session: found in what the model was shown from before
 * (80% of the value's bigrams) -- the retrieved chunks, and the basic bridge
 * everyone gets -- and in none of this session's participant messages (under
 * 50%).
 */
export function authorshipViolations(updates: Record<string, unknown>, memoryTexts: string[], participantTexts: string[]): Array<{ name: string; reason: string }> {
  const remembered = memoryTexts.filter((text) => text.trim());
  if (!remembered.length) return [];
  const violations: Array<{ name: string; reason: string }> = [];
  for (const [name, value] of Object.entries(updates)) {
    const texts = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && normalizeForMatch(item).length >= MIN_GUARDED_CHARS);
    const borrowed = texts.find((text) => remembered.some((memory) => containment(text, memory) >= 0.8) && participantTexts.every((said) => containment(text, said) < 0.5));
    if (borrowed) violations.push({ name, reason: "matches earlier-session memory and nothing the participant said in this session" });
  }
  return violations;
}

export function emptyThemes(): MemoryChunkTags {
  return { domains: [], persons: [], emotions: [], beliefs: [], distortions: [] };
}

/** The strings the basic bridge (session-continuity.ts, previous* fields)
 * gives the model -- earlier-session content too, for the authorship guard. */
export function bridgeTexts(fields: Record<string, unknown>): string[] {
  return Object.entries(fields)
    .filter(([key]) => key.startsWith("previous"))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string");
}
