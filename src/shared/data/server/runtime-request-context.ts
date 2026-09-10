import { AsyncLocalStorage } from "node:async_hooks";
import { dispatchRuntimeStoreOp } from "@/shared/data/server/runtime-session-store";
import { RUNTIME_STORE_ENDPOINT, type RuntimeStoreOp } from "@/shared/runtime/runtime-store-ops";

type RequestContext = { cookie: string; origin: string };
type InternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const storage = new AsyncLocalStorage<RequestContext>();
const INTERNAL_FETCH_KEY = "__tbctInternalFetch";

const authenticatedFetch: InternalFetch = async (input, init = {}) => {
  const context = storage.getStore();
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = rawUrl.startsWith("/") ? `${context?.origin ?? "http://localhost:3000"}${rawUrl}` : rawUrl;
  if (new URL(url).pathname === RUNTIME_STORE_ENDPOINT && init.body) {
    try {
      const op = JSON.parse(String(init.body)) as RuntimeStoreOp;
      const result = await dispatchRuntimeStoreOp(op);
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Runtime store operation failed." }, { status: 500 });
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
