"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button, Card, Field, inputClass } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Lands here from three kinds of Supabase auth emails -- an admin invite
 * (inviteAdminUser in admin.ts), a "forgot password" reset (see
 * handleForgotPassword in auth-form.tsx), or a signup confirmation -- all of
 * which use Supabase's PKCE flow: the email link's final redirect carries a
 * one-time `?code=...` param, not a hash-fragment token. Nothing establishes
 * a session from that code automatically; this page's whole job is to
 * exchange it for one (exchangeCodeForSession), then let the user actually
 * pick a password. Without this page, every one of those email flows
 * dead-ended on the plain login form with no way to ever set one.
 */
export function SetPasswordPage() {
  const { t } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"exchanging" | "ready" | "error">("exchanging");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setStatus("error");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    supabase.auth.exchangeCodeForSession(code).then((result: { error: unknown }) => {
      setStatus(result.error ? "error" : "ready");
    });
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError(t("auth.setPassword.mismatch"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const nextRole = data.user?.user_metadata?.role;
      router.push(nextRole === "patient" ? "/projects/demo/patient" : "/projects/demo/protocols/tbct-br-001/canvas");
    } catch {
      setError(t("auth.setPassword.updateFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "exchanging") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-clinical-blue" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4">
        <Card className="w-full max-w-sm p-6 text-center">
          <h1 className="text-base font-semibold text-text-primary">{t("auth.setPassword.expiredTitle")}</h1>
          <p className="mt-2 text-sm text-text-secondary">{t("auth.setPassword.expiredBody")}</p>
          <Button className="mt-4 w-full justify-center" onClick={() => router.push("/login")}>
            {t("auth.setPassword.backToLogin")}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-base font-semibold text-text-primary">{t("auth.setPassword.title")}</h1>
        <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
          <Field label={t("auth.setPassword.newPassword")}>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label={t("auth.setPassword.confirmPassword")}>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>
          {error && <p className="text-xs text-critical">{error}</p>}
          <Button type="submit" loading={submitting} className="w-full justify-center">
            {t("auth.setPassword.submit")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
