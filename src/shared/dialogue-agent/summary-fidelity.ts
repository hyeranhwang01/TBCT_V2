import { z } from "zod";
import { redactDirectIdentifiers } from "@/shared/assessment/privacy-redaction";
import { recordModelUsage } from "@/shared/assessment/model-observability";

/**
 * Summary fidelity (.claude/TASK_SCOPE.json note2026_09_15_olivia_persona).
 *
 * The research team found summaries that added meaning the participant never
 * expressed, and a summary the participant says "yes" to is written to the
 * worksheet. Before a confirmation ships, this check compares the summary
 * with the participant's own messages (dialogue-agent-orchestrator.ts).
 * Content offered as a tentative question passes, but is flagged so it is
 * never recorded. Fails open: without a verdict the turn ships, and the
 * caller records no summary from it.
 */

export const summaryFidelityRequestSchema = z.object({
  locale: z.string(),
  participantMessages: z.array(z.string()).min(1),
  summary: z.string(),
});
export type SummaryFidelityRequest = z.infer<typeof summaryFidelityRequestSchema>;
export type SummaryFidelityResult = { faithful: boolean; checked: boolean; tentative?: boolean; addedMeaning?: string; failureReason?: string };

const DEFAULT_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = [
  "You check one summary a TBCT counselor wrote of what a participant said, against the participant's own messages.",
  "faithful=false when the summary states something the participant did not express: a cause, motive, feeling, judgment, belief, evaluation or meaning that is not in their words. Restating, shortening, reordering or using a close synonym is faithful.",
  "Content explicitly offered as a tentative question or possibility (for example '혹시 ~일까요?', '~일 수도 있을까요?', 'I wonder if') is not a violation, but set tentative=true whenever the summary contains any.",
  "When faithful=false, name the added meaning briefly in addedMeaning, in the summary's language.",
  "Return your verdict with the submit_summary_fidelity tool only.",
].join(" ");

const TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["faithful", "tentative"],
  properties: {
    faithful: { type: "boolean" },
    tentative: { type: "boolean" },
    addedMeaning: { type: "string", maxLength: 300 },
  },
} as const;

const toolOutputSchema = z.object({ faithful: z.boolean(), tentative: z.boolean().optional(), addedMeaning: z.string().optional() });

export async function judgeSummaryFidelity(raw: SummaryFidelityRequest, context: { sessionId: string; turnId: string }): Promise<SummaryFidelityResult> {
  const request = summaryFidelityRequestSchema.parse(raw);
  // AI_PROVIDER=mock means no live model call of any kind (the simulated audit).
  if ((process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "mock") return { faithful: true, checked: false, failureReason: "provider_disabled" };
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) return { faithful: true, checked: false, failureReason: "missing_api_key" };
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = Math.min(8000, Math.max(2000, Number(process.env.SUMMARY_FIDELITY_TIMEOUT_MS ?? 6000)));
  const started = performance.now();
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({ locale: request.locale, participantMessages: request.participantMessages.map((message) => redactDirectIdentifiers(message)), summary: redactDirectIdentifiers(request.summary) }) }] }],
        tools: [{ name: "submit_summary_fidelity", description: "Submit whether the summary adds meaning the participant did not express.", input_schema: TOOL_SCHEMA }],
        tool_choice: { type: "tool", name: "submit_summary_fidelity", disable_parallel_tool_use: true },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
      throw new Error(`Anthropic summary fidelity failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    const json = (await response.json()) as { content?: Array<{ type?: string; name?: string; input?: unknown }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    const toolInput = json.content?.find((item) => item.type === "tool_use" && item.name === "submit_summary_fidelity")?.input;
    const parsed = toolOutputSchema.safeParse(toolInput);
    if (!parsed.success) throw new Error(`Anthropic summary fidelity returned no usable verdict (stop_reason=${json.stop_reason ?? "unknown"})`);
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "summary_fidelity", llmCalled: true, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: json.usage?.input_tokens !== undefined && json.usage.output_tokens !== undefined ? json.usage.input_tokens + json.usage.output_tokens : null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: true });
    return { faithful: parsed.data.faithful, checked: true, tentative: parsed.data.tentative ?? false, ...(parsed.data.addedMeaning?.trim() ? { addedMeaning: parsed.data.addedMeaning.trim() } : {}) };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "summary fidelity failed";
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "summary_fidelity", llmCalled: true, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: false, failureReason });
    return { faithful: true, checked: false, failureReason };
  }
}
