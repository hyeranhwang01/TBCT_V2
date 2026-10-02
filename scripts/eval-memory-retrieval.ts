// Memory retrieval evaluation (M7, .claude/TASK_SCOPE.json
// note2026_09_27_memory_rag_m3_m7; conditions and violations:
// note2026_10_02_memory_rag_v2_phase_a). Prints a table of hit@k, precision,
// "quiet" and violations (planted negatives surfaced) for every condition
// (none, all-in, v1, v2, v2 without filters, v2 at k = 3/5/8), untagged and
// tagged, on the gold set (src/shared/memory/eval/retrieval-gold.ts); then
// every moment's selection for v1 and v2. --all prints every condition's.
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
import { CHUNK_TAG_AXES, sanitizeTags } from "../src/shared/memory/memory-tags";
import type { MemoryChunk, MemoryChunkTags } from "../src/types/memory-chunks";
import type { GoldPersona } from "../src/shared/memory/eval/retrieval-gold";

function table(summaries: EvalSummary[]) {
  const pad = (value: unknown, width: number) => String(value).padEnd(width);
  console.log(`\n${pad("tags", 9)}${pad("condition", 15)}${pad("k", 5)}${pad("hit@k", 7)}${pad("hit(par.)", 10)}${pad("precision", 10)}${pad("quiet", 7)}${pad("violations", 11)}mean selected`);
  for (const summary of summaries) {
    console.log(`${pad(summary.tags, 9)}${pad(summary.retriever, 15)}${pad(Number.isFinite(summary.k) ? summary.k : "all", 5)}${pad(summary.hit, 7)}${pad(summary.hitParaphrase, 10)}${pad(summary.precision, 10)}${pad(summary.quiet, 7)}${pad(summary.violations, 11)}${summary.meanSelected}`);
  }
}

function print(summary: EvalSummary) {
  console.log(`\n== ${summary.condition}`);
  console.log(`hit@${Number.isFinite(summary.k) ? summary.k : "all"} ${summary.hit} (with other words: ${summary.hitParaphrase}) · precision ${summary.precision} · quiet when nothing fits ${summary.quiet} · violations ${summary.violations}`);
  for (const outcome of summary.outcomes) {
    const mark = outcome.hit ? "ok  " : "MISS";
    console.log(`${mark} ${outcome.persona}/${outcome.query}${outcome.paraphrase ? " [other words]" : ""} -> ${outcome.selected.join(" | ") || "(nothing)"}${outcome.wrong.length ? `   not right here: ${outcome.wrong.join(" | ")}` : ""}${outcome.violations.length ? `   VIOLATION: ${outcome.violations.join(", ")}` : ""}`);
  }
}

function report(summaries: EvalSummary[]) {
  table(summaries);
  const detailed = process.argv.includes("--all") ? summaries : summaries.filter((summary) => summary.retriever === "v1" || summary.retriever === "v2");
  for (const summary of detailed) print(summary);
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
      if (reference) for (const axis of CHUNK_TAG_AXES) agreement.push({ axis, overlap: jaccard(tags[axis], reference[axis]) });
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
    report(await evaluateRetrieval());
    return;
  }
  const { tag, agreement } = await liveTagger();
  report(await evaluateRetrieval(tag));
  console.log("\n== model tags vs reference (Jaccard, per axis)");
  for (const axis of CHUNK_TAG_AXES) {
    const values = agreement.filter((item) => item.axis === axis).map((item) => item.overlap);
    console.log(`${axis}: ${(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(2)} over ${values.length} chunks`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
