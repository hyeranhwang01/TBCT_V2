"use client";

import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/clinician/components/app-shell";
import { Badge, Card, EmptyState, PageHeader, PageSkeleton, SectionHeader } from "@/shared/components/ui/primitives";
import { getParticipantLongitudinalDashboard } from "@/shared/api/longitudinal-memory-api";
import { MemoryConsentPanel } from "@/clinician/pages/monitoring/memory-consent-panel";

export function RuntimeParticipantPage() {
  const params = useParams<{ participantId: string }>();
  const pathname = usePathname();
  const participantId = (Array.isArray(params.participantId) ? params.participantId[0] : params.participantId) ?? pathname.split("/").filter(Boolean).at(-1) ?? "";
  const dashboardQuery = useQuery({ queryKey: ["runtime-participant-dashboard", participantId], queryFn: () => getParticipantLongitudinalDashboard(participantId), enabled: Boolean(participantId) });
  if (dashboardQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (!dashboardQuery.data) return <AppShell><Card className="m-6"><EmptyState title="Participant not found" /></Card></AppShell>;
  const { participant, chunks, homework, goals } = dashboardQuery.data;
  const active = chunks.filter((chunk) => !chunk.suppressed);
  return (
    <AppShell>
      <PageHeader title={participant.alias} description="Longitudinal participant record across sessions: memory chunks, homework and goals." eyebrow="Stage 3" meta={<><Badge tone="primary">{participant.status}</Badge><Badge tone="neutral">{participant.locale}</Badge></>} />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid gap-4 xl:grid-cols-4">
          <StatCard label="Sessions" value={`${participant.runtimeSessionIds.length}`} />
          <StatCard label="Memory chunks" value={`${active.length}`} />
          <StatCard label="Homework" value={`${homework.length}`} />
          <StatCard label="Goals" value={`${goals.length}`} />
        </div>
        <MemoryConsentPanel participant={participant} />
        <Card>
          <SectionHeader title="Memory chunks" description="What later sessions may retrieve (only with the participant's consent). Suppress one from the memory page." />
          <div className="space-y-2 p-4">
            {active.map((chunk) => (
              <div key={chunk.id} className="rounded-panel border border-border p-3">
                <div className="text-xs font-semibold text-text-muted">{chunk.chunkKind === "clinician_note" ? "Counsellor's note" : `Session ${chunk.sessionIndex}`} · {chunk.elementKind}</div>
                <div className="mt-1 whitespace-pre-line text-sm text-text-primary">{chunk.content}</div>
              </div>
            ))}
            {!active.length && <div className="text-xs text-text-secondary">No memory chunks yet.</div>}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return <Card className="p-4"><div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div><div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div></Card>;
}
