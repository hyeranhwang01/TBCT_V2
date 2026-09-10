"use client";

import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getRuntimeParticipant } from "@/lib/api/participant-api";
import { getRuntimeSession } from "@/lib/api/runtime-session-api";
import { getWorksheetView } from "@/lib/worksheet/worksheet-projection";
import { getSafetyEvents } from "@/lib/api/safety-operations-api";
import { findSessionTitle } from "@/clinician/pages/monitoring/patient-monitoring-utils";

function formatTimestamp(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

// Same window.print() + print:* Tailwind pattern as
// runtime-safety-report-detail-page.tsx / runtime-pilot-report-detail-page.tsx
// (both pre-existing) -- the global @media print rules in globals.css hide
// nav/aside/button/[role=dialog] automatically, so this page needs no print
// stylesheet of its own beyond the print:* utility classes on its own markup.
export function PatientSessionReportPage() {
  const params = useParams<{ participantId?: string | string[]; sessionId?: string | string[] }>();
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const participantId =
    (Array.isArray(params?.participantId) ? params.participantId[0] : params?.participantId) ?? segments[1] ?? "";
  const sessionId =
    (Array.isArray(params?.sessionId) ? params.sessionId[0] : params?.sessionId) ?? segments[3] ?? "";

  const participantQuery = useQuery({
    queryKey: ["patient-monitoring-participant", participantId],
    queryFn: () => getRuntimeParticipant(participantId),
    enabled: Boolean(participantId),
  });
  const sessionViewQuery = useQuery({
    queryKey: ["patient-monitoring-session-view-detail", sessionId],
    queryFn: () => getRuntimeSession(sessionId),
    enabled: Boolean(sessionId),
  });
  const session = sessionViewQuery.data?.session;
  const worksheetQuery = useQuery({
    queryKey: ["worksheet-view", sessionId, session?.sessionDefinitionId],
    queryFn: () => getWorksheetView(sessionId, session!.sessionDefinitionId),
    enabled: Boolean(sessionId && session?.sessionDefinitionId),
  });
  const safetyQuery = useQuery({ queryKey: ["patient-monitoring-safety-events"], queryFn: getSafetyEvents });
  const sessionSafetyEvents = (safetyQuery.data ?? []).filter((event) => event.runtimeSessionId === sessionId);

  const isLoading = participantQuery.isLoading || sessionViewQuery.isLoading;
  if (isLoading) return <AppShell><PageSkeleton /></AppShell>;
  const participant = participantQuery.data;
  if (!participant || !session) {
    return (
      <AppShell>
        <Card className="m-6"><EmptyState title="Session not found" /></Card>
      </AppShell>
    );
  }

  const worksheetFields = (worksheetQuery.data?.fields ?? [])
    .filter((field) => field.value?.displayValue)
    .sort((left, right) => left.definition.displayOrder - right.definition.displayOrder);

  return (
    <AppShell>
      <PageHeader
        title={`Session Report — ${participant.alias}`}
        description={findSessionTitle(session.sessionDefinitionId) ?? session.sessionDefinitionId}
        eyebrow="Patient Monitoring"
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>Print / Save as PDF</Button>
          </div>
        }
      />
      <div className="space-y-4 p-4 print:space-y-3 print:p-0 lg:p-6">
        <div className="hidden print:block">
          <div className="text-lg font-semibold text-black">TBCT Studio — Session Report</div>
          <div className="mt-1 text-sm text-black">Generated {formatTimestamp(new Date().toISOString())}</div>
        </div>

        <Card className="p-4 print:break-inside-avoid print:border print:border-black print:bg-white">
          <div className="text-sm font-semibold text-text-primary print:text-black">Participant &amp; session</div>
          <div className="mt-3 grid gap-2 text-xs text-text-secondary md:grid-cols-2 print:text-black">
            <div>Participant {participant.alias} ({participant.id})</div>
            <div>Session {findSessionTitle(session.sessionDefinitionId) ?? session.sessionDefinitionId}</div>
            <div>Status <Badge tone="neutral" className="print:hidden">{session.status}</Badge><span className="hidden print:inline">{session.status}</span></div>
            <div>Started {formatTimestamp(session.startedAt ?? session.createdAt)}</div>
            <div>Last updated {formatTimestamp(session.updatedAt)}</div>
            <div>Protocol {session.protocolId} · v{session.protocolVersion}</div>
          </div>
        </Card>

        {sessionSafetyEvents.length > 0 && (
          <Card className="p-4 print:break-inside-avoid print:border print:border-black print:bg-white">
            <div className="text-sm font-semibold text-text-primary print:text-black">Safety events for this session</div>
            <div className="mt-3 space-y-2">
              {sessionSafetyEvents.map((event) => (
                <div key={event.id} className="border-b border-border pb-2 text-xs text-text-secondary last:border-0 print:border-black/20 print:text-black">
                  {formatTimestamp(event.createdAt)} · {event.severity} · {event.status} — {event.triggerSummary}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4 print:break-inside-avoid print:border print:border-black print:bg-white">
          <div className="text-sm font-semibold text-text-primary print:text-black">Worksheet</div>
          {worksheetFields.length > 0 ? (
            <div className="mt-3 space-y-3">
              {worksheetFields.map((field) => (
                <div key={field.definition.id} className="print:break-inside-avoid">
                  <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-muted print:text-black">{field.binding.label}</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-sm text-text-primary print:text-black">
                    {field.value?.displayValue ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-xs text-text-secondary print:text-black">No worksheet data recorded for this session.</div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
