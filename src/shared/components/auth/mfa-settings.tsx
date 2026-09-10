"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card, Field, inputClass } from "@/components/ui/primitives";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";

/** TOTP two-factor auth enrollment -- entirely Supabase's own
 * auth.mfa.* API (no new backend of ours). Shared by both the clinician
 * and patient profile pages; auth-form.tsx handles the login-time
 * challenge step for whichever account has a verified factor. */
export function MfaSettings() {
  const { t } = useT();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((factor: { status: string; id: string }) => factor.status === "verified");
    setFactorId(verified?.id ?? null);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      // Unverified factors from a previous abandoned attempt block a new
      // enroll call -- clean those up first rather than surfacing a
      // confusing "factor already exists" error.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const factor of existing?.totp ?? []) {
        if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setPendingFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setEnrolling(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("mfa.enrollFailed"));
    } finally {
      setBusy(false);
    }
  };

  const verifyEnroll = async () => {
    if (!pendingFactorId || !code.trim()) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: pendingFactorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: pendingFactorId, challengeId: challenge.id, code: code.trim() });
      if (verifyError) throw verifyError;
      toast.success(t("mfa.enabled"));
      setEnrolling(false);
      setQrCode(null);
      setCode("");
      setPendingFactorId(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("mfa.verifyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!factorId) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast.success(t("mfa.disabled"));
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("mfa.disableFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="text-sm font-semibold text-text-primary">{t("mfa.title")}</div>
      <p className="mt-2 text-xs text-text-secondary">{t("mfa.description")}</p>
      {factorId ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-success">{t("mfa.statusEnabled")}</span>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void disable()}>{t("mfa.disable")}</Button>
        </div>
      ) : enrolling && qrCode ? (
        <div className="mt-3 space-y-3">
          <img src={qrCode} alt={t("mfa.qrAlt")} className="h-40 w-40 rounded-panel border border-border" />
          <Field label={t("mfa.codeLabel")}>
            <input className={inputClass} value={code} onChange={(event) => setCode(event.target.value)} placeholder="000000" maxLength={6} />
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setEnrolling(false); setQrCode(null); setCode(""); }}>{t("common.cancel")}</Button>
            <Button loading={busy} disabled={!code.trim()} onClick={() => void verifyEnroll()}>{t("mfa.verify")}</Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3" loading={busy} onClick={() => void startEnroll()}>{t("mfa.enable")}</Button>
      )}
    </Card>
  );
}
