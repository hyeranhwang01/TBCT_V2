import { TRIAL_STORE_ENDPOINT, type TrialStoreOp } from "@/shared/trial/trial-store-ops";
import { resolveStoreUrl, runtimeFetch } from "@/shared/runtime/resolve-store-url";

// Thin client over /api/trial/store (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend). On the server it is dispatched in process
// (runtime-request-context.ts). `actor` is never sent: the route fills it in.
export async function callTrialStore<T>(op: TrialStoreOp): Promise<T> {
  const { actor: _ignored, ...body } = op;
  const response = await runtimeFetch(resolveStoreUrl(TRIAL_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload?.error ?? "Trial store operation failed.");
  return payload.result as T;
}
