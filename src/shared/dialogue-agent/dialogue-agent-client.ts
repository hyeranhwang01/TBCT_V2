import type { DialogueAgentResult, DialogueContract } from "@/shared/dialogue-agent/dialogue-agent-contract";

// Same server/browser split as callPatientRenderer in runtime-orchestrator.ts:
// server-side callers import the Anthropic implementation directly (keeps
// ANTHROPIC_API_KEY out of the browser bundle); browser-side callers go
// through the API route.
export async function callDialogueAgent(contract: DialogueContract, context: { sessionId: string; turnId: string }): Promise<DialogueAgentResult> {
  if (typeof window === "undefined") {
    const { generateDialogueDecision } = await import("@/shared/dialogue-agent/anthropic-dialogue-agent");
    return generateDialogueDecision(contract, context);
  }
  const response = await runtimeFetch("/api/dialogue-agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contract, context }) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    return {
      decision: { responseType: "reflect_and_ask", patientFacingMessage: contract.currentTaskText, keepCurrentNode: true, participantResponseState: "valid_answer" },
      provider: "none",
      failed: true,
      failureReason: payload?.error ?? "dialogue agent request failed",
    };
  }
  return payload.data as DialogueAgentResult;
}
import { runtimeFetch } from "@/shared/runtime/resolve-store-url";
