"use client";

import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { generateSessionSummary, getRuntimeSessionSummary } from "@/lib/api/session-summary-api";

export function RuntimeSessionSummaryPage() {
  const params = useParams<{ sessionId: string }>();
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const sessionId = (Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId) ?? segments.at(-2) ?? "";
  const summaryQuery = useQuery({
    queryKey: ["runtime-session-summary", sessionId],
    queryFn: async () => (await getRuntimeSessionSummary(sessionId)) ?? generateSessionSummary(sessionId),
    enabled: Boolean(sessionId),
  });
  if (summaryQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (!summaryQuery.data) return <AppShell><Card className="m-6"><EmptyState title="Session summary not found" /></Card></AppShell>;
  const summary = summaryQuery.data;
  return (
    <AppShell>
      <PageHeader title={`Summary ${summary.sessionDefinitionId}`} description="Structured post-session summary for continuity and memory review." eyebrow="Stage 3" meta={<><Badge tone="primary">{summary.summaryStatus}</Badge><Badge tone="neutral">{summary.sessionStatus}</Badge></>} />
      <div className="grid gap-4 p-4 lg:grid-cols-2 lg:p-6">
        <SummaryList title="Homework assigned" items={summary.homeworkAssigned} />
        <SummaryList title="Homework outcomes" items={summary.homeworkOutcomes} />
        <SummaryList title="Barriers" items={summary.patientReportedBarriers} />
        <SummaryList title="Coping strategies" items={summary.copingStrategies} />
      </div>
    </AppShell>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length ? items.map((item, index) => <div key={`${title}-${index}`} className="rounded-panel border border-border p-3 text-sm text-text-secondary">{item}</div>) : <div className="text-xs text-text-muted">No items</div>}
      </div>
    </Card>
  );
}
