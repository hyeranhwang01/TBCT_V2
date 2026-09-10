import type { RuntimeSessionView } from "@/types/runtime-session";

export async function saveRemoteSessionAuditSnapshot(view: RuntimeSessionView) {
  const response = await fetch("/api/audit/session-snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeSessionId: view.session.id,
      sessionVersion: view.session.version ?? 0,
      capturedAt: new Date().toISOString(),
      snapshot: {
        session: view.session,
        messages: view.messages,
        logs: view.logs,
        checkpoints: view.checkpoints,
        escalations: view.escalations,
        providerEvents: view.providerEvents,
        validationEvents: view.validationEvents,
        executionTraces: (view as RuntimeSessionView & { executionTraces?: unknown[] }).executionTraces ?? [],
      },
    }),
  });
  if (!response.ok) throw new Error("Remote audit snapshot could not be saved.");
}
