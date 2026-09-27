import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: user.current }, error: user.current ? null : new Error("no session") }) } }),
}));

import { getAuthenticatedCaller, getSignedInUser } from "@/shared/supabase/server";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  user.current = null;
});

describe("the caller every API route authorizes", () => {
  it("is a patient who wrote 'clinician' into their own metadata -- still a patient", async () => {
    user.current = { id: "u1", email: "p@x", user_metadata: { role: "clinician" }, app_metadata: { role: "patient" } };
    expect(await getAuthenticatedCaller()).toEqual({ userId: "u1", email: "p@x", role: "patient" });
  });

  it("is nobody when the account has no granted role (e.g. a clinician awaiting approval)", async () => {
    user.current = { id: "u2", email: "c@x", user_metadata: { role: "clinician" }, app_metadata: { role_request: "clinician" } };
    expect(await getAuthenticatedCaller()).toBeNull();
    expect(await getSignedInUser()).toMatchObject({ userId: "u2", role: null, requestedRole: "clinician", pendingRole: "clinician" });
  });

  it("is nobody without a session", async () => {
    expect(await getAuthenticatedCaller()).toBeNull();
  });
});
