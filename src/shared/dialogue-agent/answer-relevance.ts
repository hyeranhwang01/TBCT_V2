import { z } from "zod";
import { redactDirectIdentifiers } from "@/shared/assessment/privacy-redaction";
import { recordModelUsage } from "@/shared/assessment/model-observability";

/**
 * Off-topic answers (.claude/TASK_SCOPE.json note2026_09_14_off_topic_answers)
 * and field corrections (note2026_09_14_field_corrections).
 *
 * The runtime stores whatever a participant types for a free-text question
 * and moves to the next prompt. A live S01 test on 2026-09-14 showed why that
 * breaks once Claude phrases turns freely: small talk ("근데 1더하기 1은 뭐야?")
 * was stored as the situation and a message about lunch as the second
 * emotion, and the typo "읎오" (meant as "없어요") as another difficulty.
 *
 * This check runs BEFORE the answer is stored (runtime-execution-api.ts) and
 * sorts the message into one of four verdicts:
 *   - answer             -> stored as usual
 *   - stop               -> "nothing (more)", however it is typed; on a list
 *                           prompt it closes the list like a recognized stop word
 *   - off_topic          -> not stored; the same question is asked again
 *   - correction_request -> not stored; the dialogue agent proposes changing
 *                           the earlier answer and asks before anything changes
 * It fails open -- no key, a disabled provider, a timeout or an unusable reply
 * all count as an answer, which is exactly the behavior before this check.
 */

export const answerRelevanceRequestSchema = z.object({
  locale: z.string(),
  /** What the participant was actually shown -- the last assistant turn. */
  question: z.string(),
  /** The protocol's own wording of the task the answer is for. */
  approvedTask: z.string().optional(),
  answer: z.string(),
  stepObjective: z.string().optional(),
});
export type AnswerRelevanceRequest = z.infer<typeof answerRelevanceRequestSchema>;
export const ANSWER_RELEVANCE_VERDICTS = ["answer", "stop", "off_topic", "correction_request"] as const;
export type AnswerRelevanceVerdict = typeof ANSWER_RELEVANCE_VERDICTS[number];
export type AnswerRelevanceResult = { isAnswer: boolean; checked: boolean; verdict?: AnswerRelevanceVerdict; reason?: string; failureReason?: string };

const DEFAULT_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = [
  "You check one message in a TBCT counseling session: how the participant's latest message relates to the question they were just asked. Choose one verdict.",
  "answer: it tries to answer in any way, even if partial, vague, very short, emotional, answering a slightly different thing (for example a feeling when a thought was asked), declining, asking to skip or pause, asking what the question means, or describing their own life in a way that could belong to the question.",
  "stop: it says there is nothing (more) to add, however it is typed -- including typos and chat shorthand of words like '없어요', '없음', '더 없어요', 'no', 'none' (for example '읎오', '업서요', 'ㄴㄴ').",
  "off_topic: it is plainly about something unrelated to the question, so recording it as the answer would be wrong -- small talk, a question to the counselor that has nothing to do with the question (arithmetic, the counselor's name, trivia), or a switch to an unrelated topic.",
  "correction_request: instead of answering, they want to change or remove something they said earlier (for example '아까 그건 잘못 쓴 거예요', '두 번째 건 빼 주세요').",
  "When unsure, choose answer.",
  "Give a short reason in English. Return your verdict with the submit_answer_relevance tool only.",
].join(" ");

const TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "reason"],
  properties: {
    verdict: { type: "string", enum: ANSWER_RELEVANCE_VERDICTS },
    reason: { type: "string", maxLength: 300 },
  },
} as const;

const toolOutputSchema = z.object({ verdict: z.enum(ANSWER_RELEVANCE_VERDICTS), reason: z.string().optional() });

export async function judgeAnswerRelevance(raw: AnswerRelevanceRequest, context: { sessionId: string; turnId: string }): Promise<AnswerRelevanceResult> {
  const request = answerRelevanceRequestSchema.parse(raw);
  // AI_PROVIDER=mock means no live model call of any kind (the simulated audit).
  if ((process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "mock") return { isAnswer: true, checked: false, failureReason: "provider_disabled" };
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) return { isAnswer: true, checked: false, failureReason: "missing_api_key" };
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  // Runs on every free-text turn before the dialogue agent, so it is kept
  // short; a miss simply stores the answer as before.
  const timeoutMs = Math.min(8000, Math.max(2000, Number(process.env.ANSWER_RELEVANCE_TIMEOUT_MS ?? 6000)));
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
        messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({ ...request, answer: redactDirectIdentifiers(request.answer) }) }] }],
        tools: [{ name: "submit_answer_relevance", description: "Submit how the participant's message relates to the question.", input_schema: TOOL_SCHEMA }],
        tool_choice: { type: "tool", name: "submit_answer_relevance", disable_parallel_tool_use: true },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
      throw new Error(`Anthropic answer relevance failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    const json = (await response.json()) as { content?: Array<{ type?: string; name?: string; input?: unknown }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    const toolInput = json.content?.find((item) => item.type === "tool_use" && item.name === "submit_answer_relevance")?.input;
    const parsed = toolOutputSchema.safeParse(toolInput);
    if (!parsed.success) throw new Error(`Anthropic answer relevance returned no usable verdict (stop_reason=${json.stop_reason ?? "unknown"})`);
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "input_assessment", llmCalled: true, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: json.usage?.input_tokens !== undefined && json.usage.output_tokens !== undefined ? json.usage.input_tokens + json.usage.output_tokens : null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: true });
    const verdict = parsed.data.verdict;
    return { isAnswer: verdict === "answer" || verdict === "stop", checked: true, verdict, reason: parsed.data.reason };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "answer relevance failed";
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "input_assessment", llmCalled: true, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: false, failureReason });
    return { isAnswer: true, checked: false, failureReason };
  }
}
