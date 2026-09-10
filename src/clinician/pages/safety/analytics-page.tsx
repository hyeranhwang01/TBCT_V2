"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getSafetyDashboardData } from "@/lib/api/safety-operations-api";

export function RuntimeSafetyAnalyticsPage() {
  const query = useQuery({ queryKey: ["safety-analytics"], queryFn: getSafetyDashboardData });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  const data = query.data!;
  const resolved = data.events.filter((item) => item.status === "resolved" || item.status === "closed").length;
  return (
    <AppShell>
      <PageHeader title="Safety Analytics" description="Operational counts only. No diagnostic scoring or patient risk prediction is shown." eyebrow="Stage 4" />
      <div className="grid gap-4 p-4 lg:grid-cols-3 lg:p-6">
        <Metric label="Event count" value={data.events.length} />
        <Metric label="Resolved" value={resolved} />
        <Metric label="Clinician workload" value={data.clinicians.reduce((sum, item) => sum + item.assignedSafetyEventIds.length, 0)} />
        <Metric label="Immediate" value={data.immediate} />
        <Metric label="Urgent" value={data.urgent} />
        <Metric label="Overdue follow-up" value={data.overdueFollowUps} />
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card className="p-4"><div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div><div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div></Card>;
}
