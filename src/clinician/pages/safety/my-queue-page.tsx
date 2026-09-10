"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { acknowledgeClinicianHandoff, authorizeSessionResume, getPendingClinicianHandoffs, getSafetyEvents, getSafetyFollowUps, getSafetyNotifications } from "@/lib/api/safety-operations-api";
import { useStudioStore } from "@/stores/studio-store";

export function RuntimeSafetyMyQueuePage() {
  const queryClient = useQueryClient();
  const activeActorId = useStudioStore((state) => state.activeActorId);
  const eventsQuery = useQuery({ queryKey: ["safety-my-queue", "events"], queryFn: getSafetyEvents });
  const handoffsQuery = useQuery({ queryKey: ["safety-my-queue", "handoffs"], queryFn: getPendingClinicianHandoffs });
  const followUpsQuery = useQuery({ queryKey: ["safety-my-queue", "followups"], queryFn: getSafetyFollowUps });
  const notificationsQuery = useQuery({ queryKey: ["safety-my-queue", "notifications"], queryFn: getSafetyNotifications });

  const action = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      toast.success("Queue updated");
      await queryClient.invalidateQueries({ queryKey: ["safety-my-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["safety-events"] });
      await queryClient.invalidateQueries({ queryKey: ["safety-event-detail"] });
      await queryClient.invalidateQueries({ queryKey: ["safety-followups"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Queue action failed"),
  });

  if (eventsQuery.isLoading || handoffsQuery.isLoading || followUpsQuery.isLoading || notificationsQuery.isLoading) {
    return <AppShell><PageSkeleton /></AppShell>;
  }

  const events = eventsQuery.data ?? [];
  const assigned = events.filter((item) => item.assignedClinicianId === activeActorId);
  const handoffs = handoffsQuery.data ?? [];
  const followUps = (followUpsQuery.data ?? []).filter((item) => item.assignedClinicianId === activeActorId);
  const resumeRequests = events
    .filter((item) => item.assignedClinicianId === activeActorId && item.sessionHoldRequired && !item.sessionResumeAuthorized)
    .map((item) => ({ eventId: item.id, runtimeSessionId: item.runtimeSessionId, severity: item.severity, triggerSummary: item.triggerSummary }));
  const unreadHandoffNotifications = (notificationsQuery.data ?? []).filter((item) => item.type === "handoff_received" && !item.readAt);

  return (
    <AppShell>
      <PageHeader title="My Safety Queue" description="Assigned events, received handoffs, pending resume reviews, and follow-up work for the active demo clinician." eyebrow="Stage 4" />
      <div className="space-y-4 p-4 lg:p-6">
        <QueueSection title="Assigned to Me" emptyTitle="No assigned safety events">
          {assigned.map((item) => (
            <Link key={item.id} href={`/runtime/safety/events/${item.id}`} className="block">
              <QueueRow title={item.triggerSummary} meta={[item.severity, item.urgency, item.status]} />
            </Link>
          ))}
        </QueueSection>

        <QueueSection title="Handoff Received" emptyTitle="No handoff received">
          {handoffs.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <span>{item.summary}</span>
                    <span className="rounded border border-warning bg-warning-light px-2 py-0.5 text-[11px] text-warning">pending acknowledgement</span>
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">From {item.fromClinicianId ?? "System"} · Event {item.safetyEventId}</div>
                  <div className="mt-2 text-xs text-text-secondary">Pending actions: {item.pendingActions.join(", ")}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => action.mutate(() => acknowledgeClinicianHandoff(item.id, item.toClinicianId))}>Acknowledge</Button>
                  <Link href={`/runtime/safety/events/${item.safetyEventId}`}><Button variant="ghost">Open Event</Button></Link>
                </div>
              </div>
            </Card>
          ))}
        </QueueSection>

        <QueueSection title="Pending Handoff Acknowledgement" emptyTitle="No unread handoff notification">
          {unreadHandoffNotifications.map((item) => (
            <QueueRow key={item.id} title={item.title} meta={[item.linkedEventId ?? "event", new Date(item.createdAt).toLocaleString("ko-KR")]} />
          ))}
        </QueueSection>

        <QueueSection title="Resume Requests Awaiting My Review" emptyTitle="No pending resume review">
          {resumeRequests.map((item) => (
            <Card key={item.eventId} className="p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-text-primary">{item.triggerSummary}</div>
                  <div className="mt-1 text-xs text-text-secondary">Event {item.eventId} · Session {item.runtimeSessionId} · Severity {item.severity}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => action.mutate(() => authorizeSessionResume(item.runtimeSessionId, item.eventId, item.severity === "high" ? "SUP-1" : activeActorId, {
                      reason: "Reviewed from My Queue",
                      patientFacingMessage: "The review is complete. You can continue the session now.",
                    }))}
                  >
                    Authorize
                  </Button>
                  <Link href={`/runtime/safety/events/${item.eventId}`}><Button variant="ghost">Open Event</Button></Link>
                </div>
              </div>
            </Card>
          ))}
        </QueueSection>

        <QueueSection title="Follow-ups Assigned to Me" emptyTitle="No follow-up assigned">
          {followUps.map((item) => (
            <Link key={item.id} href={`/runtime/safety/events/${item.safetyEventId}`} className="block">
              <QueueRow title={item.title} meta={[item.status, item.priority, item.dueAt ?? "No due date"]} />
            </Link>
          ))}
        </QueueSection>
      </div>
    </AppShell>
  );
}

function QueueSection({ title, emptyTitle, children }: { title: string; emptyTitle: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      {!hasChildren ? <Card><EmptyState title={emptyTitle} /></Card> : children}
    </div>
  );
}

function QueueRow({ title, meta }: { title: string; meta: string[] }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-text-secondary">
        {meta.map((item) => <span key={item}>{item}</span>)}
      </div>
    </Card>
  );
}
