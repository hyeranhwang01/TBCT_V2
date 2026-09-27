import { beforeEach, describe, expect, it, vi } from "vitest";

const caller = vi.hoisted(() => ({ current: null as null | { userId: string; email: string | null; role: string } }));
const calls = vi.hoisted(() => [] as unknown[]);
vi.mock("@/shared/supabase/server", () => ({ getAuthenticatedCaller: async () => caller.current }));
vi.mock("@/shared/supabase/admin", () => ({
  listAllUsers: async () => [],
  setUserBanned: async (userId: string, banned: boolean) => calls.push(["ban", userId, banned]),
  grantUserRole: async (userId: string, role: string | null) => calls.push(["role", userId, role]),
}));

import { POST } from "@/app/api/admin/users/route";

const post = async (body: unknown) => (await POST(new Request("http://test/api/admin/users", { method: "POST", body: JSON.stringify(body) }))).status;

beforeEach(() => {
  calls.length = 0;
  caller.current = { userId: "admin-1", email: null, role: "admin" };
});

describe("granting roles on the account page", () => {
  it("lets an admin approve a clinician and remove a role", async () => {
    expect(await post({ userId: "u2", role: "clinician" })).toBe(200);
    expect(await post({ userId: "u2", role: null })).toBe(200);
    expect(calls).toEqual([["role", "u2", "clinician"], ["role", "u2", null]]);
  });

  it("refuses anyone but an admin, an admin's own account, and unknown roles", async () => {
    caller.current = { userId: "c1", email: null, role: "clinician" };
    expect(await post({ userId: "u2", role: "clinician" })).toBe(403);
    caller.current = { userId: "admin-1", email: null, role: "admin" };
    expect(await post({ userId: "admin-1", role: null })).toBe(400);
    expect(await post({ userId: "u2", role: "superuser" })).toBe(400);
    expect(calls).toEqual([]);
  });

  it("still bans and unbans", async () => {
    expect(await post({ userId: "u2", banned: true })).toBe(200);
    expect(calls).toEqual([["ban", "u2", true]]);
  });
});
