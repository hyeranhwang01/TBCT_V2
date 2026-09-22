"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/shared/supabase/client";
import { installPatientDevMock, isPatientMockModeEnabled, PATIENT_MOCK_EMAIL, PATIENT_MOCK_USER_ID } from "@/shared/mocks/patient-dev-mock";

export type AppRole = "clinician" | "patient" | "admin";

type AuthState = {
  user: User | null;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function roleFromUser(user: User | null): AppRole | null {
  const role = user?.user_metadata?.role;
  return role === "clinician" || role === "patient" || role === "admin" ? role : null;
}

// The signed-in patient auth-context.tsx hands out when
// NEXT_PUBLIC_TBCT_PATIENT_MOCK=1 -- see patient-dev-mock.ts's own header.
// Only the fields patient-facing code actually reads (id, email,
// user_metadata.role) are populated; the cast covers the rest of the real
// Supabase User shape, which nothing here needs.
function mockPatientUser(): User {
  return {
    id: PATIENT_MOCK_USER_ID,
    email: PATIENT_MOCK_EMAIL,
    user_metadata: { role: "patient" },
    app_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as unknown as User;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const mockMode = isPatientMockModeEnabled();
  const [user, setUser] = useState<User | null>(mockMode ? mockPatientUser() : null);
  const [loading, setLoading] = useState(!mockMode);
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

  const value = useMemo<AuthState>(
    () => ({
      user,
      role: roleFromUser(user),
      loading,
      signOut: async () => {
        if (mockMode || !supabase) return;
        await supabase.auth.signOut();
      },
    }),
    [user, loading, supabase, mockMode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
