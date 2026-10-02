// Runs the gold set (retrieval-gold.ts) through the real chunk builder and
// scorer and reports what came back (M7). Used by the regression test and by
// scripts/eval-memory-retrieval.ts.
//
// Conditions (retrieval-v2, note2026_10_02_memory_rag_v2_phase_a), each run
// on untagged chunks without themes and on tagged chunks with themes:
//  - none: nothing from earlier sessions (the floor: quiet, never a hit);
//  - all-in: every earlier chunk, unfiltered (the ceiling of recall);
//  - v1: retrieval-v1 as it was (eval/scorer-v1.ts, step affinity);
//  - v2: retrieval-v2 as the runtime runs it;
//  - v2-no-filters: v2 without the invalid / sensitive / level filters, to
//    show what they hold back;
//  - v2+walk-slot: v2 with the own S01 moment as a fixed slot at the S02
//    walkthrough (a diagnostic, not the runtime);
//  - v2 k=3 / k=5 / k=8: v2 with another total cap.
//
// Metrics, per condition:
//  - hit: of the moments where something should come up, how often at least
//    one right chunk is among those selected (hit@k, k the condition's cap);
//  - precision: of everything selected, how much was right to bring up (a
//    planted negative other than a duplicate is never right);
//  - quiet: of the moments where nothing should come up, how often nothing did;
//  - violations: planted negatives surfaced (a filtered chunk shown, or a
//    near-duplicate shown beside the chunk it repeats), summed over moments.
//    The target is 0.

import { buildHomeworkChunks, buildSessionChunks } from "@/shared/memory/chunk-builder";
import { retrievalSlotsFor, worksheetChunkerFor } from "@/shared/memory/chunk-configs";
import { MAX_SELECTED, scoreChunks, selectChunks, type RetrievalQuery } from "@/shared/memory/chunk-scorer";
import { S02_AFFINITY_V1, scoreChunksV1, selectChunksV1 } from "@/shared/memory/eval/scorer-v1";
import { GOLD_PERSONAS, type GoldPersona, type GoldQuery, type PlantedChunk } from "@/shared/memory/eval/retrieval-gold";
import type { MemoryChunk, MemoryChunkTags } from "@/types/memory-chunks";
import type { RuntimeMessage } from "@/types/runtime-session";

export function goldChunks(persona: GoldPersona): MemoryChunk[] {
  const participantId = `gold-${persona.id}`;
  const messages: RuntimeMessage[] = persona.s01Answers.flatMap((item, index) => [
    { id: `${persona.id}-q${index}`, runtimeSessionId: `${participantId}-s01`, role: "assistant", content: item.question, status: "delivered", createdAt: `2026-09-20T00:0${index}:00.000Z`, metadata: { focusField: item.focusField } },
    { id: `${persona.id}-a${index}`, runtimeSessionId: `${participantId}-s01`, role: "patient", content: item.answer, status: "delivered", createdAt: `2026-09-20T00:0${index}:30.000Z` },
  ]);
  const session = buildSessionChunks({ participantId, runtimeSessionId: `${participantId}-s01`, sessionDefinitionId: "tbct-s01", locale: "ko-KR", fields: persona.s01Fields, messages, completedAt: "2026-09-20T01:00:00.000Z", worksheetChunker: worksheetChunkerFor("tbct-s01") });
  const homework = buildHomeworkChunks({
    record: { id: `${participantId}-hw`, runtimeSessionId: `${participantId}-s01`, sessionDefinitionId: "tbct-s01", participantId, status: "in_progress", createdAt: "x", updatedAt: "x", data: {} },
    entries: persona.homework.map((item, index) => ({ id: `${persona.id}-hw${index}`, homeworkRecordId: `${participantId}-hw`, entryType: "distortion_example", createdAt: "2026-09-23T00:00:00.000Z", data: { distortionId: item.distortionId, date: "2026-09-23", text: item.text } })),
    locale: "ko-KR",
  });
  return [...session, ...homework, ...persona.planted.map((planted) => plantedChunk(participantId, planted))];
}

const PLANTED_PREFIX = "MCH-planted-";

function plantedChunk(participantId: string, planted: PlantedChunk): MemoryChunk {
  return {
    id: `${PLANTED_PREFIX}${planted.key}`,
    participantId,
    runtimeSessionId: `${participantId}-s01`,
    sessionDefinitionId: "tbct-s01",
    sessionIndex: 1,
    chunkKind: planted.chunkKind,
    elementKind: planted.elementKind,
    fieldNames: [],
    sourceMessageIds: [],
    content: planted.content,
    distortionIds: planted.distortionIds ?? [],
    sourceCreatedAt: "2026-09-20T01:00:00.000Z",
    indexVersion: "chunks-v1",
    author: planted.author,
    layer: planted.layer,
    ...(planted.cognitiveLevel ? { cognitiveLevel: planted.cognitiveLevel } : {}),
    sensitivityFlags: planted.kind === "sensitive" ? ["ambiguous_safety_language"] : [],
    ...(planted.kind === "invalidated" ? { validity: { state: "invalid" as const, reason: "the participant later said it was a misunderstanding", createdAt: "2026-09-22T00:00:00.000Z" } } : {}),
    tags: null,
    suppressed: false,
    createdAt: "2026-09-20T01:00:00.000Z",
  };
}

export function withReferenceTags(chunks: MemoryChunk[], persona: GoldPersona): MemoryChunk[] {
  return chunks.map((chunk) => {
    const planted = persona.planted.find((item) => chunk.id === `${PLANTED_PREFIX}${item.key}`);
    const reference = planted ? { tags: planted.tags } : persona.reference.find((item) => chunk.content.includes(item.contains));
    const tags: MemoryChunkTags = reference?.tags ?? { domains: [], persons: [], emotions: [], beliefs: [], distortions: [] };
    return { ...chunk, tags, taggedAt: "2026-09-21T00:00:00.000Z" };
  });
}

/** Picks the chunks for one moment. */
export type Retriever = (chunks: MemoryChunk[], query: RetrievalQuery) => MemoryChunk[];

export const RETRIEVERS: Array<{ name: string; k: number; retrieve: Retriever }> = [
  { name: "none", k: 0, retrieve: () => [] },
  { name: "all-in", k: Infinity, retrieve: (chunks, query) => chunks.filter((chunk) => !chunk.suppressed && chunk.sessionIndex < query.currentSessionIndex) },
  { name: "v1", k: 3, retrieve: (chunks, query) => selectChunksV1(scoreChunksV1(chunks, query, S02_AFFINITY_V1)).map((item) => item.chunk) },
  { name: "v2", k: MAX_SELECTED, retrieve: (chunks, query) => selectChunks(scoreChunks(chunks, query, retrievalSlotsFor("tbct-s02"))).map((item) => item.chunk) },
  { name: "v2-no-filters", k: MAX_SELECTED, retrieve: (chunks, query) => selectChunks(scoreChunks(chunks, query, retrievalSlotsFor("tbct-s02"), { filters: false })).map((item) => item.chunk) },
  // Not the runtime: v2 with the participant's own S01 moment as a fixed
  // slot at the fifteen-pattern walkthrough, as v1's affinity table had it.
  // Measures what leaving that step to relevance alone costs on this gold
  // set (whose walkthrough moments count the own moment as always right).
  { name: "v2+walk-slot", k: MAX_SELECTED, retrieve: (chunks, query) => selectChunks(scoreChunks(chunks, query, { ...retrievalSlotsFor("tbct-s02"), distortionExamples: ["own_case"] })).map((item) => item.chunk) },
  ...[3, 5, 8].map((k) => ({ name: `v2 k=${k}`, k, retrieve: ((chunks, query) => selectChunks(scoreChunks(chunks, query, retrievalSlotsFor("tbct-s02")), { maxSelected: k }).map((item) => item.chunk)) as Retriever })),
];

export type QueryOutcome = { persona: string; query: string; paraphrase: boolean; expectEmpty: boolean; hit: boolean; selected: string[]; right: number; wrong: string[]; violations: string[] };

export function runQuery(chunks: MemoryChunk[], persona: GoldPersona, query: GoldQuery, retrieve: Retriever = RETRIEVERS.find((item) => item.name === "v2")!.retrieve): QueryOutcome {
  const selected = retrieve(chunks, { text: query.text, focusField: query.focusField, themes: query.themes, currentSessionIndex: 2, opening: Boolean(query.opening) });
  const plantedOf = (chunk: MemoryChunk) => persona.planted.find((item) => chunk.id === `${PLANTED_PREFIX}${item.key}`);
  // A planted negative is never right to bring up -- except a duplicate,
  // which carries the right words; showing it beside its original is the
  // violation, not showing it.
  const isRight = (chunk: MemoryChunk) => {
    const planted = plantedOf(chunk);
    if (planted && planted.kind !== "duplicate") return false;
    return query.relevant.some((needle) => chunk.content.includes(needle));
  };
  const violations: string[] = [];
  for (const chunk of selected) {
    const planted = plantedOf(chunk);
    if (!planted) continue;
    if (planted.kind !== "duplicate") violations.push(planted.key);
    else if (selected.some((other) => other.id !== chunk.id && other.content.includes(planted.duplicateOf!))) violations.push(planted.key);
  }
  const first = (chunk: MemoryChunk) => chunk.content.split("\n")[0].slice(0, 60);
  return {
    persona: persona.id,
    query: query.name,
    paraphrase: Boolean(query.paraphrase),
    expectEmpty: query.relevant.length === 0,
    hit: query.relevant.length === 0 ? selected.length === 0 : selected.some(isRight),
    selected: selected.map(first),
    right: selected.filter(isRight).length,
    wrong: selected.filter((chunk) => !isRight(chunk)).map(first),
    violations,
  };
}

export type EvalSummary = {
  condition: string;
  retriever: string;
  tags: "untagged" | "tagged";
  k: number;
  hit: number;
  hitParaphrase: number;
  precision: number;
  quiet: number;
  violations: number;
  /** Chunks selected per moment, on average. */
  meanSelected: number;
  outcomes: QueryOutcome[];
};

function ratio(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 1000 : 1;
}

export function summarize(condition: { name: string; retriever: string; tags: EvalSummary["tags"]; k: number }, outcomes: QueryOutcome[]): EvalSummary {
  const expectSome = outcomes.filter((item) => !item.expectEmpty);
  const paraphrase = expectSome.filter((item) => item.paraphrase);
  const expectNone = outcomes.filter((item) => item.expectEmpty);
  const selectedTotal = outcomes.reduce((sum, item) => sum + item.selected.length, 0);
  const rightTotal = outcomes.reduce((sum, item) => sum + item.right, 0);
  return {
    condition: condition.name,
    retriever: condition.retriever,
    tags: condition.tags,
    k: condition.k,
    hit: ratio(expectSome.filter((item) => item.hit).length, expectSome.length),
    hitParaphrase: ratio(paraphrase.filter((item) => item.hit).length, paraphrase.length),
    precision: ratio(rightTotal, selectedTotal),
    quiet: ratio(expectNone.filter((item) => item.hit).length, expectNone.length),
    violations: outcomes.reduce((sum, item) => sum + item.violations.length, 0),
    meanSelected: Math.round((selectedTotal / Math.max(1, outcomes.length)) * 100) / 100,
    outcomes,
  };
}

/** Every retriever, untagged and tagged, over every persona. `tagChunks`
 * replaces the reference tags (the live script passes real tagger output). */
export async function evaluateRetrieval(tagChunks?: (chunks: MemoryChunk[], persona: GoldPersona) => Promise<MemoryChunk[]>): Promise<EvalSummary[]> {
  const prepared: Array<{ persona: GoldPersona; untagged: MemoryChunk[]; tagged: MemoryChunk[] }> = [];
  for (const persona of GOLD_PERSONAS) {
    const chunks = goldChunks(persona);
    prepared.push({ persona, untagged: chunks, tagged: tagChunks ? await tagChunks(chunks, persona) : withReferenceTags(chunks, persona) });
  }
  const taggedLabel = tagChunks ? "tagged by the model, with themes" : "reference tags, with themes";
  const summaries: EvalSummary[] = [];
  for (const tags of ["untagged", "tagged"] as const) {
    for (const retriever of RETRIEVERS) {
      const outcomes: QueryOutcome[] = [];
      for (const { persona, untagged, tagged } of prepared) {
        for (const query of persona.queries) {
          outcomes.push(tags === "untagged" ? runQuery(untagged, persona, { ...query, themes: undefined }, retriever.retrieve) : runQuery(tagged, persona, query, retriever.retrieve));
        }
      }
      summaries.push(summarize({ name: `${retriever.name} · ${tags === "untagged" ? "untagged, no themes" : taggedLabel}`, retriever: retriever.name, tags, k: retriever.k }, outcomes));
    }
  }
  return summaries;
}
