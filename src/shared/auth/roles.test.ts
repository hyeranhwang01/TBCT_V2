import { describe, expect, it } from "vitest";
import { grantedRole, pendingRole, requestedRole } from "@/shared/auth/roles";

describe("where a role comes from", () => {
  it("trusts only app_metadata; a role the user wrote into user_metadata grants nothing", () => {
    expect(grantedRole({ user_metadata: { role: "clinician" } })).toBeNull();
    expect(grantedRole({ user_metadata: { role: "admin" }, app_metadata: { role: "patient" } })).toBe("patient");
    expect(grantedRole({ app_metadata: { role: "clinician" } })).toBe("clinician");
    expect(grantedRole({ app_metadata: { role: "superuser" } })).toBeNull();
    expect(grantedRole(null)).toBeNull();
  });

  it("reads the signup's request, and a pending clinician request only while nothing is granted", () => {
    expect(requestedRole({ user_metadata: { role: "clinician" } })).toBe("clinician");
    expect(requestedRole({ user_metadata: { role: "admin" } })).toBeNull();
    expect(pendingRole({ app_metadata: { role_request: "clinician" } })).toBe("clinician");
    expect(pendingRole({ app_metadata: { role_request: "clinician", role: "patient" } })).toBeNull();
  });
});
