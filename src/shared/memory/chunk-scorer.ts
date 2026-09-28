// Chooses which of a participant's earlier-session chunks to put in front of
// the model on this call (M4, .claude/TASK_SCOPE.json
// note2026_09_27_memory_rag_m3_m7). Pure and deterministic: the same chunks
// and query always give the same selection, which is what lets a trial
// reconstruct what the model was shown (the chunk ids and this version are
// logged per call).
//
// Four signals, each 0..1:
//  - affinity: how much this kind of chunk matters at this step of this
//    session (the session's config in chunk-configs.ts, keyed by focusField);
//  - tags: overlap between the model's currentThemes and the chunk's tags
//    (plus distortions known from structure);
//  - text: how much of what the participant just said appears in the chunk,
//    by Korean/English character bigrams weighted by rarity across the
//    candidates, so endings like "어요" do not count for much;
//  - recency: the previous session counts most.
// No embeddings (the user's decision, 2026-09-27).

import type { MemoryChunk, MemoryChunkKind, MemoryChunkTags, MemoryElementKind } from "@/types/memory-chunks";
import { TAG_AXIS_NAMES } from "@/shared/memory/memory-tags";

export const RETRIEVAL_ALGORITHM_VERSION = "retrieval-v1";

export const WEIGHTS = { affinity: 3, tags: 2, text: 2, recency: 0.5 } as const;
/** The floor applies to relevance (affinity + tags + text) only. Recency
 * orders chunks that are relevant; it never makes one relevant -- otherwise
 * anything from the previous session would clear the floor. */
export const MIN_RELEVANCE = 1.2;
/** A chunk must also be at least this share as relevant as the best one:
 * three slots are a ceiling, not a quota, and filling them with whatever is
 * loosely on topic crowds the model (gold set, retrieval-eval.ts: 0.6 kept
 * every hit and lifted precision with tags from 0.78 to 0.93). */
export const RELATIVE_CUTOFF = 0.6;
export const MAX_SELECTED = 3;
export const MAX_SELECTED_CHARS = 800;

/** Per session: for each focusField, how much each kind of chunk matters
 * (0..1). "*" applies at every step; OPENING_STEP when the session has not
 * heard from the participant yet. Keys are element kinds or chunk kinds. */
export type RetrievalAffinity = Record<string, Partial<Record<MemoryElementKind | MemoryChunkKind, number>>>;
export const OPENING_STEP = "__opening";

export type RetrievalQuery = {
  text: string;
  focusField?: string;
  themes?: MemoryChunkTags;
  currentSessionIndex: number;
  /** No participant message in this session yet. */
  opening: boolean;
};

export type ScoredChunk = { chunk: MemoryChunk; score: number; relevance: number; parts: { affinity: number; tags: number; text: number; recency: number } };

export function normalizeForMatch(text: string): string {
  return text.replace(/^[QA]: /gm, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function bigrams(text: string): Set<string> {
  const normalized = normalizeForMatch(text);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
  return grams;
}

/** Share of `part`'s bigrams found in `whole` (0..1), unweighted. */
export function containment(part: string, whole: string): number {
  const partGrams = bigrams(part);
  if (!partGrams.size) return 0;
  const wholeGrams = bigrams(whole);
  let found = 0;
  for (const gram of partGrams) if (wholeGrams.has(gram)) found += 1;
  return found / partGrams.size;
}

function affinityOf(chunk: MemoryChunk, query: RetrievalQuery, affinity: RetrievalAffinity): number {
  const steps = [query.opening ? OPENING_STEP : query.focusField, "*"].filter((key): key is string => Boolean(key));
  let best = 0;
  for (const step of steps) {
    const table = affinity[step];
    if (!table) continue;
    best = Math.max(best, table[chunk.elementKind] ?? 0, table[chunk.chunkKind] ?? 0);
  }
  return Math.min(1, best);
}

function tagScore(chunk: MemoryChunk, themes: MemoryChunkTags | undefined): number {
  if (!themes) return 0;
  const chunkTags = chunk.tags ?? null;
  let matches = 0;
  for (const axis of TAG_AXIS_NAMES) {
    const own = new Set([...(chunkTags?.[axis] ?? []), ...(axis === "distortions" ? chunk.distortionIds : [])]);
    // A shared distortion is the strongest link at S02's walkthrough.
    for (const tag of themes[axis] ?? []) if (own.has(tag)) matches += axis === "distortions" ? 2 : 1;
  }
  return Math.min(1, matches / 2);
}

function recencyOf(chunk: MemoryChunk, currentSessionIndex: number): number {
  const gap = Math.max(0, currentSessionIndex - 1 - chunk.sessionIndex);
  return 1 / (1 + gap);
}

export function scoreChunks(chunks: MemoryChunk[], query: RetrievalQuery, affinity: RetrievalAffinity): ScoredChunk[] {
  const candidates = chunks.filter((chunk) => !chunk.suppressed && chunk.sessionIndex < query.currentSessionIndex);
  // Rarity weights over this participant's candidates: a bigram in every chunk
  // says nothing about which one is meant.
  const chunkGrams = new Map(candidates.map((chunk) => [chunk.id, bigrams(chunk.content)]));
  const documentFrequency = new Map<string, number>();
  for (const grams of chunkGrams.values()) for (const gram of grams) documentFrequency.set(gram, (documentFrequency.get(gram) ?? 0) + 1);
  const weight = (gram: string) => Math.log(1 + (candidates.length + 1) / (1 + (documentFrequency.get(gram) ?? 0)));
  const queryGrams = [...bigrams(query.text)];
  const queryWeight = queryGrams.reduce((sum, gram) => sum + weight(gram), 0);

  return candidates.map((chunk) => {
    const grams = chunkGrams.get(chunk.id)!;
    const text = queryWeight > 0 ? queryGrams.reduce((sum, gram) => sum + (grams.has(gram) ? weight(gram) : 0), 0) / queryWeight : 0;
    const parts = { affinity: affinityOf(chunk, query, affinity), tags: tagScore(chunk, query.themes), text, recency: recencyOf(chunk, query.currentSessionIndex) };
    const relevance = WEIGHTS.affinity * parts.affinity + WEIGHTS.tags * parts.tags + WEIGHTS.text * parts.text;
    const score = relevance + WEIGHTS.recency * parts.recency;
    return { chunk, score: round(score), relevance: round(relevance), parts: { affinity: round(parts.affinity), tags: round(parts.tags), text: round(parts.text), recency: round(parts.recency) } };
  });
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Relevant chunks only (MIN_RELEVANCE, and RELATIVE_CUTOFF of the best),
 * highest score first (ties: the later session, then the id), at most
 * MAX_SELECTED and MAX_SELECTED_CHARS. At most one clinician note. */
export function selectChunks(scored: ScoredChunk[]): ScoredChunk[] {
  const best = Math.max(0, ...scored.map((item) => item.relevance));
  const ranked = scored
    .filter((item) => item.relevance >= MIN_RELEVANCE && item.relevance >= RELATIVE_CUTOFF * best)
    .sort((left, right) => right.score - left.score || right.chunk.sessionIndex - left.chunk.sessionIndex || left.chunk.id.localeCompare(right.chunk.id));
  const selected: ScoredChunk[] = [];
  let chars = 0;
  for (const item of ranked) {
    if (selected.length >= MAX_SELECTED) break;
    // The best chunk always fits (a chunk is at most MAX_CHUNK_CHARS); the
    // budget limits what is added to it.
    if (selected.length && chars + item.chunk.content.length > MAX_SELECTED_CHARS) continue;
    if (item.chunk.chunkKind === "clinician_note" && selected.some((other) => other.chunk.chunkKind === "clinician_note")) continue;
    selected.push(item);
    chars += item.chunk.content.length;
  }
  return selected;
}
