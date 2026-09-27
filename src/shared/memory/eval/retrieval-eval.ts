// Runs the gold set (retrieval-gold.ts) through the real chunk builder and
// scorer and reports what came back (M7). Used by the regression test and by
// scripts/eval-memory-retrieval.ts.
//
// Metrics, per condition (chunks untagged / with tags):
//  - hit@3: of the moments where something should come up, how often at
//    least one right chunk is among those selected;
//  - precision: of everything selected, how much was right to bring up;
//  - quiet: of the moments where nothing should come up, how often nothing did.

import { buildHomeworkChunks, buildSessionChunks } from "@/shared/memory/chunk-builder";
import { retrievalAffinityFor, worksheetChunkerFor } from "@/shared/memory/chunk-configs";
import { scoreChunks, selectChunks } from "@/shared/memory/chunk-scorer";
import { GOLD_PERSONAS, type GoldPersona, type GoldQuery } from "@/shared/memory/eval/retrieval-gold";
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
  return [...session, ...homework];
}

export function withReferenceTags(chunks: MemoryChunk[], persona: GoldPersona): MemoryChunk[] {
  return chunks.map((chunk) => {
    const reference = persona.reference.find((item) => chunk.content.includes(item.contains));
    const tags: MemoryChunkTags = reference?.tags ?? { domains: [], persons: [], emotions: [], beliefs: [], distortions: [] };
    return { ...chunk, tags, taggedAt: "2026-09-21T00:00:00.000Z" };
  });
}

export type QueryOutcome = { persona: string; query: string; paraphrase: boolean; expectEmpty: boolean; hit: boolean; selected: string[]; right: number; wrong: string[] };

export function runQuery(chunks: MemoryChunk[], persona: GoldPersona, query: GoldQuery): QueryOutcome {
  const selected = selectChunks(scoreChunks(chunks, { text: query.text, focusField: query.focusField, themes: query.themes, currentSessionIndex: 2, opening: Boolean(query.opening) }, retrievalAffinityFor("tbct-s02")));
  const isRight = (content: string) => query.relevant.some((needle) => content.includes(needle));
  const contents = selected.map((item) => item.chunk.content);
  return {
    persona: persona.id,
    query: query.name,
    paraphrase: Boolean(query.paraphrase),
    expectEmpty: query.relevant.length === 0,
    hit: query.relevant.length === 0 ? selected.length === 0 : contents.some(isRight),
    selected: contents.map((content) => content.split("\n")[0].slice(0, 60)),
    right: contents.filter(isRight).length,
    wrong: contents.filter((content) => !isRight(content)).map((content) => content.split("\n")[0].slice(0, 60)),
  };
}

export type EvalSummary = {
  condition: string;
  hitAt3: number;
  hitAt3Paraphrase: number;
  precision: number;
  quiet: number;
  outcomes: QueryOutcome[];
};

function ratio(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 1000 : 1;
}

export function summarize(condition: string, outcomes: QueryOutcome[]): EvalSummary {
  const expectSome = outcomes.filter((item) => !item.expectEmpty);
  const paraphrase = expectSome.filter((item) => item.paraphrase);
  const expectNone = outcomes.filter((item) => item.expectEmpty);
  const selectedTotal = outcomes.reduce((sum, item) => sum + item.selected.length, 0);
  const rightTotal = outcomes.reduce((sum, item) => sum + item.right, 0);
  return {
    condition,
    hitAt3: ratio(expectSome.filter((item) => item.hit).length, expectSome.length),
    hitAt3Paraphrase: ratio(paraphrase.filter((item) => item.hit).length, paraphrase.length),
    precision: ratio(rightTotal, selectedTotal),
    quiet: ratio(expectNone.filter((item) => item.hit).length, expectNone.length),
    outcomes,
  };
}

/** Both conditions over every persona. `tagChunks` replaces the reference
 * tags (the live script passes real tagger output). */
export async function evaluateRetrieval(tagChunks?: (chunks: MemoryChunk[], persona: GoldPersona) => Promise<MemoryChunk[]>): Promise<EvalSummary[]> {
  const untagged: QueryOutcome[] = [];
  const tagged: QueryOutcome[] = [];
  for (const persona of GOLD_PERSONAS) {
    const chunks = goldChunks(persona);
    const withTags = tagChunks ? await tagChunks(chunks, persona) : withReferenceTags(chunks, persona);
    for (const query of persona.queries) {
      untagged.push(runQuery(chunks, persona, { ...query, themes: undefined }));
      tagged.push(runQuery(withTags, persona, query));
    }
  }
  return [summarize("untagged, no themes", untagged), summarize(tagChunks ? "tagged by the model, with themes" : "reference tags, with themes", tagged)];
}
