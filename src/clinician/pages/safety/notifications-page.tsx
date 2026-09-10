"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getSafetyNotifications, markAllSafetyNotificationsRead, markSafetyNotificationRead } from "@/lib/api/safety-operations-api";

export function RuntimeSafetyNotificationsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["safety-notifications"], queryFn: getSafetyNotifications });
  const readOne = useMutation({ mutationFn: (id: string) => markSafetyNotificationRead(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["safety-notifications"] }) });
  const readAll = useMutation({ mutationFn: () => markAllSafetyNotificationsRead(), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["safety-notifications"] }) });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return (
    <AppShell>
      <PageHeader title="Safety Notifications" description="Local notification center for queue, assignment, follow-up, and resume actions." eyebrow="Stage 4" actions={<Button variant="secondary" onClick={() => readAll.mutate()}>Mark all read</Button>} />
      <div className="space-y-3 p-4 lg:p-6">
        {!query.data?.length && <Card><EmptyState title="No notifications" /></Card>}
        {query.data?.map((item) => (
          <Card key={item.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-text-primary">{item.title}</div>
                <div className="mt-1 text-xs text-text-secondary">{item.body}</div>
              </div>
              <Button variant="secondary" onClick={() => readOne.mutate(item.id)} disabled={Boolean(item.readAt)}>Read</Button>
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
