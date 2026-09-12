import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// The 2026-09-13 production outage this file guards: a store call made from
// server code went out as an absolute https://${VERCEL_URL}... URL, was
// answered by Deployment Protection with an SSO page, and the resulting
// throw was swallowed -- every worksheet stayed empty and a safety-triggered
// turn could fail outright. The suite missed it because the fake store
// matched any host (install-fake-store-fetch.ts) and because a patient turn
// under NODE_ENV=test takes the browser path, never the server one. So this
// asserts the boundary itself: a mapped store op is handled in process and
// no network fetch happens at all.

vi.mock("@/shared/data/server/runtime-session-store", () => ({ dispatchRuntimeStoreOp: vi.fn(async () => ({ store: "runtime" })) }));
vi.mock("@/shared/data/server/worksheet-store", () => ({ dispatchWorksheetStoreOp: vi.fn(async () => ({ store: "worksheet" })) }));
vi.mock("@/shared/data/server/safety-monitoring-store", () => ({ dispatchSafetyStoreOp: vi.fn(async () => ({ store: "safety" })) }));
vi.mock("@/shared/data/server/participant-store", () => ({ dispatchParticipantStoreOp: vi.fn(async () => ({ store: "participant" })) }));
vi.mock("@/shared/data/server/homework-store", () => ({ dispatchHomeworkStoreOp: vi.fn(async () => ({ store: "homework" })) }));

await import("@/shared/data/server/runtime-request-context");
const { runWithRuntimeRequestContext } = await import("@/shared/data/server/runtime-request-context");

type InternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const internalFetch = (globalThis as typeof globalThis & { __tbctInternalFetch?: InternalFetch }).__tbctInternalFetch!;

const DEPLOYMENT_URL = "https://tbct-v2-abc123-tbct.vercel.app";
const MAPPED = [
  { endpoint: "/api/runtime/session-store", store: "runtime" },
  { endpoint: "/api/worksheets/store", store: "worksheet" },
  { endpoint: "/api/safety/store", store: "safety" },
  { endpoint: "/api/participants/store", store: "participant" },
  { endpoint: "/api/homework/store", store: "homework" },
];

let networkFetch: MockInstance<typeof fetch>;
beforeEach(() => {
  networkFetch = vi.spyOn(globalThis, "fetch");
});

describe("server store calls never leave the process", () => {
  it("dispatches every mapped store in process, for a relative and an absolute deployment URL alike", async () => {
    for (const { endpoint, store } of MAPPED) {
      for (const url of [endpoint, `${DEPLOYMENT_URL}${endpoint}`]) {
        const response = await internalFetch(url, { method: "POST", body: JSON.stringify({ op: "noop" }) });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, result: { store } });
      }
    }
    // The whole point: not one of those ten calls went out over the network.
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("reports a failing store op the same way the route does, without failing the caller's fetch", async () => {
    const { dispatchWorksheetStoreOp } = await import("@/shared/data/server/worksheet-store");
    vi.mocked(dispatchWorksheetStoreOp).mockRejectedValueOnce(new Error("relation does not exist"));

    const response = await internalFetch(`${DEPLOYMENT_URL}/api/worksheets/store`, { method: "POST", body: JSON.stringify({ op: "getInstance" }) });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "relation does not exist" });
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("still sends an unmapped endpoint over the network, carrying the request's cookie", async () => {
    networkFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const request = new Request("https://tbct-v2.vercel.app/api/runtime/turn", { headers: { cookie: "sb-access-token=abc" } });

    await runWithRuntimeRequestContext(request, async () => {
      await internalFetch("/api/dialogue-agent", { method: "POST", body: JSON.stringify({ contract: {} }) });
    });

    expect(networkFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = networkFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://tbct-v2.vercel.app/api/dialogue-agent");
    expect(new Headers(init.headers).get("cookie")).toBe("sb-access-token=abc");
  });

  it("leaves a GET alone even on a mapped endpoint (only op bodies are dispatched)", async () => {
    networkFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await internalFetch(`${DEPLOYMENT_URL}/api/worksheets/store`);
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });
});
