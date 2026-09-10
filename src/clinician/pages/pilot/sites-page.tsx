"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getPilotSitesOverview } from "@/lib/api/pilot-study-api";

export function RuntimePilotSitesPage() {
  const query = useQuery({ queryKey: ["pilot-sites"], queryFn: getPilotSitesOverview });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return (
    <AppShell>
      <PageHeader title="Country & Site Operations" description="Recruiting site status, locale, timezone, and country support for the demo pilot." eyebrow="Stage 5" />
      <div className="grid gap-4 p-4 lg:grid-cols-3 lg:p-6">
        {query.data?.map((site) => <Card key={site.id} className="p-4"><div className="text-sm font-semibold text-text-primary">{site.name}</div><div className="mt-2 text-xs text-text-secondary">{site.countryCode} · {site.locale} · {site.timezone}</div><div className="mt-2 text-xs text-text-secondary">Status {site.status} · Active participants {site.activeParticipants}</div></Card>)}
      </div>
    </AppShell>
  );
}
