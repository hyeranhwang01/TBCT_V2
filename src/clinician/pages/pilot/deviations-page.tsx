"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getPilotOverviewData } from "@/lib/api/pilot-study-api";

export function RuntimePilotDeviationsPage() {
  const query = useQuery({ queryKey: ["pilot-deviations"], queryFn: getPilotOverviewData });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return <AppShell><PageHeader title="Protocol Deviations" description="Open and resolved pilot deviations across allocation, session delivery, safety, assessment, and export." eyebrow="Stage 5" /><div className="space-y-3 p-4 lg:p-6">{query.data?.deviations.map((item) => <Card key={item.id} className="p-4"><div className="text-sm font-semibold text-text-primary">{item.title}</div><div className="mt-1 text-xs text-text-secondary">{item.category} · {item.status}</div></Card>)}</div></AppShell>;
}
