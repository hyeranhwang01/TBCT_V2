// Chooses which of a participant's earlier-session chunks to put in front of
// the model on this call. Pure and deterministic: the same chunks and query
// always give the same selection, which is what lets a trial reconstruct what
// the model was shown (the chunk ids and this version are logged per call).
// No embeddings (the user's decision, 2026-09-27).
//
// retrieval-v2 (.claude/TASK_SCOPE.json note2026_10_02_memory_rag_v2_phase_a;
// v1 is kept for comparison in eval/scorer-v1.ts). In order:
//  1. filters -- never offered: a chunk from this session or later, a
//     suppressed one, one a clinician marked invalid (the store leaves those
//     out; checked here again), one the safety code flagged
//     (sensitivityFlags), and an interpretation deeper than the session's
//     TBCT level (session-levels.ts). The participant's own words are never
//     gated by level.
//  2. fixed slots -- per session and step (chunk-configs.ts), the kinds of
//     chunk the step is about, offered whatever their relevance (S02's
//     opening and homework report: last week's homework). Replaces v1's
//     step-affinity weight, which made a chunk "relevant" for being of the
//     right kind.
//  3. relevance = 2 x tags + 1 x text. tags: the share of the model's
//     currentThemes the chunk's tags carry on CHUNK_TAG_AXES (no core-belief
//     categories), with distortions known from structure; text: how much of
//     what the participant just said appears in the chunk, by character
//     bigrams weighted by rarity across the candidates, so endings like
//     "어요" count for little.
//  4. recency by session index, max(RECENCY_FLOOR, 1/(1+gap)), weight 0.5.
//     It orders what is relevant; it never makes a chunk relevant.
//  5. selection -- above MIN_RELEVANCE and RELATIVE_CUTOFF of the best;
//     per-layer quotas (LAYER_QUOTAS) under a total cap and a character
//     budget; a chunk mostly contained in one already chosen is skipped.
// No penalty for having been shown on an earlier call of the session: what
// fits the moment fits it again; memory-retrieval.ts only marks it.

import type { MemoryChunk, MemoryChunkKind, MemoryChunkLayer, MemoryChunkTags, MemoryElementKind } from "@/types/memory-chunks";
import { CHUNK_TAG_AXES } from "@/shared/memory/memory-tags";
import { levelForSession } from "@/shared/memory/session-levels";

export const RETRIEVAL_ALGORITHM_VERSION = "retrieval-v2";

export const WEIGHTS = { tags: 2, text: 1, recency: 0.5 } as const;
/** The floor applies to relevance (tags + text) only; recency never makes a
 * chunk relevant. 0.5, recalibrated on the gold set (eval/retrieval-eval.ts)
 * for v2's weights: on wording alone the highest-scoring small talk reached
 * 0.31 and the lowest right chunk said in the same words 0.54; 0.6 lost that
 * hit, 0.4 changed nothing. On tags it takes a quarter of the themes. */
export const MIN_RELEVANCE = 0.5;
/** A chunk must also be at least this share as relevant as the best one: the
 * quotas are a ceiling, not a target, and filling them with whatever is
 * loosely on topic crowds the model. */
export const RELATIVE_CUTOFF = 0.6;
/** Recency of a chunk from long ago never drops below this. A design
 * parameter, not fitted: by S8 the S1 moment is six sessions back, and 1/7
 * would make it count for almost nothing against last week's small talk,
 * while the book keeps returning to the first case conceptualisation. 0.3 is
 * where a gap of about two sessions lands (1/3), so the ordering still
 * prefers the last two sessions and flattens after that. */
export const RECENCY_FLOOR = 0.3;
/** Per layer, at most this many chunks in one call (sql/043 layers). Raw
 * episodes and records are the participant's own words; one interpretation
 * (Phase B) and one counsellor's note at most, so neither outweighs them. */
export const LAYER_QUOTAS: Record<MemoryChunkLayer, number> = { raw: 2, record: 2, interpretation: 1, clinician_note: 1 };
/** Total cap over all layers (the evaluation also tries 3 and 8). */
export const MAX_SELECTED = 5;
export const MAX_SELECTED_CHARS = 800;
/** A candidate with this share of its bigrams in a chunk already chosen adds
 * nothing (the same moment as worksheet value and as conversation). */
export const DUPLICATE_CONTAINMENT = 0.8;

/** Per session: for each focusField, the kinds of chunk the step is about,
 * offered whatever their relevance (still filtered, still within the quotas
 * and the budget). OPENING_STEP when the session has not heard from the
 * participant yet. Keys of the lists are element kinds or chunk kinds. */
export type RetrievalSlots = Record<string, ReadonlyArray<MemoryElementKind | MemoryChunkKind>>;
export const OPENING_STEP = "__opening";

export type RetrievalQuery = {
  text: string;
  focusField?: string;
  themes?: MemoryChunkTags;
  currentSessionIndex: number;
  /** No participant message in this session yet. */
  opening: boolean;
};

/** For the evaluation's ablations only; the runtime uses the defaults. */
export type RetrievalOptions = { maxSelected?: number; filters?: boolean };

export type ScoredChunk = {
  chunk: MemoryChunk;
  score: number;
  relevance: number;
  parts: { slot: number; tags: number; text: number; recency: number };
};

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

/** A chunk's layer; a chunk object from before sql/043 has none, and its
 * kind says which it is. */
export function layerOf(chunk: MemoryChunk): MemoryChunkLayer {
  if (chunk.layer) return chunk.layer;
  if (chunk.chunkKind === "clinician_note") return "clinician_note";
  return chunk.chunkKind === "episode" ? "raw" : "record";
}

/** Why a chunk may never be offered in this session, or null. */
export function exclusionReason(chunk: MemoryChunk, currentSessionIndex: number): "invalid" | "sensitive" | "level" | null {
  if (chunk.validity?.state === "invalid") return "invalid";
  if ((chunk.sensitivityFlags ?? []).length) return "sensitive";
  // An interpretation with no level recorded is treated as the deepest:
  // nothing says it is safe to show early.
  if (layerOf(chunk) === "interpretation" && (chunk.cognitiveLevel ?? 3) > levelForSession(currentSessionIndex)) return "level";
  return null;
}

function slotOf(chunk: MemoryChunk, query: RetrievalQuery, slots: RetrievalSlots): number {
  const step = query.opening ? OPENING_STEP : query.focusField;
  const kinds = step ? slots[step] : undefined;
  return kinds && (kinds.includes(chunk.elementKind) || kinds.includes(chunk.chunkKind)) ? 1 : 0;
}

/** The share of the current themes the chunk carries (0..1), a shared
 * distortion counting double -- it is the strongest link at S02's
 * walkthrough. v1 capped two matches at 1, which made every chunk sharing a
 * domain and a person with the moment as relevant as the one that also
 * shares the distortion; with no step affinity left to tell them apart,
 * that tie filled the quotas (gold set: precision 0.78 capped, 0.88 as a
 * share). */
function tagScore(chunk: MemoryChunk, themes: MemoryChunkTags | undefined): number {
  if (!themes) return 0;
  const chunkTags = chunk.tags ?? null;
  let matched = 0;
  let total = 0;
  for (const axis of CHUNK_TAG_AXES) {
    const weight = axis === "distortions" ? 2 : 1;
    const own = new Set([...(chunkTags?.[axis] ?? []), ...(axis === "distortions" ? chunk.distortionIds : [])]);
    for (const tag of themes[axis] ?? []) {
      total += weight;
      if (own.has(tag)) matched += weight;
    }
  }
  return total ? matched / total : 0;
}

function recencyOf(chunk: MemoryChunk, currentSessionIndex: number): number {
  const gap = Math.max(0, currentSessionIndex - 1 - chunk.sessionIndex);
  return Math.max(RECENCY_FLOOR, 1 / (1 + gap));
}

export function scoreChunks(chunks: MemoryChunk[], query: RetrievalQuery, slots: RetrievalSlots = {}, options: RetrievalOptions = {}): ScoredChunk[] {
  const filters = options.filters ?? true;
  const candidates = chunks.filter((chunk) => !chunk.suppressed && chunk.sessionIndex < query.currentSessionIndex && (!filters || !exclusionReason(chunk, query.currentSessionIndex)));
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
    const parts = { slot: slotOf(chunk, query, slots), tags: tagScore(chunk, query.themes), text, recency: recencyOf(chunk, query.currentSessionIndex) };
    const relevance = WEIGHTS.tags * parts.tags + WEIGHTS.text * parts.text;
    const score = relevance + WEIGHTS.recency * parts.recency;
    return { chunk, score: round(score), relevance: round(relevance), parts: { slot: parts.slot, tags: round(parts.tags), text: round(parts.text), recency: round(parts.recency) } };
  });
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Fixed-slot chunks first, then relevant ones (MIN_RELEVANCE, and
 * RELATIVE_CUTOFF of the best), each highest score first (ties: the later
 * session, then the id); within LAYER_QUOTAS, the total cap and
 * MAX_SELECTED_CHARS; skipping near-duplicates of what is already chosen. */
export function selectChunks(scored: ScoredChunk[], options: RetrievalOptions = {}): ScoredChunk[] {
  const maxSelected = options.maxSelected ?? MAX_SELECTED;
  const best = Math.max(0, ...scored.map((item) => item.relevance));
  const byScore = (left: ScoredChunk, right: ScoredChunk) => right.score - left.score || right.chunk.sessionIndex - left.chunk.sessionIndex || left.chunk.id.localeCompare(right.chunk.id);
  const fixed = scored.filter((item) => item.parts.slot > 0).sort(byScore);
  const relevant = scored.filter((item) => item.parts.slot === 0 && item.relevance >= MIN_RELEVANCE && item.relevance >= RELATIVE_CUTOFF * best).sort(byScore);
  const selected: ScoredChunk[] = [];
  const perLayer = new Map<MemoryChunkLayer, number>();
  let chars = 0;
  for (const item of [...fixed, ...relevant]) {
    if (selected.length >= maxSelected) break;
    const layer = layerOf(item.chunk);
    if ((perLayer.get(layer) ?? 0) >= LAYER_QUOTAS[layer]) continue;
    // The first chunk always fits (a chunk is at most MAX_CHUNK_CHARS); the
    // budget limits what is added to it.
    if (selected.length && chars + item.chunk.content.length > MAX_SELECTED_CHARS) continue;
    if (selected.some((other) => containment(item.chunk.content, other.chunk.content) >= DUPLICATE_CONTAINMENT)) continue;
    selected.push(item);
    perLayer.set(layer, (perLayer.get(layer) ?? 0) + 1);
    chars += item.chunk.content.length;
  }
  return selected;
}
