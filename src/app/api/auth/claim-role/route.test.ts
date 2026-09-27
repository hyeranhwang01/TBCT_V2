import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
const grants = vi.hoisted(() => [] as unknown[]);
vi.mock("@/shared/supabase/server", () => ({ getSignedInUser: async () => signedIn.current }));
vi.mock("@/shared/supabase/admin", () => ({
  grantUserRole: async (userId: string, role: string | null) => grants.push(["grant", userId, role]),
  requestClinicianRole: async (userId: string) => grants.push(["request", userId]),
}));

import { POST } from "@/app/api/auth/claim-role/route";

async function claim() {
  const response = await POST();
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  signedIn.current = null;
  grants.length = 0;
});

describe("claiming a role", () => {
  it("grants the patient role to a patient signup", async () => {
    signedIn.current = { userId: "u1", role: null, requestedRole: "patient", pendingRole: null };
    expect((await claim()).body.result).toEqual({ role: "patient" });
    expect(grants).toEqual([["grant", "u1", "patient"]]);
  });

  it("never grants clinician: the request is recorded as pending, once", async () => {
    signedIn.current = { userId: "u2", role: null, requestedRole: "clinician", pendingRole: null };
    expect((await claim()).body.result).toEqual({ role: null, pendingRole: "clinician" });
    signedIn.current = { userId: "u2", role: null, requestedRole: "clinician", pendingRole: "clinician" };
    await claim();
    expect(grants).toEqual([["request", "u2"]]);
  });

  it("changes nothing for an account that already has a role, and refuses without a session", async () => {
    signedIn.current = { userId: "u3", role: "patient", requestedRole: "clinician", pendingRole: null };
    expect((await claim()).body.result).toEqual({ role: "patient" });
    expect(grants).toEqual([]);
    signedIn.current = null;
    expect((await claim()).status).toBe(401);
  });
});
