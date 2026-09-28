// Memory retrieval evaluation (M7, .claude/TASK_SCOPE.json
// note2026_09_27_memory_rag_m3_m7). Prints hit@3, precision and "quiet" on
// the gold set (src/shared/memory/eval/retrieval-gold.ts), untagged and
// tagged, with every moment's selection.
//
//   npx vite-node -c vitest.config.ts scripts/eval-memory-retrieval.ts           # reference tags (offline)
//   ANTHROPIC_API_KEY=... npx vite-node -c vitest.config.ts scripts/eval-memory-retrieval.ts --live
//
// --live tags the gold chunks with the real tagger (chunk-tagger.ts, one call
// per persona) instead of the reference tags, and also prints how far the
// model's tags agree with the reference -- the part the offline run cannot
// tell you. Synthetic data only; nothing here touches a database.
import { evaluateRetrieval, type EvalSummary } from "../src/shared/memory/eval/retrieval-eval";
import { setChunkTaggerForTests } from "../src/shared/memory/chunk-tagger";
import { TAG_AXIS_NAMES, sanitizeTags } from "../src/shared/memory/memory-tags";
import type { MemoryChunk, MemoryChunkTags } from "../src/types/memory-chunks";
import type { GoldPersona } from "../src/shared/memory/eval/retrieval-gold";

function print(summary: EvalSummary) {
  console.log(`\n== ${summary.condition}`);
  console.log(`hit@3 ${summary.hitAt3} (with other words: ${summary.hitAt3Paraphrase}) · precision ${summary.precision} · quiet when nothing fits ${summary.quiet}`);
  for (const outcome of summary.outcomes) {
    const mark = outcome.hit ? "ok  " : "MISS";
    console.log(`${mark} ${outcome.persona}/${outcome.query}${outcome.paraphrase ? " [other words]" : ""} -> ${outcome.selected.join(" | ") || "(nothing)"}${outcome.wrong.length ? `   not right here: ${outcome.wrong.join(" | ")}` : ""}`);
  }
}

async function liveTagger() {
  // The tagger's live path, called directly (no store): the batch goes to the
  // model and comes back as tags per chunk id.
  const { tagChunksWithModel } = await import("../src/shared/memory/chunk-tagger");
  const agreement: Array<{ axis: string; overlap: number }> = [];
  const tag = async (chunks: MemoryChunk[], persona: GoldPersona) => {
    const result = await tagChunksWithModel(chunks.map((chunk) => ({ id: chunk.id, content: chunk.content })), `gold-${persona.id}`);
    if (!result.ok) throw new Error(`Tagging failed: ${result.error}`);
    return chunks.map((chunk) => {
      const tags = result.tags[chunk.id] ?? sanitizeTags({});
      const reference = persona.reference.find((item) => chunk.content.includes(item.contains))?.tags;
      if (reference) for (const axis of TAG_AXIS_NAMES) agreement.push({ axis, overlap: jaccard(tags[axis], reference[axis]) });
      return { ...chunk, tags: { ...tags, distortions: [...new Set([...chunk.distortionIds, ...tags.distortions])] } as MemoryChunkTags, taggedAt: new Date().toISOString() };
    });
  };
  return { tag, agreement };
}

function jaccard(left: string[], right: string[]) {
  const union = new Set([...left, ...right]);
  if (!union.size) return 1;
  return left.filter((item) => right.includes(item)).length / union.size;
}

async function main() {
  const live = process.argv.includes("--live");
  if (live && !process.env.ANTHROPIC_API_KEY) throw new Error("--live needs ANTHROPIC_API_KEY.");
  setChunkTaggerForTests(undefined);
  if (!live) {
    for (const summary of await evaluateRetrieval()) print(summary);
    return;
  }
  const { tag, agreement } = await liveTagger();
  for (const summary of await evaluateRetrieval(tag)) print(summary);
  console.log("\n== model tags vs reference (Jaccard, per axis)");
  for (const axis of TAG_AXIS_NAMES) {
    const values = agreement.filter((item) => item.axis === axis).map((item) => item.overlap);
    console.log(`${axis}: ${(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(2)} over ${values.length} chunks`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
