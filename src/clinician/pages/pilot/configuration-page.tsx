"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getPilotStudyConfiguration } from "@/lib/api/pilot-study-api";

export function RuntimePilotConfigurationPage() {
  const query = useQuery({ queryKey: ["pilot-configuration"], queryFn: getPilotStudyConfiguration });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  const data = query.data;
  return (
    <AppShell>
      <PageHeader title="Pilot Configuration" description="Study, arm, and country/site configuration for the Stage 5 demo pilot." eyebrow="Stage 5" />
      <div className="grid gap-4 p-4 lg:grid-cols-3 lg:p-6">
        <Card className="p-4"><div className="text-sm font-semibold text-text-primary">{data?.study?.code}</div><div className="mt-2 text-xs text-text-secondary">{data?.study?.description}</div></Card>
        {data?.arms.map((arm) => <Card key={arm.id} className="p-4"><div className="flex items-center gap-2"><div className="text-sm font-semibold text-text-primary">{arm.name}</div><Badge tone="neutral">{arm.shortLabel}</Badge></div><div className="mt-2 text-xs text-text-secondary">{arm.description}</div></Card>)}
      </div>
    </AppShell>
  );
}
