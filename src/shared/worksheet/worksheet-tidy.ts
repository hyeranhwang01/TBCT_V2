// The worksheet's display text (.claude/TASK_SCOPE.json
// note2026_10_05_worksheet_display_version, option 2 chosen by the user): a
// separate small model call that tidies the words a turn just recorded, so
// the worksheet does not show speech tails like "~했는데 그런 것 같아". The
// recorded value stays the participant's exact words (Common prompt §5,
// Patient Authorship Invariant); this only produces what the worksheet
// shows, and checkFieldDisplay (prompt-driven-sessions.ts) still rejects
// anything not drawn from those words. The session prompt is not involved.
//
// Never blocks the turn: no key / AI_PROVIDER=mock, a failure or the time
// limit all return {} and the worksheet shows the recorded words.
//
// Only the newly recorded values go out -- the same words the session model
// has just been sent -- with their field labels; nothing else from the
// conversation. Same fetch / forced tool / usage shape as chunk-tagger.ts.

import { z } from "zod";
import { recordModelUsage } from "@/shared/assessment/model-observability";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const TOOL_NAME = "submit_worksheet_text";
const TIMEOUT_MS = 5000;

const SYSTEM = `You prepare the text a participant sees on their own worksheet in a cognitive-therapy program (Trial-Based Cognitive Therapy). Each item is something the participant said, recorded word for word; you return the version the worksheet shows. The words are in Korean or English.

Clean, do not rewrite:
- Drop fillers, repetitions, false starts and conversational tails ("음", "그러니까", "~했는데", a trailing "그런 것 같아요" that is only a way of talking).
- Keep their own words and their order. Add nothing they did not say. Do not summarise, explain or correct.
- For thoughts, beliefs and feelings keep their wording, and keep a hedge that says how sure they are ("~인 것 같아요" in "제가 무능한 것 같아요"). Never relabel: "기분이 좋았을 것 같아요" never becomes "기쁨".
- Keep the participant's politeness level and sentence endings when the item is a full sentence.
- If an item is already clean, return it unchanged.

Examples:
- Situation. Said: "어 그게 어제 회의 때였는데 팀장님이 제 보고서를 그냥 넘겼거든요 그런 것 같아요" → "어제 회의 때 팀장님이 제 보고서를 그냥 넘겼어요"
- Thought. Said: "음 그러니까 제가 좀 무능한 사람인 것 같다 그런 생각이 들었어요" → "제가 무능한 사람인 것 같다는 생각이 들었어요"

Return every item by its name. For a list, return one text per entry, in the same order.`;

export type TidyItem = { name: string; label: string; value: string | string[] };
type Tidier = (items: TidyItem[], context: { sessionId: string }) => Promise<Record<string, unknown>>;

let tidierForTests: Tidier | undefined;
/** Tests replace the model call. */
export function setWorksheetTidierForTests(tidier: Tidier | undefined) {
  tidierForTests = tidier;
}

const toolOutput = z.object({
  items: z.array(z.object({ name: z.string(), text: z.string().optional(), list: z.array(z.string()).optional() })),
});

async function callAnthropic(items: TidyItem[], context: { sessionId: string }): Promise<Record<string, unknown>> {
  if ((process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "mock") return {};
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) return {};
  const model = process.env.WORKSHEET_TIDY_MODEL ?? DEFAULT_MODEL;
  const started = performance.now();
  const usageBase = { sessionId: context.sessionId, turnId: "worksheet-tidy", provider: "anthropic", model, purpose: "worksheet_tidy" as const, llmCalled: true, retryCount: 0, estimatedCost: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const body = items
      .map((item) => `<item name="${item.name}" label="${item.label}" kind="${Array.isArray(item.value) ? "list" : "text"}">\n${Array.isArray(item.value) ? item.value.map((entry, index) => `${index + 1}. ${entry}`).join("\n") : item.value}\n</item>`)
      .join("\n");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: body }] }],
        tools: [{
          name: TOOL_NAME,
          description: "Submit the worksheet text for every item.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    text: { type: "string", description: "For a single item." },
                    list: { type: "array", items: { type: "string" }, description: "For a list item, one entry per entry given, same order." },
                  },
                },
              },
            },
          },
        }],
        tool_choice: { type: "tool", name: TOOL_NAME, disable_parallel_tool_use: true },
      }),
    });
    if (!response.ok) throw new Error(`Anthropic worksheet tidy failed (${response.status})`);
    const json = (await response.json()) as { content?: Array<{ type?: string; name?: string; input?: unknown }>; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
    const parsed = toolOutput.safeParse(json.content?.find((item) => item.type === "tool_use" && item.name === TOOL_NAME)?.input);
    if (!parsed.success) throw new Error("Worksheet tidy answer missing or malformed");
    recordModelUsage({ ...usageBase, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: null, latencyMs: Math.round(performance.now() - started), cacheStatus: (json.usage?.cache_read_input_tokens ?? 0) > 0 ? "hit" : "miss", success: true });
    const asked = new Map(items.map((item) => [item.name, item]));
    const result: Record<string, unknown> = {};
    for (const entry of parsed.data.items) {
      const item = asked.get(entry.name);
      if (!item) continue;
      if (Array.isArray(item.value)) {
        if (entry.list) result[entry.name] = entry.list;
      } else if (typeof entry.text === "string") {
        result[entry.name] = entry.text;
      }
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worksheet tidy failed";
    recordModelUsage({ ...usageBase, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), cacheStatus: "none", success: false, failureReason: message });
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

/** Off unless WORKSHEET_TIDY=on (2026-10-06, by the user): in use the tidy
 * text cut the middle of a situation ("피곤하니까 더 실수하고 놓칠까봐
 * 불안해서" dropped, leaving a sentence that no longer made sense) and turned
 * "~같아" into "~같아요"; the check let both through, since it only asked
 * whether the text came from the words. Until both are fixed the worksheet
 * shows the recorded words. */
export function worksheetTidyEnabled() {
  return (process.env.WORKSHEET_TIDY ?? "").trim().toLowerCase() === "on";
}

/** Display text for the given recorded values, by field name; {} when the
 * call is not configured or fails. Unchecked: pass it to checkFieldDisplay. */
export async function tidyWorksheetValues(items: TidyItem[], context: { sessionId: string }): Promise<Record<string, unknown>> {
  if (!items.length) return {};
  try {
    return await (tidierForTests ?? callAnthropic)(items, context);
  } catch {
    return {};
  }
}
