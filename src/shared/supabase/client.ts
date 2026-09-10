"use client";

import { createBrowserClient } from "@supabase/ssr";

// Single shared browser client -- safe to call repeatedly (createBrowserClient
// is cheap and stateless per call), but caching one instance avoids creating
// a fresh client (and its own auth-state listeners) on every render.
let client: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured.");
  }
  client = createBrowserClient(url, anonKey);
  return client;
}
