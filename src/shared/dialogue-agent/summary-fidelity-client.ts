import type { SummaryFidelityRequest, SummaryFidelityResult } from "@/shared/dialogue-agent/summary-fidelity";
import { runtimeFetch } from "@/shared/runtime/resolve-store-url";

// Same server/browser split as answer-relevance-client.ts: server-side callers
// import the Anthropic implementation directly, browser-side callers go
// through the API route. Any failure is "not checked" -- the turn ships, and
// no summary from it is recorded.
export async function checkSummaryFidelity(request: SummaryFidelityRequest, context: { sessionId: string; turnId: string }): Promise<SummaryFidelityResult> {
  if (typeof window === "undefined") {
    const { judgeSummaryFidelity } = await import("@/shared/dialogue-agent/summary-fidelity");
    return judgeSummaryFidelity(request, context);
  }
  try {
    const response = await runtimeFetch("/api/summary-fidelity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, context }) });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: SummaryFidelityResult; error?: string } | null;
    if (!response.ok || !payload?.ok || !payload.data) return { faithful: true, checked: false, failureReason: payload?.error ?? "summary fidelity request failed" };
    return payload.data;
  } catch (error) {
    return { faithful: true, checked: false, failureReason: error instanceof Error ? error.message : "summary fidelity request failed" };
  }
}
