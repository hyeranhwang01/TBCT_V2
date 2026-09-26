// The model call for prompt-driven sessions (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02). One call = one assistant message.
// The system prompt is the session's generated prompt document plus the
// field list; the messages are the real conversation so far; the last user
// turn carries a <program> block with the worksheet as it is now and the
// facts the program owns (totals, the previous session, a safety check that
// just happened). The model answers through one forced tool call.
//
// Server-only: it reads ANTHROPIC_API_KEY. The same fetch / cache_control /
// tool_choice / usage-recording shape as anthropic-dialogue-agent.ts, which
// is left as it is for Sessions 3-8.

import { z } from "zod";
import { redactDirectIdentifiers } from "@/shared/assessment/privacy-redaction";
import { recordModelUsage } from "@/shared/assessment/model-observability";
import { SESSION_PROMPTS, sessionSystemPrompt } from "@/shared/protocol/session-prompts.generated";
import { PROMPT_INPUT_HINTS, describePromptFields } from "@/shared/runtime/prompt-driven-sessions";

const DEFAULT_MODEL = "claude-sonnet-5";
const TOOL_NAME = "submit_session_turn";

export const promptSessionTurnSchema = z.object({
  reply: z.string().trim().min(1),
  fieldUpdates: z.record(z.unknown()).default({}),
  focusField: z.string().nullable().optional(),
  inputHint: z.enum(PROMPT_INPUT_HINTS),
  sessionComplete: z.boolean().default(false),
  pauseSession: z.boolean().default(false),
  safetyConcern: z.boolean().default(false),
});
export type PromptSessionTurn = z.infer<typeof promptSessionTurnSchema>;

const TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "fieldUpdates", "focusField", "inputHint", "sessionComplete", "pauseSession", "safetyConcern"],
  properties: {
    reply: { type: "string", description: "The message the participant reads. Nothing else." },
    fieldUpdates: { type: "object", description: "Values this turn established, by the field names listed in the system prompt. Lists are sent whole. Empty object when nothing new.", additionalProperties: true },
    focusField: { type: ["string", "null"], description: "The worksheet field the conversation is on now, or null." },
    inputHint: { type: "string", enum: [...PROMPT_INPUT_HINTS] },
    sessionComplete: { type: "boolean" },
    pauseSession: { type: "boolean" },
    safetyConcern: { type: "boolean" },
  },
} as const;

/** One turn of history, as the model sees it. */
export type PromptHistoryMessage = { role: "participant" | "assistant"; content: string };

export type PromptSessionRequest = {
  sessionDefinitionId: string;
  locale: string;
  history: PromptHistoryMessage[];
  /** The <program> block for this call. */
  programBlock: string;
  /** No participant message this time: the last message asked nothing, or the
   * session is starting or resuming. */
  continueWithoutParticipant: boolean;
  /** Set on the retry after a malformed answer. */
  correction?: string;
};

export type PromptSessionResult =
  | { ok: true; turn: PromptSessionTurn; model: string; latencyMs: number; promptVersion: string; promptSha256: string }
  | { ok: false; error: string; notConfigured?: boolean };

type Generator = (request: PromptSessionRequest, context: { sessionId: string; turnId: string }) => Promise<PromptSessionResult>;
let generatorForTests: Generator | undefined;

/** Tests replace the live call with a scripted one. */
export function setPromptSessionGeneratorForTests(generator: Generator | undefined) {
  generatorForTests = generator;
}

function localeLine(locale: string) {
  const lower = locale.toLowerCase();
  const language = lower.startsWith("ko") ? "Korean" : lower.startsWith("pt") ? "Portuguese" : lower.startsWith("fr") ? "French" : lower.startsWith("ja") ? "Japanese" : "English";
  return `This session's language is ${language} (${locale}). Answer in ${language} unless the participant writes in another language.`;
}

/**
 * The conversation as alternating user/assistant turns. Consecutive assistant
 * messages (a message that asked nothing, then the next one) get a
 * "(continue)" user turn between them; consecutive participant messages are
 * joined. The <program> block goes on the last user turn.
 */
export function buildPromptMessages(request: PromptSessionRequest) {
  type Turn = { role: "user" | "assistant"; text: string };
  const turns: Turn[] = [{ role: "user", text: "(The session starts.)" }];
  for (const message of request.history) {
    const role = message.role === "participant" ? "user" : "assistant";
    const text = role === "user" ? redactDirectIdentifiers(message.content) : message.content;
    const last = turns[turns.length - 1];
    if (last.role === role && role === "user") last.text = `${last.text}\n\n${text}`;
    else if (last.role === role) turns.push({ role: "user", text: "(continue)" }, { role, text });
    else turns.push({ role, text });
  }
  if (turns[turns.length - 1].role === "assistant") turns.push({ role: "user", text: "(continue)" });
  const last = turns[turns.length - 1];
  const lead = request.continueWithoutParticipant ? "No participant message this time. Write your next message." : "The participant's message is below the program block.";
  last.text = `<program>\n${lead}\n${request.programBlock}${request.correction ? `\n${request.correction}` : ""}\n</program>\n\n${last.text}`;
  return turns.map((turn) => ({ role: turn.role, content: [{ type: "text", text: turn.text }] }));
}

async function callAnthropic(request: PromptSessionRequest, context: { sessionId: string; turnId: string }): Promise<PromptSessionResult> {
  const system = sessionSystemPrompt(request.sessionDefinitionId);
  const document = SESSION_PROMPTS[request.sessionDefinitionId];
  if (!system || !document) return { ok: false, error: `No session prompt for ${request.sessionDefinitionId}` };
  if ((process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "mock") return { ok: false, error: "Model calls disabled (AI_PROVIDER=mock)", notConfigured: true };
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) return { ok: false, error: "Missing ANTHROPIC_API_KEY", notConfigured: true };
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const maxTokens = Math.min(2000, Math.max(600, Number(process.env.ANTHROPIC_SESSION_MAX_TOKENS ?? 1500)));
  const timeoutMs = Math.min(30000, Math.max(15000, Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 25000)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  const usageBase = { sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "prompt_session" as const, llmCalled: true, retryCount: request.correction ? 1 : 0, estimatedCost: null };
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral" } },
          { type: "text", text: `Fields you may record for this session (fieldUpdates), with what each holds:\n${describePromptFields(request.sessionDefinitionId)}`, cache_control: { type: "ephemeral" } },
          { type: "text", text: localeLine(request.locale) },
        ],
        messages: buildPromptMessages(request),
        tools: [{ name: TOOL_NAME, description: "Submit this turn: the message and what it recorded.", input_schema: TOOL_SCHEMA }],
        tool_choice: { type: "tool", name: TOOL_NAME, disable_parallel_tool_use: true },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
      throw new Error(`Anthropic session turn failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    const json = (await response.json()) as { content?: Array<{ type?: string; name?: string; input?: unknown }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
    if (json.stop_reason === "max_tokens") throw new Error(`Anthropic session turn truncated (output_tokens=${json.usage?.output_tokens ?? "unknown"})`);
    const input = json.content?.find((item) => item.type === "tool_use" && item.name === TOOL_NAME)?.input;
    if (!input) throw new Error(`Anthropic omitted the session turn (stop_reason=${json.stop_reason ?? "unknown"})`);
    const parsed = promptSessionTurnSchema.safeParse(input);
    if (!parsed.success) throw new Error(`Session turn failed validation: ${parsed.error.message.replace(/\s+/g, " ").slice(0, 300)}`);
    const latencyMs = Math.round(performance.now() - started);
    recordModelUsage({ ...usageBase, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: json.usage?.input_tokens !== undefined && json.usage.output_tokens !== undefined ? json.usage.input_tokens + json.usage.output_tokens : null, latencyMs, cacheStatus: (json.usage?.cache_read_input_tokens ?? 0) > 0 ? "hit" : "miss", success: true });
    return { ok: true, turn: parsed.data, model, latencyMs, promptVersion: document.version, promptSha256: document.sha256 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Session turn failed";
    recordModelUsage({ ...usageBase, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), cacheStatus: "none", success: false, failureReason: message });
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generatePromptSessionTurn(request: PromptSessionRequest, context: { sessionId: string; turnId: string }): Promise<PromptSessionResult> {
  if (generatorForTests) return generatorForTests(request, context);
  return callAnthropic(request, context);
}
