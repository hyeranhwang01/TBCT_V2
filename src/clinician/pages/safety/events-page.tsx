"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getSafetyEvents } from "@/lib/api/safety-operations-api";

export function RuntimeSafetyEventsPage() {
  const query = useQuery({ queryKey: ["safety-events"], queryFn: getSafetyEvents });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return (
    <AppShell>
      <PageHeader title="Safety Event Queue" description="Operational queue for acknowledge, triage, assignment, hold, resume, and closure." eyebrow="Stage 4" />
      <div className="space-y-3 p-4 lg:p-6">
        {!query.data?.length && <Card><EmptyState title="No safety events" /></Card>}
        {query.data?.map((item) => (
          <Link key={item.id} href={`/runtime/safety/events/${item.id}`} className="block">
            <Card className="p-4 transition hover:border-primary/60">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={item.severity === "high" ? "critical" : item.severity === "medium" ? "warning" : "success"}>{item.severity}</Badge>
                    <Badge tone={item.urgency === "immediate" ? "critical" : item.urgency === "urgent" ? "warning" : "neutral"}>{item.urgency}</Badge>
                    <Badge tone="primary">{item.status}</Badge>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-text-primary">{item.triggerSummary}</div>
                  <div className="mt-1 text-xs text-text-secondary">{item.runtimeSessionId} · {item.participantId} · {new Date(item.createdAt).toLocaleString()}</div>
                </div>
                <Badge tone={item.assignedClinicianId ? "neutral" : "warning"}>{item.assignedClinicianId ?? "Unassigned"}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
