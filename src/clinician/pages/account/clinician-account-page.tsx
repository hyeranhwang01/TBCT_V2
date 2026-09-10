"use client";

import { AppShell } from "@/clinician/components/app-shell";
import { PageHeader } from "@/shared/components/ui/primitives";
import { MfaSettings } from "@/shared/components/auth/mfa-settings";
import { useAuth } from "@/shared/auth/auth-context";
import { useT } from "@/shared/i18n/context";

/** Clinician's own account security settings -- currently just 2FA
 * enrollment (see mfa-settings.tsx). This app had no per-clinician
 * account page before this; settings-page.tsx is a separate, unrelated
 * demo/workspace-config page with no real backend behind it. */
export function ClinicianAccountPage() {
  const { t } = useT();
  const { user } = useAuth();
  return (
    <AppShell>
      <PageHeader eyebrow="Account" title={t("account.title")} description={user?.email ?? ""} />
      <div className="max-w-lg space-y-4 p-4 lg:p-6">
        <MfaSettings />
      </div>
    </AppShell>
  );
}
