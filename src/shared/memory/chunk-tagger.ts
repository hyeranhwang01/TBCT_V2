// Tags memory chunks from the closed list in memory-tags.ts (M3,
// .claude/TASK_SCOPE.json note2026_09_27_memory_rag_m3_m7). One model call per
// batch of a participant's untagged chunks, forced through a tool whose enums
// are the tag list, so nothing outside the list can come back; what does is
// filtered again anyway.
//
// Consent: tagging sends the participant's earlier words to the model, so it
// runs only for a participant who agreed (memoryUseAllowed). For anyone else
// the chunks stay untagged, and are tagged later if they agree.
//
// Server-only (reads ANTHROPIC_API_KEY). Same fetch / tool_choice / usage
// shape as prompt-session-agent.ts.

import { z } from "zod";
import { redactDirectIdentifiers } from "@/shared/assessment/privacy-redaction";
import { recordModelUsage } from "@/shared/assessment/model-observability";
import { getParticipant } from "@/shared/data/repositories/participant-repository";
import { listUntaggedMemoryChunks, setMemoryChunkTags } from "@/shared/data/repositories/memory-chunk-repository";
import { memoryUseAllowed } from "@/shared/memory/memory-consent";
import { MEMORY_TAGS_VERSION, describeTagList, sanitizeTags, tagSetJsonSchema } from "@/shared/memory/memory-tags";
import type { MemoryChunk, MemoryChunkTags } from "@/types/memory-chunks";

const DEFAULT_MODEL = "claude-sonnet-5";
const TOOL_NAME = "submit_chunk_tags";
const BATCH_SIZE = 30;
const CHUNK_TEXT_LIMIT = 600;

/** Bump when the tagging instructions change; stored on every tagged chunk. */
export const TAG_PROMPT_VERSION = `${MEMORY_TAGS_VERSION}/p1`;

const SYSTEM = `You label short pieces of what a participant said or wrote in earlier sessions of a cognitive-therapy program (Trial-Based Cognitive Therapy), so that a later session can find the relevant piece again. The pieces are in Korean or English.

For each piece, choose the tags that describe what it is about, only from these lists:
${describeTagList()}

Rules:
- Tag what the piece is about, not what it might imply. Leave an axis empty when nothing in the words points to it.
- persons: the people who appear in the situation. "self" only when the piece is about how they see themselves.
- beliefs: only when the words themselves express a view of oneself as helpless, unlovable or worthless.
- distortions: only when the thought in the piece clearly shows the pattern.
- Tag every piece you are given, by its id.`;

type TaggerRequest = { chunks: Array<Pick<MemoryChunk, "id" | "content">> };
export type TaggerResult = { ok: true; tags: Record<string, MemoryChunkTags>; model: string } | { ok: false; error: string; notConfigured?: boolean };
type Tagger = (request: TaggerRequest, context: { participantId: string }) => Promise<TaggerResult>;

let taggerForTests: Tagger | undefined;
/** Tests replace the model call. */
export function setChunkTaggerForTests(tagger: Tagger | undefined) {
  taggerForTests = tagger;
}

const TAG_SET_SCHEMA = tagSetJsonSchema();
const TOOL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["chunks"],
  properties: {
    chunks: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", ...TAG_SET_SCHEMA.required], properties: { id: { type: "string" }, ...TAG_SET_SCHEMA.properties } },
    },
  },
};

const toolOutput = z.object({ chunks: z.array(z.object({ id: z.string() }).passthrough()) });

async function callAnthropic(request: TaggerRequest, context: { participantId: string }): Promise<TaggerResult> {
  if ((process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "mock") return { ok: false, error: "Model calls disabled (AI_PROVIDER=mock)", notConfigured: true };
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) return { ok: false, error: "Missing ANTHROPIC_API_KEY", notConfigured: true };
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const started = performance.now();
  const usageBase = { sessionId: `participant:${context.participantId}`, turnId: "memory-tagging", provider: "anthropic", model, purpose: "memory_tagging" as const, llmCalled: true, retryCount: 0, estimatedCost: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const pieces = request.chunks.map((chunk) => `<piece id="${chunk.id}">\n${redactDirectIdentifiers(chunk.content).slice(0, CHUNK_TEXT_LIMIT)}\n</piece>`).join("\n");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: pieces }] }],
        tools: [{
          name: TOOL_NAME,
          description: "Submit the tags for every piece.",
          input_schema: TOOL_INPUT_SCHEMA,
        }],
        tool_choice: { type: "tool", name: TOOL_NAME, disable_parallel_tool_use: true },
      }),
    });
    if (!response.ok) throw new Error(`Anthropic tagging failed (${response.status}): ${(await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`);
    const json = (await response.json()) as { content?: Array<{ type?: string; name?: string; input?: unknown }>; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
    const parsed = toolOutput.safeParse(json.content?.find((item) => item.type === "tool_use" && item.name === TOOL_NAME)?.input);
    if (!parsed.success) throw new Error("Tagging answer missing or malformed");
    const asked = new Set(request.chunks.map((chunk) => chunk.id));
    const tags: Record<string, MemoryChunkTags> = {};
    for (const item of parsed.data.chunks) if (asked.has(item.id)) tags[item.id] = sanitizeTags(item);
    recordModelUsage({ ...usageBase, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: null, latencyMs: Math.round(performance.now() - started), cacheStatus: (json.usage?.cache_read_input_tokens ?? 0) > 0 ? "hit" : "miss", success: true });
    return { ok: true, tags, model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tagging failed";
    recordModelUsage({ ...usageBase, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), cacheStatus: "none", success: false, failureReason: message });
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

/** The model call alone, without the store -- for the evaluation script. */
export async function tagChunksWithModel(chunks: Array<Pick<MemoryChunk, "id" | "content">>, participantId: string): Promise<TaggerResult> {
  return (taggerForTests ?? callAnthropic)({ chunks }, { participantId });
}

export type TaggingOutcome = { status: "skipped_no_consent" | "nothing_to_tag" | "done" | "failed"; tagged: number; untagged: number; error?: string };

/** Tags every untagged chunk of a participant who agreed to memory use. A
 * batch that fails stays untagged and is tried again next time. */
export async function tagParticipantChunks(participantId: string): Promise<TaggingOutcome> {
  const participant = await getParticipant(participantId);
  if (!memoryUseAllowed(participant)) return { status: "skipped_no_consent", tagged: 0, untagged: 0 };
  const untagged = await listUntaggedMemoryChunks(participantId);
  if (!untagged.length) return { status: "nothing_to_tag", tagged: 0, untagged: 0 };
  const tagger = taggerForTests ?? callAnthropic;
  let tagged = 0;
  let lastError: string | undefined;
  for (let start = 0; start < untagged.length; start += BATCH_SIZE) {
    const batch = untagged.slice(start, start + BATCH_SIZE);
    const result = await tagger({ chunks: batch.map((chunk) => ({ id: chunk.id, content: chunk.content })) }, { participantId });
    if (!result.ok) {
      lastError = result.error;
      if (result.notConfigured) break;
      continue;
    }
    for (const chunk of batch) {
      const tags = result.tags[chunk.id];
      if (!tags) continue;
      // Structure-known distortions (an S02 row) are kept even if the model
      // missed them.
      const merged = { ...tags, distortions: [...new Set([...chunk.distortionIds, ...tags.distortions])] };
      if (await setMemoryChunkTags(chunk.id, sanitizeTags(merged), result.model, TAG_PROMPT_VERSION)) tagged += 1;
    }
  }
  const remaining = untagged.length - tagged;
  return { status: lastError && !tagged ? "failed" : "done", tagged, untagged: remaining, error: lastError };
}
