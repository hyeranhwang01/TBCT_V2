import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { resolveAppUrl } from "@/shared/notifications/resend-client";

// Server-only Supabase client using the service-role key -- this bypasses
// RLS and Auth entirely (full admin access), so it must never be imported
// from a client component and must never have its key exposed to the
// browser (SUPABASE_SERVICE_ROLE_KEY, unlike NEXT_PUBLIC_SUPABASE_ANON_KEY,
// carries no NEXT_PUBLIC_ prefix on purpose). Its only job here is the one
// thing nothing else in this app can do: resolving a Supabase Auth user id
// to their email, and enumerating registered clinicians -- there is no
// clinician-profile table, and no way to look up another user's identity
// through an ordinary (anon-key) client, which only ever sees the calling
// user's own session.
let client: ReturnType<typeof createClient> | undefined;

function getAdminClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured.");
  }
  client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // supabase-js always initializes a Realtime sub-client, which needs a
    // WebSocket constructor -- Node 20 (this project's runtime) has none as
    // a global (added only in Node 21+), so without this the client throws
    // immediately on construction. This admin client never subscribes to
    // anything, but still has to satisfy the constructor.
    realtime: { transport: WebSocket as unknown as never },
  });
  return client;
}

/** Every registered clinician's email -- used to decide who receives a
 * safety-alert email (src/shared/notifications/send-safety-alert.ts) when no
 * specific clinician is assigned to the participant yet. Paginates through
 * every registered user since `listUsers` caps at 1000/page by default;
 * fine at this app's current scale, revisit if the clinician roster grows
 * into the thousands. */
export async function listClinicianEmails(): Promise<string[]> {
  const admin = getAdminClient();
  const emails: string[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      if (user.user_metadata?.role === "clinician" && user.email) emails.push(user.email);
    }
    if (data.users.length < 1000) break;
    page += 1;
  }
  return emails;
}

/** Resolves a single auth user id to their email -- used to display
 * `RuntimeParticipant.assignedClinician` (a raw auth user id) as a real
 * email in the clinician-facing UI, and to email a specific assigned
 * clinician directly instead of the whole roster. Returns null if the user
 * no longer exists (e.g. deleted account). */
export async function getUserEmail(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return null;
  return data.user.email ?? null;
}

export interface AdminUserSummary {
  id: string;
  email: string | null;
  role: "clinician" | "patient" | "admin" | null;
  createdAt: string;
  banned: boolean;
}

/** Every registered user, any role -- used only by the admin-only account
 * management page (src/app/api/admin/users/route.ts gates the caller
 * before this is ever reached). This is the direct answer to "clinicians
 * can self-signup with no gatekeeping" -- an admin can see who signed up
 * and ban them, since nothing else in this app can enumerate identities
 * across roles. */
export async function listAllUsers(): Promise<AdminUserSummary[]> {
  const admin = getAdminClient();
  const users: AdminUserSummary[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      const role = user.user_metadata?.role;
      users.push({
        id: user.id,
        email: user.email ?? null,
        role: role === "clinician" || role === "patient" || role === "admin" ? role : null,
        createdAt: user.created_at,
        // banned_until is a far-future timestamp once banned (see
        // setUserBanned's own ban_duration value), "none" otherwise.
        banned: Boolean(user.banned_until) && new Date(user.banned_until as string) > new Date(),
      });
    }
    if (data.users.length < 1000) break;
    page += 1;
  }
  return users;
}

/** Bans or unbans a user -- Supabase has no "delete" semantics here on
 * purpose (deleting a clinician's account would orphan every patient note/
 * assignment/audit entry pointing at that user id); banning blocks sign-in
 * without touching anything else this app has already recorded about them. */
export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  const admin = getAdminClient();
  // Supabase's ban_duration accepts a duration string, not a boolean --
  // "none" lifts an existing ban; there's no permanent-ban keyword, so a
  // 100-year duration is this SDK's own documented way to express one.
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: banned ? "876000h" : "none" });
  if (error) throw error;
}

/** One-time admin bootstrap: invites a brand-new user by email with
 * role="admin" already set in user_metadata, so the very first admin
 * doesn't need to sign up through any self-service flow (there isn't
 * one, deliberately -- see this app's clinician self-signup problem this
 * feature exists to address) and doesn't need a temporary password
 * handed to them out of band. Supabase sends its own invite email (a
 * magic link to set a password); this is NOT wired into any UI -- run
 * once, by hand, for the initial admin only. */
export async function inviteAdminUser(email: string): Promise<{ id: string; email: string | null }> {
  const admin = getAdminClient();
  // Without redirectTo, the invite email's final redirect falls back to
  // the Supabase project's dashboard Site URL -- and even once that's
  // pointed at production, landing on an ordinary page leaves the invite's
  // one-time ?code= sitting unused, since only set-password-page.tsx knows
  // to exchange it for a session. This is what actually lets the invited
  // admin set a password at all.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role: "admin" },
    redirectTo: `${resolveAppUrl()}/set-password`,
  });
  if (error) throw error;
  return { id: data.user.id, email: data.user.email ?? null };
}
