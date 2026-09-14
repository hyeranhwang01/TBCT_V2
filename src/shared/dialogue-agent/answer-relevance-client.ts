import type { AnswerRelevanceRequest, AnswerRelevanceResult } from "@/shared/dialogue-agent/answer-relevance";
import { runtimeFetch } from "@/shared/runtime/resolve-store-url";

// Same server/browser split as dialogue-agent-client.ts: server-side callers
// (the real patient turn, /api/runtime/turn) import the Anthropic
// implementation directly, keeping ANTHROPIC_API_KEY out of the browser
// bundle; browser-side callers go through the API route. Any failure counts
// as an answer -- the check must never block a turn.
export async function checkAnswerRelevance(request: AnswerRelevanceRequest, context: { sessionId: string; turnId: string }): Promise<AnswerRelevanceResult> {
  if (typeof window === "undefined") {
    const { judgeAnswerRelevance } = await import("@/shared/dialogue-agent/answer-relevance");
    return judgeAnswerRelevance(request, context);
  }
  try {
    const response = await runtimeFetch("/api/answer-relevance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, context }) });
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: AnswerRelevanceResult; error?: string } | null;
    if (!response.ok || !payload?.ok || !payload.data) return { isAnswer: true, checked: false, failureReason: payload?.error ?? "answer relevance request failed" };
    return payload.data;
  } catch (error) {
    return { isAnswer: true, checked: false, failureReason: error instanceof Error ? error.message : "answer relevance request failed" };
  }
}
