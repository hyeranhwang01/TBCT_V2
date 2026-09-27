"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/shared/supabase/client";
import { grantedRole, pendingRole, type AppRole } from "@/shared/auth/roles";

export type { AppRole };

type AuthState = {
  user: User | null;
  /** Granted by the server (app_metadata, roles.ts) -- never user_metadata. */
  role: AppRole | null;
  /** A clinician signup waiting for an admin. */
  pendingRole: "clinician" | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const claimedFor = useRef<string | null>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    supabase.auth.getSession().then((result: { data: { session: Session | null } }) => {
      setUser(result.data.session?.user ?? null);
      setLoading(false);
    });
    // Keeps `user` in sync with sign-in/sign-out/token-refresh from anywhere
    // in the app (including other tabs) -- without this, signing out in one
    // tab would leave a stale `user` here until a full reload.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => subscription.subscription.unsubscribe();
  }, [supabase]);

  // A session without a granted role (a new signup, or an account from before
  // roles moved to app_metadata) asks the server once: a patient signup is
  // granted at once, a clinician signup becomes a pending request. The
  // refreshed session then carries the new app_metadata.
  useEffect(() => {
    if (!user || grantedRole(user) || claimedFor.current === user.id) return;
    claimedFor.current = user.id;
    setClaiming(true);
    fetch("/api/auth/claim-role", { method: "POST" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { ok?: boolean; result?: { role?: string | null; pendingRole?: string } } | null;
        if (body?.ok && (body.result?.role || body.result?.pendingRole)) await supabase.auth.refreshSession();
      })
      .catch(() => undefined)
      .finally(() => setClaiming(false));
  }, [user, supabase]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      role: grantedRole(user),
      pendingRole: pendingRole(user),
      loading: loading || claiming,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [user, loading, claiming, supabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
