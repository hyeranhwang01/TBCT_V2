"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getSafetyReport } from "@/lib/repositories/safety-event-repository";
import { exportSafetyReportJson } from "@/lib/api/safety-operations-api";

export function RuntimeSafetyReportDetailPage() {
  const params = useParams<{ reportId: string }>();
  const pathname = usePathname();
  const reportIdFromParams = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;
  const reportIdFromPath = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const reportId = reportIdFromParams ?? reportIdFromPath;
  const reportQuery = useQuery({ queryKey: ["safety-report", reportId], queryFn: () => getSafetyReport(reportId), enabled: Boolean(reportId) });
  if (reportQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (!reportQuery.data) return <AppShell><Card className="m-6"><EmptyState title="Report not found" /></Card></AppShell>;
  const report = reportQuery.data;
  const payload = report.payload as Record<string, unknown>;
  return (
    <AppShell>
      <PageHeader
        title={`Safety Report ${report.id}`}
        description="Demo Safety Operations Report"
        eyebrow="Stage 4"
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" onClick={async () => {
              const payload = await exportSafetyReportJson(report.id);
              const blob = new Blob([payload], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `${report.id}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}>Download JSON</Button>
            <Button variant="secondary" onClick={() => window.print()}>Print View</Button>
            <Link href={`/runtime/safety/events/${report.safetyEventId}`}><Button variant="secondary">Event Detail</Button></Link>
          </div>
        }
      />
      <div className="space-y-4 p-4 print:space-y-3 print:p-0 lg:p-6">
        <div className="hidden print:block">
          <div className="text-lg font-semibold text-black">Demo Safety Operations Report</div>
          <div className="mt-1 text-sm text-black">Report ID {report.id} · Generated {new Date(report.createdAt).toLocaleString("ko-KR")}</div>
        </div>
        <Card className="p-4 print:break-inside-avoid print:border print:border-black print:bg-white">
          <div className="text-sm font-semibold text-text-primary">Report metadata</div>
          <div className="mt-3 grid gap-2 text-xs text-text-secondary md:grid-cols-2 print:text-black">
            <div>Participant {report.participantId}</div>
            <div>Event {report.safetyEventId}</div>
            <div>Report type {report.reportType ?? "interim"}</div>
            <div>Status at generation {report.eventStatusAtGeneration ?? "unknown"}</div>
          </div>
        </Card>
        <Card className="p-4 print:break-inside-avoid print:border print:border-black print:bg-white">
          <div className="text-sm font-semibold text-text-primary">Event snapshot</div>
          <div className="mt-3 grid gap-2 text-xs text-text-secondary md:grid-cols-2 print:text-black">
            <div>Participant alias {(payload.event as { participantId?: string } | undefined)?.participantId ?? report.participantId}</div>
            <div>Protocol {(payload.event as { protocolId?: string; sessionDefinitionId?: string } | undefined)?.protocolId ?? "unknown"} · {(payload.event as { sessionDefinitionId?: string } | undefined)?.sessionDefinitionId ?? "unknown"}</div>
            <div>Trigger {(payload.event as { triggerSummary?: string } | undefined)?.triggerSummary ?? "unknown"}</div>
            <div>Source node {(payload.event as { sourceNodeId?: string } | undefined)?.sourceNodeId ?? "unknown"}</div>
          </div>
        </Card>
        <Card className="p-4 print:break-inside-avoid print:border print:border-black print:bg-white">
          <div className="text-sm font-semibold text-text-primary">Transitions</div>
          <pre className="mt-3 overflow-auto rounded-panel border border-border bg-surface-subtle p-3 text-xs text-text-secondary print:hidden">{JSON.stringify(payload.transitions ?? [], null, 2)}</pre>
          <div className="mt-3 hidden space-y-2 print:block">
            {((payload.transitions as Array<{ previousStatus?: string; nextStatus?: string; reason?: string; createdAt?: string }>) ?? []).map((item, index) => (
              <div key={`${item.createdAt ?? "transition"}-${index}`} className="border-b border-black/20 pb-2 text-xs text-black">
                {item.createdAt ?? "unknown"} · {item.previousStatus ?? "none"} → {item.nextStatus ?? "unknown"} · {item.reason ?? ""}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4 print:hidden">
          <div className="text-sm font-semibold text-text-primary">Raw payload</div>
          <pre className="mt-3 overflow-auto rounded-panel border border-border bg-surface-subtle p-3 text-xs text-text-secondary">{JSON.stringify(report.payload, null, 2)}</pre>
        </Card>
      </div>
    </AppShell>
  );
}
