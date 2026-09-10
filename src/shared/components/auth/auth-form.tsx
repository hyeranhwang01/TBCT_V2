"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Heart, Lock, Mail, UserPlus } from "lucide-react";
import { Button, Card, Field, inputClass } from "@/components/ui/primitives";
import { Logo } from "@/components/ui/logo";
import { useT } from "@/lib/i18n/context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/auth/auth-context";

/** Shared page chrome for every branch below (main form, MFA challenge,
 * confirm-email-sent, reset-sent, forgot-password) -- one soft gradient
 * backdrop + one rounded card treatment, so switching between them doesn't
 * also flash a different background/card shape. */
function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell flex min-h-screen items-center justify-center p-4">
      <Card className="relative w-full max-w-md rounded-[32px] p-8 sm:p-10">{children}</Card>
      {/* Decorative wave along the bottom edge of the card -- clipped by
          Card's own overflow-hidden, purely cosmetic (aria-hidden). */}
      <svg
        aria-hidden
        viewBox="0 0 400 40"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto h-10 w-full max-w-md text-clinical-blue-light/70"
      >
        <path d="M0 24 Q50 4 100 24 T200 24 T300 24 T400 24 V40 H0 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

// Shared by clinician-auth-page.tsx and patient-auth-page.tsx -- the two
// pages are identical apart from which role they sign up as and where a
// successful login lands, so that's all this component takes as props.
export function AuthForm({ role, titleKey, redirectTo }: { role: AppRole; titleKey: string; redirectTo: string }) {
  const { t } = useT();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Cosmetic only for now -- Supabase's client already persists the session
  // across restarts by default (see supabase/client.ts), so there's no
  // "session-only" mode on the other side of unchecking this yet. Kept as
  // real state (not hardcoded checked) so it's honest about being a no-op
  // rather than silently ignoring a click.
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  // "Forgot password?" is a separate small flow, not a third `mode` value --
  // it only ever needs the email field (reuses the same `email` state) and
  // never submits the main login/signup form.
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // Set only when signInWithPassword succeeded but the account has a
  // verified TOTP factor (see mfa-settings.tsx) -- login isn't complete
  // until the challenge below is verified too.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    try {
      if (mode === "signup") {
        const { data: signupData, error: signupError } = await supabase.auth.signUp({
          email,
          password,
          // Without this, the confirmation email's final redirect falls
          // back to the Supabase project's dashboard-configured "Site URL"
          // -- which defaults to http://localhost:3000 and was never
          // updated for production, so every confirmation link dead-ends
          // with ERR_CONNECTION_REFUSED once it leaves Supabase's own
          // verification step. window.location.origin always matches
          // wherever the signup actually happened (production or local
          // dev), so this is correct in both. Still requires that origin
          // to be on the project's Auth > URL Configuration redirect
          // allow-list, or Supabase silently ignores this and falls back
          // to Site URL anyway.
          options: { data: { role }, emailRedirectTo: `${window.location.origin}${redirectTo}` },
        });
        if (signupError) throw signupError;
        // With the project's "Confirm email" setting off, signUp() returns
        // an already-active session (no email ever gets sent) -- showing
        // the "check your email" screen in that case would be actively
        // wrong, since no email is coming and the account is already
        // usable right now. Only show it when there's genuinely no session
        // yet, i.e. confirmation really is required.
        if (signupData.session) router.push(redirectTo);
        else setConfirmSent(true);
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) throw loginError;
        // Password alone only gets the session to aal1. If the account has
        // a verified TOTP factor, nextLevel comes back aal2 and login
        // isn't actually complete yet -- pause here for the code instead
        // of navigating away with a session the app would otherwise treat
        // as fully authenticated.
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const totpFactor = factors?.totp.find((factor: { status: string; id: string }) => factor.status === "verified");
          if (totpFactor) {
            setMfaFactorId(totpFactor.id);
            return;
          }
        }
        router.push(redirectTo);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message.toLowerCase() : "";
      if (message.includes("email not confirmed")) setError(t("auth.errors.emailNotConfirmed"));
      else if (message.includes("invalid login credentials")) setError(t("auth.errors.invalidCredentials"));
      else setError(mode === "signup" ? t("auth.errors.genericSignup") : t("auth.errors.genericLogin"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setResetError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      // Same PKCE-code redirect as signUp's emailRedirectTo above -- lands
      // on set-password-page.tsx, which exchanges the code for a session
      // and lets the user actually pick a new password.
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/set-password`,
      });
      if (resetErr) throw resetErr;
      setResetSent(true);
    } catch {
      setResetError(t("auth.errors.resetPasswordFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mfaFactorId) return;
    setSubmitting(true);
    setMfaError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: mfaFactorId, challengeId: challenge.id, code: mfaCode.trim() });
      if (verifyError) throw verifyError;
      router.push(redirectTo);
    } catch {
      setMfaError(t("mfa.challengeFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (mfaFactorId) {
    return (
      <AuthShell>
        <Logo className="mb-4 h-16 w-16" />
        <h1 className="text-xl font-bold text-text-primary">{t("mfa.challengeTitle")}</h1>
        <form className="mt-5 grid gap-4" onSubmit={handleMfaSubmit}>
          <Field label={t("mfa.codeLabel")}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              className={inputClass}
              placeholder={t("mfa.challengePlaceholder")}
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
            />
          </Field>
          {mfaError && <p className="text-xs text-critical">{mfaError}</p>}
          <Button type="submit" variant="authGradient" loading={submitting} disabled={!mfaCode.trim()} className="w-full justify-center py-3">
            {t("mfa.challengeSubmit")}
          </Button>
        </form>
      </AuthShell>
    );
  }

  if (confirmSent) {
    return (
      <AuthShell>
        <div className="text-center">
          <Logo className="mx-auto mb-4 h-16 w-16" />
          <h1 className="text-xl font-bold text-text-primary">{t("auth.confirmEmailTitle")}</h1>
          <p className="mt-2 text-sm text-text-secondary">{t("auth.confirmEmailBody", { email })}</p>
        </div>
      </AuthShell>
    );
  }

  if (resetSent) {
    return (
      <AuthShell>
        <div className="text-center">
          <Logo className="mx-auto mb-4 h-16 w-16" />
          <h1 className="text-xl font-bold text-text-primary">{t("auth.resetPassword.sent")}</h1>
          <p className="mt-2 text-sm text-text-secondary">{t("auth.resetPassword.sentBody", { email })}</p>
        </div>
      </AuthShell>
    );
  }

  if (forgotMode) {
    return (
      <AuthShell>
        <Logo className="mb-4 h-16 w-16" />
        <h1 className="text-xl font-bold text-text-primary">{t("auth.resetPassword.title")}</h1>
        <p className="mt-2 text-sm text-text-secondary">{t("auth.resetPassword.description")}</p>
        <form className="mt-5 grid gap-4" onSubmit={handleForgotPassword}>
          <Field label={t("auth.email")}>
            <input
              type="email"
              required
              autoComplete="email"
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          {resetError && <p className="text-xs text-critical">{resetError}</p>}
          <Button type="submit" variant="authGradient" loading={submitting} className="w-full justify-center py-3">
            {t("auth.resetPassword.submit")}
          </Button>
        </form>
        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-clinical-blue hover:underline"
          onClick={() => { setForgotMode(false); setResetError(null); }}
        >
          {t("auth.backToLogin")}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex flex-col items-center text-center">
        <Logo className="mb-4 h-24 w-24 sm:h-28 sm:w-28" />
        <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-[28px]">{t(titleKey)}</h1>
        <p className="mt-2 max-w-xs text-sm text-text-secondary">
          {role === "patient" ? t("auth.patientWelcome") : t("auth.clinicianWelcome")}
        </p>
      </div>

      <form className="mt-7 grid gap-4 text-left" onSubmit={handleSubmit}>
        <Field label={t("auth.email")}>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <input
              type="email"
              required
              autoComplete="email"
              className={cn(inputClass, "h-11 rounded-2xl pl-9")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        </Field>
        <Field label={t("auth.password")}>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className={cn(inputClass, "h-11 rounded-2xl pl-9 pr-9")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? t("common.hidePassword") : t("common.showPassword")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-3 text-xs">
          <label className="flex items-center gap-2 text-text-secondary">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-ai-violet"
            />
            {t("auth.rememberMe")}
          </label>
          {mode === "login" && (
            <button
              type="button"
              className="text-clinical-blue hover:underline"
              onClick={() => { setForgotMode(true); setError(null); }}
            >
              {t("auth.forgotPassword")}
            </button>
          )}
        </div>

        {error && <p className="text-xs text-critical">{error}</p>}

        <Button type="submit" variant="authGradient" loading={submitting} className="w-full justify-center py-3 text-base">
          {mode === "signup" ? t("auth.submitSignup") : t("auth.submitLogin")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-text-muted">
        <span className="h-px flex-1 bg-border" />
        {t("auth.or")}
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full justify-center border-ai-violet-light text-ai-violet hover:bg-ai-violet-light"
        onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(null); }}
      >
        <UserPlus className="h-4 w-4" />
        {mode === "signup" ? t("auth.switchToLogin") : t("auth.switchToSignup")}
      </Button>

      <Link
        href="/crisis"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex w-full items-center justify-center gap-1.5 text-center text-xs text-critical hover:underline"
      >
        <Heart className="h-3.5 w-3.5" />
        {t("patientShell.crisisHelp")}
      </Link>
    </AuthShell>
  );
}
