// The retrieval step of a prompt-driven turn (M4, .claude/TASK_SCOPE.json
// note2026_09_27_memory_rag_m3_m7): before each model call, which of the
// participant's earlier-session chunks go into the <program> block.
//
// Order of checks:
//  1. consent (memory-consent.ts) -- declined or undecided: nothing is read,
//     and the record says so;
//  2. candidates: this participant's chunks from earlier sessions, not
//     suppressed and not marked invalid by a clinician (the store);
//  3. chunk-scorer.ts (retrieval-v2) filters and picks a few, by layer.
// Each pick is marked when an earlier call of this session already showed it
// (surfacedThisSession) -- metadata for the record and a label for the model,
// never a reason to leave it out (note2026_10_02_memory_rag_v2_phase_a).
// The result is logged (memory_chunk_retrievals) against the message the call
// produces.
//
// The lines put in the <program> block carry the chunks and neutral labels
// only. How the model is to use them (check it still holds, never record it as
// today's answer, never quote a counsellor's note) is the prompt's job (Common
// §7, docs/prompts/TBCT_AI_Prompt_Common.md); repeating it here made two
// sources of the same rule that could drift apart.
//
// Also here: the authorship guard. A value the model tries to record that is
// found in what it was shown from earlier sessions (retrieved chunks, or the
// basic bridge) but in nothing the participant said this session is not
// theirs to have said today (Patient Authorship Invariant, note2026_09_05),
// and is rejected.

import { getParticipant } from "@/shared/data/repositories/participant-repository";
import { listMemoryChunkRetrievals, listMemoryChunks } from "@/shared/data/repositories/memory-chunk-repository";
import { memoryConsentStatus } from "@/shared/memory/memory-consent";
import { MEMORY_INDEX_VERSION, sessionIndexOf } from "@/shared/memory/chunk-builder";
import { RETRIEVAL_ALGORITHM_VERSION, containment, normalizeForMatch, scoreChunks, selectChunks, type ScoredChunk } from "@/shared/memory/chunk-scorer";
import { retrievalSlotsFor } from "@/shared/memory/chunk-configs";
import { sanitizeTags } from "@/shared/memory/memory-tags";
import type { MemoryChunk, MemoryChunkRetrieval, MemoryChunkTags } from "@/types/memory-chunks";

/** A selected chunk, and whether an earlier call of this session showed it. */
export type RetrievedChunk = ScoredChunk & { surfacedThisSession: boolean };

export type TurnRetrieval = {
  record: Omit<MemoryChunkRetrieval, "id" | "messageId" | "createdAt">;
  selected: RetrievedChunk[];
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
  // Of a repeated session, only the official attempt (listMemoryChunks).
  const candidates = (await listMemoryChunks(input.participantId, { beforeSessionIndex: currentSessionIndex, officialAttemptsOnly: true })).filter((chunk) => chunk.indexVersion === MEMORY_INDEX_VERSION);
  const picked = selectChunks(scoreChunks(candidates, { ...query, currentSessionIndex }, retrievalSlotsFor(input.sessionDefinitionId)));
  // What earlier calls of this session showed. Only a label: a failed read
  // leaves every pick unmarked rather than failing the turn.
  const shownBefore = picked.length
    ? new Set((await listMemoryChunkRetrievals(input.runtimeSessionId).catch(() => [])).flatMap((retrieval) => retrieval.selected.map((item) => item.chunkId)))
    : new Set<string>();
  const selected = picked.map((item) => ({ ...item, surfacedThisSession: shownBefore.has(item.chunk.id) }));
  return {
    record: { ...base, candidateCount: candidates.length, selected: selected.map((item) => ({ chunkId: item.chunk.id, score: item.score, parts: item.parts, surfacedThisSession: item.surfacedThisSession })) },
    selected,
    earlierTexts: candidates.map((chunk) => chunk.content),
  };
}

const AUTHOR_LABEL: Record<MemoryChunk["author"], string> = { participant: "participant", clinician: "clinician", system: "program" };

/** The lines the <program> block carries for the retrieved chunks: a neutral
 * header per kind, then one line per chunk labelled [session · date · what it
 * is · who wrote it · "mentioned earlier today" when an earlier call of this
 * session showed it]. No instructions (see the header of this file). */
export function retrievalProgramLines(selected: Array<ScoredChunk & { surfacedThisSession?: boolean }>): string[] {
  const own = selected.filter((item) => item.chunk.chunkKind !== "clinician_note");
  const notes = selected.filter((item) => item.chunk.chunkKind === "clinician_note");
  const line = (item: (typeof selected)[number]) => {
    const chunk = item.chunk;
    const label = ELEMENT_LABEL[chunk.elementKind] ?? chunk.elementKind;
    const session = chunk.sessionIndex > 0 ? `Session ${chunk.sessionIndex}` : "earlier";
    const author = AUTHOR_LABEL[chunk.author] ?? (chunk.chunkKind === "clinician_note" ? "clinician" : "participant");
    const tags = [session, chunk.sourceCreatedAt.slice(0, 10), label, author, ...(item.surfacedThisSession ? ["mentioned earlier today"] : [])];
    return `- [${tags.join(" · ")}] ${chunk.content.replace(/\n/g, " / ")}`;
  };
  const lines: string[] = [];
  if (own.length) {
    lines.push("Earlier-session memory (program note):");
    lines.push(...own.map(line));
  }
  if (notes.length) {
    lines.push("Counsellor's note:");
    lines.push(...notes.map(line));
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
