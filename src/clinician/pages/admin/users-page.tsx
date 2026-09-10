"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { listAdminUsers, setAdminUserBanned } from "@/lib/api/admin-api";
import { useAuth } from "@/lib/auth/auth-context";
import { useT } from "@/lib/i18n/context";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
}

/** Admin-only account management -- see src/app/api/admin/users/route.ts's
 * own doc comment for why this exists: nothing else in this app can
 * enumerate every registered identity across roles, and self-signup
 * (clinician or patient) has no other gatekeeping today. */
export function AdminUsersPage() {
  const { t } = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: listAdminUsers });

  const banMutation = useMutation({
    mutationFn: ({ userId, banned }: { userId: string; banned: boolean }) => setAdminUserBanned(userId, banned),
    onSuccess: async () => {
      toast.success(t("adminUsers.updated"));
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("adminUsers.updateFailed"));
    },
  });

  if (usersQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;

  const users = [...(usersQuery.data ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <AppShell>
      <PageHeader eyebrow="Admin" title={t("adminUsers.title")} description={t("adminUsers.description")} />
      <div className="space-y-2 p-4 lg:p-6">
        {users.map((row) => (
          <Card key={row.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text-primary">{row.email ?? row.id}</div>
              <div className="text-xs text-text-secondary">{formatTimestamp(row.createdAt)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={row.role === "admin" ? "primary" : row.role === "clinician" ? "success" : row.role === "patient" ? "neutral" : "warning"}>
                {row.role ? t(`adminUsers.role.${row.role}`) : t("adminUsers.role.none")}
              </Badge>
              {row.banned && <Badge tone="critical">{t("adminUsers.banned")}</Badge>}
              {row.id !== user?.id && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={banMutation.isPending}
                  onClick={() => banMutation.mutate({ userId: row.id, banned: !row.banned })}
                >
                  {row.banned ? t("adminUsers.unban") : t("adminUsers.ban")}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
