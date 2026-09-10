"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getPilotDataQualityOverview } from "@/lib/api/pilot-study-api";

export function RuntimePilotDataQualityPage() {
  const query = useQuery({ queryKey: ["pilot-data-quality"], queryFn: getPilotDataQualityOverview });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return <AppShell><PageHeader title="Data Quality" description="Critical and warning issues that block export readiness or snapshot validation." eyebrow="Stage 5" /><div className="space-y-3 p-4 lg:p-6">{query.data?.issues.map((item) => <Card key={item.id} className="p-4"><div className="text-sm font-semibold text-text-primary">{item.title}</div><div className="mt-1 text-xs text-text-secondary">{item.severity} · {item.status} · {item.category}</div></Card>)}</div></AppShell>;
}
