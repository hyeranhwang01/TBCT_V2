// Where a user's role comes from (.claude/TASK_SCOPE.json
// note2026_09_27_roles_from_app_metadata). The only role this app trusts is
// the one in Supabase app_metadata, which only the server (service-role key)
// can write. user_metadata is editable by the user themselves
// (supabase.auth.updateUser), so a role there is only what they asked for at
// signup -- a request, never a permission. Until 2026-09-27 the app read the
// role from user_metadata, so any patient could make themselves a clinician.
//
// How a role is granted:
//  - patient: automatically, by /api/auth/claim-role, when the signup asked
//    for it (the same as patient self-signup always was);
//  - clinician: a signup that asks for it is recorded as a pending request
//    (app_metadata.role_request); an admin approves it on the account page;
//  - admin: by the invite script (inviteAdminUser) or an admin.
//
// Isomorphic: read by the browser (auth-context.tsx) and the server
// (server.ts, admin.ts).

// assessor: blinded outcome assessor (Protocol V9 p.9) -- enters and reads
// outcome assessments, never allocations, arms or conversations.
// coordinator: screening, consent, enrolment, scheduling.
export type AppRole = "clinician" | "patient" | "admin" | "assessor" | "coordinator";
export const APP_ROLES: readonly AppRole[] = ["clinician", "patient", "admin", "assessor", "coordinator"];

/** Roles the pre-trial API routes understand. Those routes restrict "patient"
 * and give every other role full access, so a role they do not know must not
 * reach them at all (getAuthenticatedCaller returns null for it). */
export const LEGACY_ROUTE_ROLES: readonly AppRole[] = ["clinician", "patient", "admin"];
export type RequestableRole = "clinician" | "patient";

type UserLike = { app_metadata?: Record<string, unknown> | null; user_metadata?: Record<string, unknown> | null } | null | undefined;

function asRole(value: unknown): AppRole | null {
  return APP_ROLES.includes(value as AppRole) ? (value as AppRole) : null;
}

/** The role the server granted -- the only one to authorize with. */
export function grantedRole(user: UserLike): AppRole | null {
  return asRole(user?.app_metadata?.role);
}

/** What the signup asked for (user-editable; never a permission). */
export function requestedRole(user: UserLike): RequestableRole | null {
  const role = user?.user_metadata?.role;
  return role === "clinician" || role === "patient" ? role : null;
}

/** A clinician request waiting for an admin. */
export function pendingRole(user: UserLike): "clinician" | null {
  return !grantedRole(user) && user?.app_metadata?.role_request === "clinician" ? "clinician" : null;
}
