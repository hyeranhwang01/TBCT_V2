"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/shared/supabase/client";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
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

  const value = useMemo<AuthState>(
    () => ({
      user,
      role: roleFromUser(user),
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [user, loading, supabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
