"use client";

import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { getPilotReportDetail } from "@/lib/api/pilot-study-api";

export function RuntimePilotReportDetailPage() {
  const params = useParams<{ reportId: string }>();
  const pathname = usePathname();
  const reportIdFromParams = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;
  const reportIdFromPath = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const reportId = reportIdFromParams ?? reportIdFromPath;
  const query = useQuery({ queryKey: ["pilot-report-detail", reportId], queryFn: () => getPilotReportDetail(reportId), enabled: Boolean(reportId) });

  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (!query.data) return <AppShell><Card className="m-6"><EmptyState title="Pilot report not found" /></Card></AppShell>;

  const { report, study, participants } = query.data;

  return (
    <AppShell>
      <PageHeader
        title={report.title}
        description="Feasibility-focused pilot operations summary. Not confirmatory efficacy evidence."
        eyebrow="Stage 5"
        actions={
          <>
            <Button variant="secondary" onClick={() => {
              const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
              const href = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = href;
              anchor.download = `${report.id}.json`;
              anchor.click();
              URL.revokeObjectURL(href);
            }}>Download JSON</Button>
            <Button onClick={() => window.print()}>Print</Button>
          </>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">Report metadata</div>
          <div className="mt-3 grid gap-2 text-xs text-text-secondary md:grid-cols-2">
            <div>Report ID: {report.id}</div>
            <div>Type: {report.reportType}</div>
            <div>Generated: {new Date(report.createdAt).toLocaleString("ko-KR")}</div>
            <div>Study: {study?.code ?? report.studyId}</div>
            <div>Target sample: {study?.targetSampleSize ?? 30}</div>
            <div>Included participants: {participants.length}</div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">Payload</div>
          <pre className="mt-3 overflow-auto rounded-panel border border-border bg-surface-subtle p-3 text-xs text-text-secondary">
            {JSON.stringify(report.payload, null, 2)}
          </pre>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">Limitations</div>
          <ul className="mt-3 space-y-1 text-xs text-text-secondary">
            <li>Demo/local-first data</li>
            <li>Feasibility-focused pilot</li>
            <li>Descriptive operational summary</li>
            <li>Not confirmatory efficacy evidence</li>
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
