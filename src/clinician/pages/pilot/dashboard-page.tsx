"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Card, MetricCard, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getPilotOverviewData } from "@/lib/api/pilot-study-api";

export function RuntimePilotDashboardPage() {
  const query = useQuery({ queryKey: ["pilot-overview"], queryFn: getPilotOverviewData });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  const data = query.data;
  if (!data?.study) return <AppShell><div className="p-6">Pilot study not found.</div></AppShell>;
  return (
    <AppShell>
      <PageHeader
        title={data.study.title}
        description="Demo pilot configuration — not a registered clinical trial system."
        eyebrow="Stage 5"
        meta={<><Badge tone="primary">{data.study.status}</Badge><Badge tone="neutral">N=30 target</Badge><Badge tone="warning">feasibility-focused</Badge></>}
      />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Participants" value={`${data.recruitment.total}`} helper={`${data.recruitment.enrolled} enrolled`} />
          <MetricCard label="Consented" value={`${data.recruitment.consented}`} helper={`${data.recruitment.screening} in screening`} accent="success" />
          <MetricCard label="Sessions" value={`${data.sessions.completed}`} helper={`${data.sessions.scheduled} scheduled · ${data.sessions.missed} missed`} accent="violet" />
          <MetricCard label="Safety" value={`${data.safety.open}`} helper={`${data.safety.held} held sessions`} accent="warning" />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="p-4">
            <div className="text-sm font-semibold text-text-primary">Pilot operations</div>
            <div className="mt-3 space-y-2 text-sm text-text-secondary">
              <Link href="/runtime/pilot/participants" className="block">Participant registry</Link>
              <Link href="/runtime/pilot/screening" className="block">Screening queue</Link>
              <Link href="/runtime/pilot/enrollment" className="block">Enrollment</Link>
              <Link href="/runtime/pilot/allocation" className="block">Allocation</Link>
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold text-text-primary">Research readiness</div>
            <div className="mt-3 space-y-2 text-sm text-text-secondary">
              <div>Open deviations: {data.deviations.filter((item) => item.status === "open").length}</div>
              <div>Data quality issues: {data.qualityIssues.filter((item) => item.status === "open").length}</div>
              <div>Exports: {data.exportsData.length}</div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold text-text-primary">Linked operations</div>
            <div className="mt-3 space-y-2 text-sm text-text-secondary">
              <Link href="/runtime/safety" className="block">Safety operations</Link>
              <Link href="/runtime/memory-review" className="block">Memory review</Link>
              <Link href="/runtime/pilot/reports" className="block">Pilot reports</Link>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
