import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-only Supabase client (Route Handlers, middleware) -- reads the
// session from the request's cookies so a route handler can learn which
// authenticated user is calling it, then uses that identity for
// authorization checks (see src/lib/server/*-store.ts). Cookie writes are
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
 * is no valid session. `role` mirrors what auth-context.tsx reads
 * client-side (user_metadata.role, set at signup). Route handlers use this
 * for authorization -- see runtime-execution-api.ts's callers. */
export async function getAuthenticatedCaller() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const role = data.user.user_metadata?.role;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    role: role === "clinician" || role === "patient" || role === "admin" ? role : null,
  };
}
