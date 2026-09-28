"use client";

import { useRouter } from "next/navigation";
import { Button, Card } from "@/shared/components/ui/primitives";
import { useAuth } from "@/shared/auth/auth-context";
import { useT } from "@/shared/i18n/context";

/** A signed-in account without a granted role (src/shared/auth/roles.ts):
 * a clinician signup waiting for an admin, or an account the server could
 * not give a role to. Shown instead of any page -- the API refuses such an
 * account too (getAuthenticatedCaller). */
export function AccessPending() {
  const { t } = useT();
  const router = useRouter();
  const { pendingRole, signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4">
      <Card className="max-w-md space-y-3 p-6 text-sm text-text-secondary">
        <h1 className="text-lg font-semibold text-text-primary">{t(pendingRole ? "auth.pending.title" : "auth.noRole.title")}</h1>
        <p>{t(pendingRole ? "auth.pending.body" : "auth.noRole.body")}</p>
        <Button
          variant="secondary"
          onClick={async () => {
            await signOut();
            router.push("/login");
          }}
        >
          {t("auth.logout")}
        </Button>
      </Card>
    </div>
  );
}
