// retrieval-v1, frozen (note2026_10_02_memory_rag_v2_phase_a): a copy of
// chunk-scorer.ts as it was before retrieval-v2, with S02's step-affinity
// table (s02/memory-chunks.ts) beside it, kept ONLY so the evaluation
// (retrieval-eval.ts) can compare v1 and v2 on the same gold set. Nothing at
// runtime imports this file; do not change it -- it is the baseline.

import type { MemoryChunk, MemoryChunkKind, MemoryChunkTags, MemoryElementKind } from "@/types/memory-chunks";
import { TAG_AXIS_NAMES } from "@/shared/memory/memory-tags";

export const V1_ALGORITHM_VERSION = "retrieval-v1";

const WEIGHTS = { affinity: 3, tags: 2, text: 2, recency: 0.5 } as const;
/** The floor applies to relevance (affinity + tags + text) only. Recency
 * orders chunks that are relevant; it never makes one relevant -- otherwise
 * anything from the previous session would clear the floor. */
const MIN_RELEVANCE = 1.2;
/** A chunk must also be at least this share as relevant as the best one:
 * three slots are a ceiling, not a quota, and filling them with whatever is
 * loosely on topic crowds the model (gold set, retrieval-eval.ts: 0.6 kept
 * every hit and lifted precision with tags from 0.78 to 0.93). */
const RELATIVE_CUTOFF = 0.6;
const MAX_SELECTED = 3;
const MAX_SELECTED_CHARS = 800;

/** Per session: for each focusField, how much each kind of chunk matters
 * (0..1). "*" applies at every step; OPENING_STEP when the session has not
 * heard from the participant yet. Keys are element kinds or chunk kinds. */
export type V1RetrievalAffinity = Record<string, Partial<Record<MemoryElementKind | MemoryChunkKind, number>>>;
const OPENING_STEP = "__opening";

export type V1RetrievalQuery = {
  text: string;
  focusField?: string;
  themes?: MemoryChunkTags;
  currentSessionIndex: number;
  /** No participant message in this session yet. */
  opening: boolean;
};

export type V1ScoredChunk = { chunk: MemoryChunk; score: number; relevance: number; parts: { affinity: number; tags: number; text: number; recency: number } };

function normalizeForMatch(text: string): string {
  return text.replace(/^[QA]: /gm, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(text: string): Set<string> {
  const normalized = normalizeForMatch(text);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
  return grams;
}

function affinityOf(chunk: MemoryChunk, query: V1RetrievalQuery, affinity: V1RetrievalAffinity): number {
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

export function scoreChunksV1(chunks: MemoryChunk[], query: V1RetrievalQuery, affinity: V1RetrievalAffinity): V1ScoredChunk[] {
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
export function selectChunksV1(scored: V1ScoredChunk[]): V1ScoredChunk[] {
  const best = Math.max(0, ...scored.map((item) => item.relevance));
  const ranked = scored
    .filter((item) => item.relevance >= MIN_RELEVANCE && item.relevance >= RELATIVE_CUTOFF * best)
    .sort((left, right) => right.score - left.score || right.chunk.sessionIndex - left.chunk.sessionIndex || left.chunk.id.localeCompare(right.chunk.id));
  const selected: V1ScoredChunk[] = [];
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

/**
 * Which earlier chunks matter at each S02 step (chunk-scorer.ts), keyed by the
 * field the conversation is on (s02/prompt-fields.ts). At the opening the
 * participant's own S01 moment and last week's homework are what the bridge
 * can pick up; in the fifteen-pattern walkthrough their own S01 moment,
 * homework rows and conversation are where an example of theirs may already
 * be. Problems and goal are background everywhere, so they only come up when
 * what the participant says or the themes point to them.
 */
export const S02_AFFINITY_V1: V1RetrievalAffinity = {
  [OPENING_STEP]: { own_case: 0.6, homework: 0.6 },
  // A counsellor's note is meant to carry across sessions: at every step it
  // comes up when what is being said matches it, never on its own.
  "*": { problem: 0.25, goal: 0.25, clinician_note: 0.35 },
  homeworkReport: { homework: 1, homework_report: 1 },
  // Only their own S01 moment qualifies here on its own; homework rows,
  // conversation and the rest need what they are saying, or the pattern
  // being discussed (themes), to point to them -- otherwise every row of
  // every pattern would crowd in.
  distortionExamples: { own_case: 1, homework: 0.35, conversation: 0.3, cycle: 0.3, problem: 0.3, distortion_example: 0.3, alternative_thought: 0.3 },
  cdQuestFrequency: { own_case: 0.4, homework: 0.4 },
  cdQuestIntensity: { own_case: 0.4, homework: 0.4 },
  cdQuestStatedScores: { own_case: 0.4, homework: 0.4 },
  cdQuestReflection: { goal: 0.6, problem: 0.6 },
  cdQuestPriorityTypes: { problem: 1, goal: 1, own_case: 0.6 },
  homeworkCommitment: { homework: 0.5 },
};
