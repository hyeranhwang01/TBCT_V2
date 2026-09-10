// Every *-store repository (participant-repository.ts, worksheet-repository.ts,
// etc.) calls its endpoint as a bare path like "/api/participants/store".
// That resolves fine from the browser (relative to window.location) -- which
// is where almost all of this app's business logic actually runs (see
// runtime-execution-api.ts, imported only by "use client" page components).
// But a relative URL passed to fetch() from genuine Node.js server code
// (a Vercel Cron route, or any future real Route Handler that reads store
// data) throws "Failed to parse URL" -- there is no implicit origin to
// resolve against server-side. This prepends an absolute base ONLY when
// running server-side; every existing browser call is returned unchanged.
export function resolveStoreUrl(endpoint: string): string {
  if (typeof window !== "undefined") return endpoint;
  const host = process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = host ? `https://${host}` : "http://localhost:3000";
  return `${base}${endpoint}`;
}

type InternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const INTERNAL_FETCH_KEY = "__tbctInternalFetch";

/** Uses the normal browser fetch, or the request-scoped authenticated fetch
 * installed by the server turn endpoint. Kept in this client-safe module so
 * shared runtime code never imports node:async_hooks into the browser bundle. */
export function runtimeFetch(input: string | URL | Request, init?: RequestInit) {
  const internal = (globalThis as typeof globalThis & { [INTERNAL_FETCH_KEY]?: InternalFetch })[INTERNAL_FETCH_KEY];
  return internal ? internal(input, init) : fetch(input, init);
}
