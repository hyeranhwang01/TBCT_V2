"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/shared/supabase/client";
import { grantedRole, pendingRole, type AppRole } from "@/shared/auth/roles";
import { installPatientDevMock, isPatientMockModeEnabled, PATIENT_MOCK_EMAIL, PATIENT_MOCK_USER_ID } from "@/shared/mocks/patient-dev-mock";

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

// The signed-in patient auth-context.tsx hands out when
// NEXT_PUBLIC_TBCT_PATIENT_MOCK=1 -- see patient-dev-mock.ts's own header.
// Roles are read from app_metadata only (roles.ts), so the mock patient
// carries its role there; the cast covers the rest of the real Supabase User
// shape, which nothing here needs. Local development only: the flag is never
// set in a deployment, and the mock never talks to Supabase.
function mockPatientUser(): User {
  return {
    id: PATIENT_MOCK_USER_ID,
    email: PATIENT_MOCK_EMAIL,
    user_metadata: { role: "patient" },
    app_metadata: { role: "patient" },
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as unknown as User;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const mockMode = isPatientMockModeEnabled();
  const [user, setUser] = useState<User | null>(mockMode ? mockPatientUser() : null);
  // In mock mode too: the pages wait until the in-browser fake data is seeded.
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const claimedFor = useRef<string | null>(null);
  // Never calls getSupabaseBrowserClient() in mock mode -- that's what lets
  // this run with no NEXT_PUBLIC_SUPABASE_URL/ANON_KEY configured at all,
  // since that client throws immediately if they're missing.
  const supabase = useMemo(() => (mockMode ? null : getSupabaseBrowserClient()), [mockMode]);

  useEffect(() => {
    if (mockMode) {
      installPatientDevMock().finally(() => setLoading(false));
      return;
    }
    if (!supabase) return;
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
  }, [supabase, mockMode]);

  // A session without a granted role (a new signup, or an account from before
  // roles moved to app_metadata) asks the server once: a patient signup is
  // granted at once, a clinician signup becomes a pending request. The
  // refreshed session then carries the new app_metadata.
  useEffect(() => {
    if (!supabase || !user || grantedRole(user) || claimedFor.current === user.id) return;
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
        if (mockMode || !supabase) return;
        await supabase.auth.signOut();
      },
    }),
    [user, loading, claiming, supabase, mockMode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
