import { RUNTIME_STORE_ENDPOINT } from "@/shared/runtime/runtime-store-ops";
import { PARTICIPANT_STORE_ENDPOINT } from "@/shared/runtime/participant-store-ops";
import { SAFETY_STORE_ENDPOINT } from "@/shared/runtime/safety-store-ops";
import { PROTOCOL_STUDIO_STORE_ENDPOINT } from "@/shared/runtime/protocol-studio-store-ops";
import { WORKSHEET_STORE_ENDPOINT } from "@/shared/runtime/worksheet-store-ops";
import { HOMEWORK_STORE_ENDPOINT } from "@/shared/runtime/homework-store-ops";
import { dispatchFakeRuntimeStoreOp, resetFakeRuntimeStore } from "@/test/fakes/runtime-session-store.fake";
import { dispatchFakeParticipantStoreOp, resetFakeParticipantStore } from "@/test/fakes/participant-store.fake";
import { dispatchFakeSafetyStoreOp, resetFakeSafetyStore } from "@/test/fakes/safety-store.fake";
import { dispatchFakeProtocolStudioStoreOp, resetFakeProtocolStudioStore } from "@/test/fakes/protocol-studio-store.fake";
import { dispatchFakeWorksheetStoreOp, resetFakeWorksheetStore } from "@/test/fakes/worksheet-store.fake";
import { dispatchFakeHomeworkStoreOp, resetFakeHomeworkStore } from "@/test/fakes/homework-store.fake";
import { dispatchFakeDialogueAgent } from "@/test/fakes/dialogue-agent.fake";
import { dialogueContractSchema } from "@/shared/dialogue-agent/dialogue-agent-contract";

// The runtime conversation store now lives in Postgres in production
// (src/app/api/runtime/session-store/route.ts), reached via fetch() from
// src/shared/data/repositories/runtime-session-repository.ts. Tests must stay fast,
// offline, and independent of the live database, so requests to that one
// endpoint are intercepted here and served from an in-memory fake with the
// exact same op contract; everything else falls through to the real fetch.
// The participant roster, clinician safety-monitoring store, and Protocol
// Studio audit log moved to Postgres the same way and are intercepted here
// too, for the same reason -- saveAuditEntry in particular is called from
// deep inside ordinary protocol/session writes, so leaving it unintercepted
// breaks any test that touches those paths, not just audit-log tests.
//
// This lives outside src/test/setup.ts because the offline audit scripts in
// scripts/ need exactly the same interception. Sharing one installer is what
// keeps the suite and those scripts from drifting apart -- the store contract
// is 94 ops across six endpoints, and a second hand-maintained copy would be
// wrong within a release.
const FAKE_STORES: Array<{ endpoint: string; dispatch: (op: unknown) => Promise<unknown> }> = [
  { endpoint: RUNTIME_STORE_ENDPOINT, dispatch: dispatchFakeRuntimeStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: PARTICIPANT_STORE_ENDPOINT, dispatch: dispatchFakeParticipantStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: SAFETY_STORE_ENDPOINT, dispatch: dispatchFakeSafetyStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: PROTOCOL_STUDIO_STORE_ENDPOINT, dispatch: dispatchFakeProtocolStudioStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: WORKSHEET_STORE_ENDPOINT, dispatch: dispatchFakeWorksheetStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: HOMEWORK_STORE_ENDPOINT, dispatch: dispatchFakeHomeworkStoreOp as (op: unknown) => Promise<unknown> },
];

// /api/dialogue-agent has a different body shape ({contract, context}, not
// an op union) so it's intercepted separately rather than folded into
// FAKE_STORES -- without this, the dialogue-agent client's browser-path
// fetch() (taken in jsdom's test environment, which defines `window`) would
// hit a real network address that doesn't exist under test, and every test
// would only ever see the "provider unavailable" deterministic fallback
// instead of a realistic classification to assert against.
const DIALOGUE_AGENT_ENDPOINT = "/api/dialogue-agent";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(error: unknown) {
  return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
}

let uninstall: (() => void) | null = null;

/**
 * Serves the six Postgres-backed store endpoints from the in-memory fakes.
 *
 * `interceptDialogueAgent` defaults to false -- the fail-safe direction. A
 * caller that forgets the flag gets the real dialogue provider, never a
 * silently faked clinical decision. The vitest suite opts in; the audit
 * scripts opt in only when no ANTHROPIC_API_KEY is configured, matching the
 * provider they already select for themselves.
 */
export function installFakeStoreFetch(options?: { interceptDialogueAgent?: boolean }) {
  if (uninstall) return uninstall;
  const interceptDialogueAgent = options?.interceptDialogueAgent ?? false;
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (interceptDialogueAgent && init?.method === "POST" && url.endsWith(DIALOGUE_AGENT_ENDPOINT)) {
      try {
        const body = JSON.parse(init!.body as string) as { contract: unknown };
        const contract = dialogueContractSchema.parse(body.contract);
        return jsonResponse({ ok: true, data: dispatchFakeDialogueAgent(contract) }, 200);
      } catch (error) {
        return errorResponse(error);
      }
    }
    // Compare pathnames, not string suffixes: the browser path sends the
    // relative endpoint while resolveStoreUrl prefixes an absolute origin
    // server-side, and new URL(url, base) normalizes both. endsWith used to
    // serve both shapes but accepted ANY host, so a server-side call that
    // went out to an unreachable absolute URL still matched here -- which is
    // why the suite stayed green through the 2026-09-13 production outage
    // (see runtime-request-context.ts).
    const requestPath = (() => {
      try {
        return new URL(url, "http://localhost:3000").pathname;
      } catch {
        return url;
      }
    })();
    const store = init?.method === "POST" ? FAKE_STORES.find((candidate) => candidate.endpoint === requestPath) : undefined;
    if (store) {
      try {
        const op = JSON.parse(init!.body as string);
        const result = await store.dispatch(op);
        return jsonResponse({ ok: true, result }, 200);
      } catch (error) {
        return errorResponse(error);
      }
    }
    return realFetch(input, init);
  }) as typeof fetch;

  uninstall = () => {
    globalThis.fetch = realFetch;
    uninstall = null;
  };
  return uninstall;
}

export function resetAllFakeStores() {
  resetFakeRuntimeStore();
  resetFakeParticipantStore();
  resetFakeSafetyStore();
  resetFakeProtocolStudioStore();
  resetFakeWorksheetStore();
  resetFakeHomeworkStore();
}
