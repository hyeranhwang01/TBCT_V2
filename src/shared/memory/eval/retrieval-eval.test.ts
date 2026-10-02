import { describe, expect, it } from "vitest";
import { evaluateRetrieval, type EvalSummary } from "@/shared/memory/eval/retrieval-eval";
import { scoreChunks, selectChunks } from "@/shared/memory/chunk-scorer";
import { retrievalSlotsFor } from "@/shared/memory/chunk-configs";
import type { MemoryChunk } from "@/types/memory-chunks";

// Floors for the gold set (retrieval-gold.ts). A change to the scorer, the
// slot tables or the chunk cut that drops below them is a regression the
// author has to look at, not a number to lower. The set is small and written
// by the developer, so passing it is necessary, not sufficient.
//
// retrieval-v2 against v1 (note2026_10_02_memory_rag_v2_phase_a), measured
// 2026-10-02 and reported to the user, not hidden in the floors: v2 never
// surfaces a planted negative, brings less that is wrong when chunks are
// untagged, and finds as many paraphrases when tagged. What it gives up is
// v1's step affinity, which offered the participant's own S01 moment at the
// walkthrough whatever was said: untagged hit 0.4 (v1 1.0), tagged hit 0.93
// (v1 1.0) and tagged precision 0.875 (v1 0.93). The untagged floors below
// are the measured values, so they cannot slip further unnoticed;
// "v2+walk-slot" in the evaluation shows what restoring that one slot would
// recover.

function find(summaries: EvalSummary[], retriever: string, tags: EvalSummary["tags"]) {
  const summary = summaries.find((item) => item.retriever === retriever && item.tags === tags);
  if (!summary) throw new Error(`no ${retriever}/${tags}`);
  return summary;
}

describe("retrieval on the gold set", () => {
  it("v2 never surfaces a planted negative, and the filters are what hold them back", async () => {
    const summaries = await evaluateRetrieval();
    for (const tags of ["untagged", "tagged"] as const) {
      for (const retriever of ["v2", "v2 k=3", "v2 k=5", "v2 k=8"]) expect(find(summaries, retriever, tags).violations, `${retriever}/${tags}`).toBe(0);
    }
    expect(find(summaries, "v2-no-filters", "tagged").violations).toBeGreaterThan(0);
    expect(find(summaries, "all-in", "tagged").violations).toBeGreaterThan(0);
  });

  it("stays quiet when nothing fits, and keeps v1's precision untagged and its paraphrase hits tagged", async () => {
    const summaries = await evaluateRetrieval();
    for (const tags of ["untagged", "tagged"] as const) expect(find(summaries, "v2", tags).quiet, tags).toBe(1);
    expect(find(summaries, "v2", "untagged").precision).toBeGreaterThanOrEqual(find(summaries, "v1", "untagged").precision);
    expect(find(summaries, "v2", "tagged").hitParaphrase).toBeGreaterThanOrEqual(find(summaries, "v1", "tagged").hitParaphrase);
  });

  it("finds the right earlier chunk when the chunks are tagged, as the runtime has them", async () => {
    const tagged = find(await evaluateRetrieval(), "v2", "tagged");
    expect(tagged.hit).toBeGreaterThanOrEqual(0.9);
    expect(tagged.hitParaphrase).toBeGreaterThanOrEqual(0.8);
    expect(tagged.precision).toBeGreaterThanOrEqual(0.85);
  });

  it("untagged, on wording alone, holds at least its measured level", async () => {
    const untagged = find(await evaluateRetrieval(), "v2", "untagged");
    expect(untagged.hit).toBeGreaterThanOrEqual(0.4);
    expect(untagged.precision).toBe(1);
  });

  // v1 gave a note a standing weight at every step (affinity 0.35), so loose
  // wording was enough; under v2 a note competes on relevance like the rest:
  // it needs most of what was said, or the themes, to point to it.
  it("never brings up a counsellor's note on its own", () => {
    const note: MemoryChunk = { id: "N1", participantId: "PT", runtimeSessionId: "note", sessionDefinitionId: "clinician-note", sessionIndex: 0, chunkKind: "clinician_note", elementKind: "clinician_note", fieldNames: [], sourceMessageIds: [], content: "직장 스트레스가 큼. 수면 문제 동반.", distortionIds: [], sourceCreatedAt: "2026-09-20T00:00:00.000Z", indexVersion: "chunks-v1", author: "clinician", layer: "clinician_note", sensitivityFlags: [], tags: null, suppressed: false, createdAt: "x" };
    const slots = retrievalSlotsFor("tbct-s02");
    expect(selectChunks(scoreChunks([note], { text: "네 좋아요", focusField: "sessionAgendaAgreed", currentSessionIndex: 2, opening: false }, slots))).toEqual([]);
    expect(selectChunks(scoreChunks([note], { text: "직장 스트레스 때문에 수면 문제", focusField: "sessionAgendaAgreed", currentSessionIndex: 2, opening: false }, slots)).map((item) => item.chunk.id)).toEqual(["N1"]);
    const tagged = { ...note, tags: { domains: ["work_study", "health_body"], persons: [], emotions: [], beliefs: [], distortions: [] } };
    const themes = { domains: ["work_study"], persons: [], emotions: [], beliefs: [], distortions: [] };
    expect(selectChunks(scoreChunks([tagged], { text: "회사 일이 힘들어요", themes, focusField: "sessionAgendaAgreed", currentSessionIndex: 2, opening: false }, slots)).map((item) => item.chunk.id)).toEqual(["N1"]);
  });
});
