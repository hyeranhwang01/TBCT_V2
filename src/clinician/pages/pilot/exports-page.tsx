"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, PageHeader, PageSkeleton, StatusBadge } from "@/components/ui/primitives";
import { createResearchExport, createResearchSnapshot, downloadResearchExport, getPilotExportsOverview, lockResearchSnapshot, validateResearchSnapshot } from "@/lib/api/pilot-study-api";

export function RuntimePilotExportsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pilot-exports"], queryFn: getPilotExportsOverview });

  const snapshotMutation = useMutation({
    mutationFn: () => createResearchSnapshot("PILOT-STUDY-01"),
    onSuccess: async () => {
      toast.success("Snapshot created");
      await queryClient.invalidateQueries({ queryKey: ["pilot-exports"] });
    },
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const latestSnapshot = query.data?.snapshots.at(-1);
      if (!latestSnapshot) throw new Error("Snapshot missing");
      return validateResearchSnapshot(latestSnapshot.id);
    },
    onSuccess: async () => {
      toast.success("Snapshot validated");
      await queryClient.invalidateQueries({ queryKey: ["pilot-exports"] });
    },
  });

  const lockMutation = useMutation({
    mutationFn: async () => {
      const latestSnapshot = query.data?.snapshots.at(-1);
      if (!latestSnapshot) throw new Error("Snapshot missing");
      return lockResearchSnapshot(latestSnapshot.id);
    },
    onSuccess: async () => {
      toast.success("Snapshot locked");
      await queryClient.invalidateQueries({ queryKey: ["pilot-exports"] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => createResearchExport("PILOT-STUDY-01"),
    onSuccess: async () => {
      toast.success("Export record created");
      await queryClient.invalidateQueries({ queryKey: ["pilot-exports"] });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (exportId: string) => downloadResearchExport(exportId),
    onSuccess: () => {
      toast.success("ZIP download started");
    },
  });

  if (query.isLoading) {
    return <AppShell><PageSkeleton /></AppShell>;
  }

  const latestSnapshot = query.data?.snapshots.at(-1);
  const latestValidation = latestSnapshot?.validationRunId
    ? query.data?.validationRuns.find((item) => item.id === latestSnapshot.validationRunId)
    : null;

  return (
    <AppShell>
      <PageHeader
        title="Research Export"
        description="Snapshot validation, lock, dataset packaging, and de-identified download for the demo pilot dataset."
        eyebrow="Stage 5"
        actions={
          <>
            <Button variant="secondary" onClick={() => snapshotMutation.mutate()} loading={snapshotMutation.isPending}>Create Snapshot</Button>
            <Button variant="secondary" onClick={() => validateMutation.mutate()} loading={validateMutation.isPending} disabled={!latestSnapshot}>Validate Snapshot</Button>
            <Button variant="secondary" onClick={() => lockMutation.mutate()} loading={lockMutation.isPending} disabled={!latestSnapshot}>Lock Snapshot</Button>
            <Button onClick={() => exportMutation.mutate()} loading={exportMutation.isPending} disabled={latestSnapshot?.status !== "locked"}>Create Export</Button>
          </>
        }
      />

      <div className="grid gap-4 p-4 lg:grid-cols-[1.05fr_.95fr] lg:p-6">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-text-primary">Snapshot pipeline</div>
              <div className="mt-1 text-xs text-text-secondary">Export is blocked unless the sequence is Draft → Validated → Locked.</div>
            </div>
            {latestSnapshot && <StatusBadge status={latestSnapshot.status} />}
          </div>
          <div className="mt-4 space-y-3">
            {query.data?.snapshots.length ? query.data.snapshots.map((item) => (
              <div key={item.id} className="rounded-panel border border-border p-3 text-xs text-text-secondary">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-text-primary">{item.id}</span>
                  <StatusBadge status={item.status} />
                  <Badge tone="neutral">{item.participantCount} participants</Badge>
                </div>
                <div className="mt-2 grid gap-1 md:grid-cols-2">
                  <div>Included {item.includedParticipantIds?.length ?? 0}</div>
                  <div>Excluded {item.excludedParticipantIds?.length ?? 0}</div>
                  <div>Validation run {item.validationRunId ?? "pending"}</div>
                  <div>Checksum {item.datasetChecksum ?? "pending"}</div>
                </div>
                {item.validationRunId && (
                  <div className="mt-2 rounded-panel border border-border bg-surface-subtle p-2">
                    {(() => {
                      const run = query.data.validationRuns.find((validation) => validation.id === item.validationRunId);
                      if (!run) return <div>Validation detail unavailable</div>;
                      return (
                        <>
                          <div className="font-medium text-text-primary">Validation {run.status}</div>
                          <div className="mt-1">Critical {run.criticalIssueCount} · Warning {run.warningIssueCount}</div>
                          <div className="mt-1">{run.notes ?? "No note"}</div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )) : <EmptyState title="No snapshots" description="Create a draft snapshot to start the export pipeline." />}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">Export history</div>
          <div className="mt-1 text-xs text-text-secondary">ZIP packaging uses the locked snapshot only. Raw conversation and safety-restricted memory are excluded.</div>
          <div className="mt-4 space-y-3">
            {query.data?.exportsData.length ? query.data.exportsData.map((item) => (
              <div key={item.id} className="rounded-panel border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-text-primary">{item.id}</span>
                  <StatusBadge status={item.status} />
                  <Badge tone="neutral">{item.format}</Badge>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-text-secondary md:grid-cols-2">
                  <div>Snapshot {item.snapshotId}</div>
                  <div>Manifest checksum {item.manifestChecksum}</div>
                  <div>Package checksum {item.packageChecksum ?? "pending"}</div>
                  <div>Filename {item.filename ?? "not assigned"}</div>
                </div>
                <div className="mt-3 rounded-panel border border-border bg-surface-subtle p-2">
                  <div className="text-[11px] font-semibold text-text-primary">Files</div>
                  <div className="mt-2 space-y-1 text-[11px] text-text-secondary">
                    {item.files?.length ? item.files.map((file) => (
                      <div key={file.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{file.filename}</span>
                        <span>{file.rowCount ?? "—"} rows · {file.byteLength} bytes</span>
                      </div>
                    )) : <div>No file metadata stored</div>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => downloadMutation.mutate(item.id)} loading={downloadMutation.isPending}>Download ZIP</Button>
                </div>
              </div>
            )) : <EmptyState title="No exports" description="Lock a validated snapshot, then create the export record." />}
          </div>
          {latestValidation && (
            <div className="mt-4 rounded-panel border border-border bg-surface-subtle p-3 text-xs text-text-secondary">
              Latest validation: {latestValidation.status} · critical {latestValidation.criticalIssueCount} · warning {latestValidation.warningIssueCount}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
