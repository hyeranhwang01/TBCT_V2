"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { listAllDataDeletionRequests, resolveDataDeletionRequest } from "@/lib/api/data-deletion-request-api";
import { useT } from "@/lib/i18n/context";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Admin/clinician-facing review queue for patient data deletion requests
 * (sql/018_data_deletion_requests.sql) -- deliberately not automatic, see
 * that migration's own doc comment. "Completed" here only tracks that
 * someone marked it done after actually deleting the data by hand (or via
 * a separate, this-app-doesn't-have-one-yet deletion tool) -- resolving
 * a request does NOT itself delete anything. */
export function AdminDeletionRequestsPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const requestsQuery = useQuery({ queryKey: ["admin-deletion-requests"], queryFn: listAllDataDeletionRequests });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "completed" | "denied" }) => resolveDataDeletionRequest(id, status),
    onSuccess: async () => {
      toast.success(t("adminDeletionRequests.updated"));
      await queryClient.invalidateQueries({ queryKey: ["admin-deletion-requests"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("adminDeletionRequests.updateFailed"));
    },
  });

  if (requestsQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  const requests = requestsQuery.data ?? [];

  return (
    <AppShell>
      <PageHeader eyebrow="Admin" title={t("adminDeletionRequests.title")} description={t("adminDeletionRequests.description")} />
      <div className="space-y-2 p-4 lg:p-6">
        {requests.length === 0 ? (
          <Card><EmptyState title={t("adminDeletionRequests.empty")} /></Card>
        ) : (
          requests.map((request) => (
            <Card key={request.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <Link href={`/patients/${request.participantId}`} className="truncate text-sm font-medium text-clinical-blue hover:underline">
                  {request.participantId}
                </Link>
                <div className="text-xs text-text-secondary">{formatTimestamp(request.createdAt)}</div>
                {request.reason && <div className="mt-1 text-xs text-text-secondary">{request.reason}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={request.status === "pending" ? "warning" : request.status === "completed" ? "success" : "neutral"}>
                  {t(`adminDeletionRequests.status.${request.status}`)}
                </Badge>
                {request.status === "pending" && (
                  <>
                    <Button variant="secondary" size="sm" loading={resolveMutation.isPending} onClick={() => resolveMutation.mutate({ id: request.id, status: "completed" })}>
                      {t("adminDeletionRequests.markCompleted")}
                    </Button>
                    <Button variant="secondary" size="sm" loading={resolveMutation.isPending} onClick={() => resolveMutation.mutate({ id: request.id, status: "denied" })}>
                      {t("adminDeletionRequests.deny")}
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
