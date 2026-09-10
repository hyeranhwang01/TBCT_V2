"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { generatePilotReport, getPilotReports } from "@/lib/api/pilot-study-api";

export function RuntimePilotReportsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pilot-reports"], queryFn: getPilotReports });
  const mutation = useMutation({
    mutationFn: () => generatePilotReport("PILOT-STUDY-01"),
    onSuccess: async () => {
      toast.success("Pilot report generated");
      await queryClient.invalidateQueries({ queryKey: ["pilot-reports"] });
    },
  });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return <AppShell><PageHeader title="Pilot Reports" description="Demo Pilot Operations Report, country/arm comparison, and export readiness summaries." eyebrow="Stage 5" actions={<Button onClick={() => mutation.mutate()}>Generate Report</Button>} /><div className="space-y-3 p-4 lg:p-6">{query.data?.map((item) => <Card key={item.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-text-primary">{item.title}</div><div className="mt-1 text-xs text-text-secondary">{item.reportType} · {new Date(item.createdAt).toLocaleString("ko-KR")}</div></div><Link href={`/runtime/pilot/reports/${item.id}`}><Button variant="secondary">Open Detail</Button></Link></div></Card>)}</div></AppShell>;
}
