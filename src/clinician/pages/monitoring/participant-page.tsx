"use client";

import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Card, EmptyState, PageHeader, PageSkeleton, SectionHeader } from "@/components/ui/primitives";
import { getParticipantLongitudinalDashboard } from "@/lib/api/longitudinal-memory-api";

export function RuntimeParticipantPage() {
  const params = useParams<{ participantId: string }>();
  const pathname = usePathname();
  const participantId = (Array.isArray(params.participantId) ? params.participantId[0] : params.participantId) ?? pathname.split("/").filter(Boolean).at(-1) ?? "";
  const dashboardQuery = useQuery({ queryKey: ["runtime-participant-dashboard", participantId], queryFn: () => getParticipantLongitudinalDashboard(participantId), enabled: Boolean(participantId) });
  if (dashboardQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (!dashboardQuery.data) return <AppShell><Card className="m-6"><EmptyState title="Participant not found" /></Card></AppShell>;
  const { participant, memories, homework, goals, usage } = dashboardQuery.data;
  return (
    <AppShell>
      <PageHeader title={participant.alias} description="Longitudinal participant record across sessions, memory approvals, homework, goals, and usage." eyebrow="Stage 3" meta={<><Badge tone="primary">{participant.status}</Badge><Badge tone="neutral">{participant.locale}</Badge></>} />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid gap-4 xl:grid-cols-4">
          <StatCard label="Sessions" value={`${participant.runtimeSessionIds.length}`} />
          <StatCard label="Approved Memory" value={`${memories.filter((item) => item.status === "approved").length}`} />
          <StatCard label="Homework" value={`${homework.length}`} />
          <StatCard label="Goals" value={`${goals.length}`} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <SectionHeader title="Approved Memory" description="Cross-session approved items." />
            <div className="space-y-2 p-4">
              {memories.filter((item) => item.status === "approved").map((memory) => (
                <div key={memory.id} className="rounded-panel border border-border p-3">
                  <div className="text-sm font-semibold text-text-primary">{memory.title}</div>
                  <div className="mt-1 text-xs text-text-secondary">{memory.content}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <SectionHeader title="Memory Usage" description="Retrieval and injection history." />
            <div className="space-y-2 p-4">
              {usage.map((item) => (
                <div key={item.id} className="rounded-panel border border-border p-3">
                  <div className="text-xs font-semibold text-text-muted">{item.usageType}</div>
                  <div className="mt-1 text-sm text-text-primary">{item.reason}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return <Card className="p-4"><div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div><div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div></Card>;
}
