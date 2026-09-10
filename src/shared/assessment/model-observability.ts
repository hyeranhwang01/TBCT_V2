export type ModelPurpose = "input_assessment" | "field_extraction" | "safety_classification" | "patient_reflection" | "dialogue_agent" | "repair" | "approved_static" | "deterministic_parse" | "distortion_candidates";
export type ModelUsageEvent = { sessionId: string; turnId: string; provider: string; model?: string; purpose: ModelPurpose; llmCalled: boolean; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; latencyMs: number; retryCount: number; cacheStatus: "hit" | "miss" | "none"; estimatedCost: number | null; success: boolean; failureReason?: string };
const events: ModelUsageEvent[] = [];
export function recordModelUsage(event: ModelUsageEvent) { events.push(structuredClone(event)); }
export function listModelUsage(sessionId?: string) { return events.filter((event) => !sessionId || event.sessionId === sessionId).map((event) => structuredClone(event)); }
export function clearModelUsage() { events.length = 0; }
export function summarizeModelUsage(sessionId: string) {
  const selected = listModelUsage(sessionId);
  const byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number; estimatedCost: number; unknownCostCalls: number }> = {};
  const byPurpose: Record<string, number> = {};
  for (const event of selected) {
    byPurpose[event.purpose] = (byPurpose[event.purpose] ?? 0) + 1;
    const bucket = byProvider[event.provider] ??= { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0, unknownCostCalls: 0 };
    if (event.llmCalled) bucket.calls += 1;
    bucket.inputTokens += event.inputTokens ?? 0; bucket.outputTokens += event.outputTokens ?? 0;
    if (event.estimatedCost === null) bucket.unknownCostCalls += event.llmCalled ? 1 : 0; else bucket.estimatedCost += event.estimatedCost;
  }
  return { byProvider, byPurpose, staticTurnsAvoided: selected.filter((e) => e.purpose === "approved_static").length, deterministicTurnsAvoided: selected.filter((e) => e.purpose === "deterministic_parse").length, failedRequests: selected.filter((e) => !e.success).length, repairedRequests: selected.filter((e) => e.purpose === "repair").length };
}
