import { resolveStoreUrl } from "@/shared/runtime/resolve-store-url";
import type { AdminUserSummary } from "@/shared/supabase/admin";

export type { AdminUserSummary };

const ADMIN_USERS_ENDPOINT = "/api/admin/users";

// Thin fetch client over src/app/api/admin/users/route.ts -- that route
// does the actual service-role lookup; this just calls it, matching the
// pattern of every other repository in this app.
export async function listAdminUsers(): Promise<AdminUserSummary[]> {
  const response = await fetch(resolveStoreUrl(ADMIN_USERS_ENDPOINT));
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Failed to list users.");
  return body.result as AdminUserSummary[];
}

export async function setAdminUserBanned(userId: string, banned: boolean): Promise<void> {
  const response = await fetch(resolveStoreUrl(ADMIN_USERS_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, banned }),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Failed to update user.");
}
