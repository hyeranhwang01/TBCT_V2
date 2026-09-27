import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { grantedRole, pendingRole, requestedRole } from "@/shared/auth/roles";

// Server-only Supabase client (Route Handlers, middleware) -- reads the
// session from the request's cookies so a route handler can learn which
// authenticated user is calling it, then uses that identity for
// authorization checks (see src/shared/data/server/*-store.ts). Cookie writes are
// wrapped in try/catch: called from a context that can't mutate cookies
// (there isn't one in this app's Route-Handler-only setup, but the
// @supabase/ssr docs require guarding it since the same client shape is
// reused from Server Components in other apps), middleware.ts is the
// fallback that keeps the session cookie fresh either way.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured.");
  }
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a context that can't set cookies -- middleware.ts
          // refreshes the session cookie on every request regardless.
        }
      },
    },
  });
}

/** The authenticated caller's id + role for this request, or null if there
 * is no valid session OR no role the server has granted. The role comes from
 * app_metadata only (src/shared/auth/roles.ts) -- user_metadata is editable
 * by the user, so trusting it let any patient become a clinician. A user
 * without a granted role (a clinician signup awaiting approval) is treated as
 * not authenticated: most routes restrict only role "patient" and would
 * otherwise give a role-less caller full access. Route handlers use this for
 * authorization -- see runtime-execution-api.ts's callers. getUser() reads the
 * user from Supabase Auth, so a newly granted role counts at once. */
export async function getAuthenticatedCaller() {
  const user = await getSignedInUser();
  if (!user?.role) return null;
  return { userId: user.userId, email: user.email, role: user.role };
}

/** The signed-in user whatever their role -- only for /api/auth/claim-role,
 * which is where a role gets granted. Every other route uses
 * getAuthenticatedCaller. */
export async function getSignedInUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    role: grantedRole(data.user),
    requestedRole: requestedRole(data.user),
    pendingRole: pendingRole(data.user),
  };
}
