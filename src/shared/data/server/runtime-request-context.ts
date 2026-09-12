import { AsyncLocalStorage } from "node:async_hooks";
import { dispatchRuntimeStoreOp } from "@/shared/data/server/runtime-session-store";
import { dispatchWorksheetStoreOp } from "@/shared/data/server/worksheet-store";
import { dispatchSafetyStoreOp } from "@/shared/data/server/safety-monitoring-store";
import { dispatchParticipantStoreOp } from "@/shared/data/server/participant-store";
import { dispatchHomeworkStoreOp } from "@/shared/data/server/homework-store";
import { RUNTIME_STORE_ENDPOINT } from "@/shared/runtime/runtime-store-ops";
import { WORKSHEET_STORE_ENDPOINT } from "@/shared/runtime/worksheet-store-ops";
import { SAFETY_STORE_ENDPOINT } from "@/shared/runtime/safety-store-ops";
import { PARTICIPANT_STORE_ENDPOINT } from "@/shared/runtime/participant-store-ops";
import { HOMEWORK_STORE_ENDPOINT } from "@/shared/runtime/homework-store-ops";

type RequestContext = { cookie: string; origin: string };
type InternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const storage = new AsyncLocalStorage<RequestContext>();
const INTERNAL_FETCH_KEY = "__tbctInternalFetch";

// A store call made from server code must never go back out over the
// network. resolveStoreUrl turns the bare endpoint into
// `https://${VERCEL_URL}...`, and VERCEL_URL is the deployment-specific
// host, which Vercel Deployment Protection answers with an SSO page
// (401/403) -- the repository then throws inside response.json(). That is
// exactly how the worksheet projection failed silently in production on
// 2026-09-13 (runtime-execution-api.ts's projection call swallowed it) and
// how a safety-triggered turn could fail outright, since the safety store
// calls on that path have no catch at all. Dispatching in process removes
// the round trip and the auth boundary along with it.
//
// Matching on pathname (not the whole URL) is what makes this work for both
// shapes: the browser sends "/api/...", the server an absolute URL, and
// new URL().pathname gives the same key for both.
//
// The response shape below must stay byte-identical to each route's own
// ({ok:true,result} / {ok:false,error} + 500), because every repository's
// callStore checks `!response.ok || !body.ok`.
//
// Auth note: these five routes are reached only from a server turn, and
// /api/runtime/turn already verified the caller and their ownership of the
// session before this runs. The participants route is the only one of the
// five that carries its own check, so do NOT wrap an unauthenticated route
// in runWithRuntimeRequestContext -- that would hand it this same bypass.
// (homework-repository still uses plain fetch rather than runtimeFetch, so
// its entry here has no effect yet; it costs nothing and starts working the
// moment that call is switched over.)
const IN_PROCESS_STORES = new Map<string, (op: never) => Promise<unknown>>([
  [RUNTIME_STORE_ENDPOINT, dispatchRuntimeStoreOp as (op: never) => Promise<unknown>],
  [WORKSHEET_STORE_ENDPOINT, dispatchWorksheetStoreOp as (op: never) => Promise<unknown>],
  [SAFETY_STORE_ENDPOINT, dispatchSafetyStoreOp as (op: never) => Promise<unknown>],
  [PARTICIPANT_STORE_ENDPOINT, dispatchParticipantStoreOp as (op: never) => Promise<unknown>],
  [HOMEWORK_STORE_ENDPOINT, dispatchHomeworkStoreOp as (op: never) => Promise<unknown>],
]);

const authenticatedFetch: InternalFetch = async (input, init = {}) => {
  const context = storage.getStore();
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = rawUrl.startsWith("/") ? `${context?.origin ?? "http://localhost:3000"}${rawUrl}` : rawUrl;
  const dispatch = init.body ? IN_PROCESS_STORES.get(new URL(url).pathname) : undefined;
  if (dispatch) {
    try {
      const result = await dispatch(JSON.parse(String(init.body)) as never);
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Store operation failed." }, { status: 500 });
    }
  }
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (context?.cookie) headers.set("cookie", context.cookie);
  return fetch(url, { ...init, headers });
};

(globalThis as typeof globalThis & { [INTERNAL_FETCH_KEY]?: InternalFetch })[INTERNAL_FETCH_KEY] = authenticatedFetch;

export function runWithRuntimeRequestContext<T>(request: Request, operation: () => T): T {
  return storage.run({ cookie: request.headers.get("cookie") ?? "", origin: new URL(request.url).origin }, operation);
}
