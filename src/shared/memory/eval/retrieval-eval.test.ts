import { describe, expect, it } from "vitest";
import { evaluateRetrieval } from "@/shared/memory/eval/retrieval-eval";
import { scoreChunks, selectChunks } from "@/shared/memory/chunk-scorer";
import { retrievalAffinityFor } from "@/shared/memory/chunk-configs";
import type { MemoryChunk } from "@/types/memory-chunks";

// Floors for the gold set (retrieval-gold.ts). A change to the scorer, the
// affinity tables or the chunk cut that drops below them is a regression the
// author has to look at, not a number to lower. The set is small and written
// by the developer, so passing it is necessary, not sufficient.

describe("retrieval on the gold set", () => {
  it("finds the right earlier chunk, stays quiet when nothing fits, and brings little else -- tagged or not", async () => {
    const [untagged, tagged] = await evaluateRetrieval();
    for (const summary of [untagged, tagged]) {
      expect(summary.hitAt3, summary.condition).toBeGreaterThanOrEqual(0.9);
      expect(summary.hitAt3Paraphrase, summary.condition).toBeGreaterThanOrEqual(0.8);
      expect(summary.precision, summary.condition).toBeGreaterThanOrEqual(0.85);
      expect(summary.quiet, summary.condition).toBe(1);
    }
  });

  it("never brings up a counsellor's note on its own", () => {
    const note: MemoryChunk = { id: "N1", participantId: "PT", runtimeSessionId: "note", sessionDefinitionId: "clinician-note", sessionIndex: 0, chunkKind: "clinician_note", elementKind: "clinician_note", fieldNames: [], sourceMessageIds: [], content: "직장 스트레스가 큼. 수면 문제 동반.", distortionIds: [], sourceCreatedAt: "2026-09-20T00:00:00.000Z", indexVersion: "chunks-v1", tags: null, suppressed: false, createdAt: "x" };
    const affinity = retrievalAffinityFor("tbct-s02");
    expect(selectChunks(scoreChunks([note], { text: "네 좋아요", focusField: "sessionAgendaAgreed", currentSessionIndex: 2, opening: false }, affinity))).toEqual([]);
    expect(selectChunks(scoreChunks([note], { text: "요즘 직장 스트레스 때문에 수면 문제가 있어요", focusField: "sessionAgendaAgreed", currentSessionIndex: 2, opening: false }, affinity)).map((item) => item.chunk.id)).toEqual(["N1"]);
  });
});
