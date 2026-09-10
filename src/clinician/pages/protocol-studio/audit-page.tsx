"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import {
  Badge,
  Card,
  DetailDrawer,
  EmptyState,
  PageHeader,
  PageSkeleton,
  SectionHeader,
} from "@/components/ui/primitives";
import { getAuditEntries } from "@/lib/api/mock-api";
import type { AuditEntry } from "@/types";

export function AuditPage() {
  const { data, isLoading } = useQuery({ queryKey: ["audit"], queryFn: getAuditEntries });
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const entries = useMemo(() => data ?? [], [data]);

  if (isLoading) return <AppShell><PageSkeleton /></AppShell>;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Research Trace Log"
        title="Audit Log"
        description="Track who changed what and why, with previous and new values for research-grade traceability."
        meta={<><Badge tone="primary">{entries.length} entries</Badge><Badge tone="warning">Demo mode</Badge></>}
      />
      <div className="p-4 lg:p-6">
        <Card className="overflow-hidden">
          <SectionHeader title="Audit Table" description="Change history sorted by timestamp, user, role, action, resource, and result" />
          {entries.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left">
                <thead className="border-b border-border bg-surface-subtle text-[11px] uppercase tracking-[0.08em] text-text-muted">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Resource</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry) => (
                    <tr key={entry.id} onClick={() => setSelected(entry)} className="cursor-pointer hover:bg-surface-subtle">
                      <td className="px-4 py-3 text-sm text-text-primary">{entry.timestamp}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-primary">{entry.user}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{entry.role}</td>
                      <td className="px-4 py-3 text-sm text-text-primary">{entry.action}</td>
                      <td className="px-4 py-3"><Badge tone="primary">{entry.resource}</Badge></td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{entry.version}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{entry.reason}</td>
                      <td className="px-4 py-3"><Badge tone={entry.result === "Success" ? "success" : entry.result === "Pending" ? "warning" : "critical"}>{entry.result}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <DetailDrawer open={!!selected} onClose={() => setSelected(null)} title="Audit Detail" subtitle={selected?.id}>
        {selected && (
          <div className="space-y-4">
            <Card className="p-4">
              <div className="text-sm font-semibold text-text-primary">{selected.action}</div>
              <div className="mt-1 text-xs text-text-secondary">{selected.timestamp} · {selected.user} · {selected.role}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold text-text-primary">Previous value</div>
              <pre className="mono mt-2 overflow-auto rounded-panel border border-border bg-surface-subtle p-3 text-[12px] text-text-secondary">{selected.previousValue}</pre>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold text-text-primary">New value</div>
              <pre className="mono mt-2 overflow-auto rounded-panel border border-border bg-surface-subtle p-3 text-[12px] text-text-secondary">{selected.newValue}</pre>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold text-text-primary">Reason</div>
              <div className="mt-2 text-sm text-text-secondary">{selected.reason}</div>
            </Card>
          </div>
        )}
      </DetailDrawer>
    </AppShell>
  );
}
