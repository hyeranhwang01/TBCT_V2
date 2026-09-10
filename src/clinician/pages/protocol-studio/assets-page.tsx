"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeftRight, CheckCircle2, Clock3, FilePlus2, FileText, GitBranchPlus, Grid2X2, List, Play, Search, UploadCloud } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, DetailDrawer, EmptyState, ErrorState, Field, FilterBar, Modal, PageHeader, PageSkeleton, SectionHeader, SourceReferenceChip, StatusBadge, inputClass, textareaClass } from "@/components/ui/primitives";
import {
  archiveClinicalAssetApi,
  compareAssetVersions,
  createAssetRelationship,
  createAssetVersion,
  createExtractionReviewDraft,
  exportSourceManifestApi,
  getClinicalAssetApi,
  getClinicalAssetsApi,
  getExtractionJobsApi,
  extractAssetNow,
  setCurrentAssetVersion,
} from "@/lib/api/clinical-assets-api";
import { useStudioStore } from "@/stores/studio-store";
import type { AssetRelationshipType, AssetType, LocalClinicalAsset } from "@/types/clinical-assets";

export function AssetsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const assetView = useStudioStore((state) => state.assetView);
  const setAssetView = useStudioStore((state) => state.setAssetView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "versions" | "relationships" | "extracted">("overview");
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [versionCompareIds, setVersionCompareIds] = useState<{ left: string; right: string } | null>(null);
  const [versionForm, setVersionForm] = useState({ version: "1.1.0", changeSummary: "", rerunExtraction: true });
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [relationshipForm, setRelationshipForm] = useState({ targetAssetId: "", relationType: "translation_of" as AssetRelationshipType, notes: "" });

  const filters = useMemo(
    () => ({
      query: params.get("q") ?? "",
      country: params.get("country") ?? "all",
      locale: params.get("locale") ?? "all",
      assetType: (params.get("type") as AssetType | "all" | null) ?? "all",
      sessionId: params.get("session") ?? "all",
      status: (params.get("status") as LocalClinicalAsset["status"] | "all" | null) ?? "all",
      extractionStatus: (params.get("extraction") as LocalClinicalAsset["extractionStatus"] | "all" | null) ?? "all",
    }),
    [params],
  );

  const assetsQuery = useQuery({ queryKey: ["clinical-assets", filters], queryFn: () => getClinicalAssetsApi(filters) });
  const jobsQuery = useQuery({ queryKey: ["extraction-jobs"], queryFn: getExtractionJobsApi });
  const selectedQuery = useQuery({
    queryKey: ["clinical-asset-detail", selectedId],
    queryFn: () => getClinicalAssetApi(selectedId ?? ""),
    enabled: !!selectedId,
  });
  const versionDiffQuery = useQuery({
    queryKey: ["version-diff", versionCompareIds?.left, versionCompareIds?.right],
    queryFn: () => compareAssetVersions(versionCompareIds!.left, versionCompareIds!.right),
    enabled: !!versionCompareIds,
  });

  const refreshAssetQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ["clinical-assets"] });
    await queryClient.invalidateQueries({ queryKey: ["extraction-jobs"] });
    if (selectedId) await queryClient.invalidateQueries({ queryKey: ["clinical-asset-detail", selectedId] });
  };

  const queueMutation = useMutation({
    mutationFn: async (assetId: string) => extractAssetNow(assetId, { forceRestart: true }),
    onSuccess: refreshAssetQueries,
  });

  const draftMutation = useMutation({
    mutationFn: (assetId: string) => createExtractionReviewDraft(assetId),
    onSuccess: (draft) => router.push(`/projects/demo/extraction?draft=${draft.id}`),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveClinicalAssetApi,
    onSuccess: async () => {
      await refreshAssetQueries();
      setSelectedId(null);
    },
  });

  const versionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId || !versionFile) throw new Error("Version file is required");
      return createAssetVersion(selectedId, { ...versionForm, file: versionFile, createdBy: "Demo User" });
    },
    onSuccess: async () => {
      await refreshAssetQueries();
      setVersionModalOpen(false);
      setVersionFile(null);
    },
  });

  const currentVersionMutation = useMutation({
    mutationFn: ({ assetId, versionId }: { assetId: string; versionId: string }) => setCurrentAssetVersion(assetId, versionId),
    onSuccess: refreshAssetQueries,
  });

  const relationshipMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Asset not selected");
      return createAssetRelationship({
        projectId: "TBCT-BR-001",
        sourceAssetId: selectedId,
        targetAssetId: relationshipForm.targetAssetId,
        relationType: relationshipForm.relationType,
        notes: relationshipForm.notes,
        createdBy: "Demo User",
      });
    },
    onSuccess: async () => {
      await refreshAssetQueries();
      setRelationshipOpen(false);
    },
  });

  const manifestMutation = useMutation({
    mutationFn: exportSourceManifestApi,
    onSuccess: (manifest) => {
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "tbct-source-manifest-2026-07-29.json";
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });

  if (assetsQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (assetsQuery.isError) return <AppShell><div className="p-4 lg:p-6"><Card className="p-4"><ErrorState retry={() => assetsQuery.refetch()} /><div className="mt-4 flex flex-wrap justify-center gap-2"><Button onClick={() => router.push("/projects/demo/clinical-assets/new")}>Open registration page</Button></div></Card></div></AppShell>;

  const assets = assetsQuery.data ?? [];
  const selectedAsset = selectedQuery.data?.asset;
  const versions = selectedQuery.data?.versions ?? [];
  const relationships = selectedQuery.data?.relationships ?? [];
  const extractedDocument = selectedQuery.data?.document;
  const jobs = Array.from(new Map((jobsQuery.data ?? []).map((job) => [job.id, job])).values());

  const visibleJobState = (job: (typeof jobs)[number]) => {
    if (job.status === "queued") return { status: "queued", label: "Queued", tone: "primary" as const, progress: 0 };
    if (job.status === "extracting") return { status: "extracting", label: "Extracting...", tone: "primary" as const, progress: Math.min(99, job.progress || 10) };
    if (job.status === "failed") return { status: "failed", label: "Retry Extraction", tone: "critical" as const, progress: job.progress || 0 };
    if (job.status === "partial") return { status: "partial", label: "Re-extract", tone: "warning" as const, progress: 100 };
    return { status: job.status, label: job.status, tone: job.status === "completed" ? "success" as const : "neutral" as const, progress: 100 };
  };

  const actionLabel = (status: LocalClinicalAsset["extractionStatus"]) => {
    if (status === "not_started") return "Extract";
    if (status === "queued" || status === "extracting") return "Extracting...";
    if (status === "failed") return "Retry Extraction";
    if (status === "partial" || status === "completed" || status === "ocr_required") return "Re-extract";
    return "Extract";
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Clinical Source Library"
        title="Clinical Assets"
        description="Manage local clinical assets, version history, relationship links, and extraction drafts in one place."
        meta={<><Badge tone="primary">{assets.length} assets</Badge><Badge tone="warning">{jobs.filter((job) => job.status === "extracting").length ?? 0} running jobs</Badge></>}
        actions={<><Button variant="secondary" onClick={() => manifestMutation.mutate()}>Manifest export</Button><Button onClick={() => router.push("/projects/demo/clinical-assets/new") }><UploadCloud className="h-4 w-4" />Register Asset</Button></>}
      />

      <div className="space-y-4 p-4 lg:p-6">
        <FilterBar>
          <div className="relative min-w-[280px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              defaultValue={filters.query}
              onKeyDown={(event) => {
                if (event.key === "Enter") router.push(`/projects/demo/assets?q=${encodeURIComponent((event.currentTarget as HTMLInputElement).value)}`);
              }}
              className={`${inputClass} pl-9`}
              placeholder="Search title, filename, checksum, or session"
            />
          </div>
          <div className="flex rounded-panel border border-border p-0.5">
            <Button size="icon" variant={assetView === "grid" ? "primary" : "ghost"} className="h-8 w-8" onClick={() => setAssetView("grid")}><Grid2X2 className="h-4 w-4" /></Button>
            <Button size="icon" variant={assetView === "table" ? "primary" : "ghost"} className="h-8 w-8" onClick={() => setAssetView("table")}><List className="h-4 w-4" /></Button>
          </div>
        </FilterBar>

        <Card>
          <SectionHeader title="Extraction Job Queue" description="Extraction jobs by status: queued, extracting, completed, partial, or failed" />
          <div className="grid gap-3 p-4 xl:grid-cols-2">
            {jobs.slice(0, 6).map((job) => {
              const view = visibleJobState(job);
              return (
              <div key={job.id} className="rounded-panel border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-text-primary">{job.assetId}</div>
                  <Badge tone={view.tone}>{view.label}</Badge>
                </div>
                <div className="mt-2 text-xs text-text-secondary">{view.status === "queued" ? "queued" : view.status === "extracting" ? "extracting" : view.status === "failed" ? "failed" : job.stage} · {view.progress}%</div>
                {job.errorMessage && <div className="mt-2 text-xs leading-5 text-critical">{job.errorMessage}</div>}
              </div>
              );
            })}
            {jobs.length === 0 && <EmptyState title="No extraction jobs yet" description="Jobs appear here after you register an asset and queue extraction." />}
          </div>
        </Card>

        {assets.length === 0 ? (
          <Card><EmptyState title="No assets registered" description="PDF, DOCX, TXT, MD, JSON, MP3, WAV, MP4, and MOV files are stored in local browser storage." /><div className="flex justify-center pb-5"><Button onClick={() => router.push("/projects/demo/clinical-assets/new")}>Register the first asset</Button></div></Card>
        ) : assetView === "grid" ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => (
              <Card key={asset.id} className="p-4">
                <button className="w-full text-left" onClick={() => setSelectedId(asset.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-panel border border-border bg-surface-subtle text-clinical-blue"><FileText className="h-5 w-5" /></span>
                    <StatusBadge status={asset.status === "failed" ? "error" : asset.status === "ready" ? "approved" : asset.status === "needs_review" ? "review" : "draft"} />
                  </div>
                  <div className="mt-4 text-sm font-semibold text-text-primary">{asset.title}</div>
                  <div className="mono mt-1 text-[11px] text-text-muted">{asset.originalFileName}</div>
                  <div className="mt-3 flex flex-wrap gap-2"><Badge tone="neutral">{asset.assetType}</Badge><Badge tone="primary">{asset.sessionIds.join(", ") || "Unlinked"}</Badge></div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-text-secondary">
                    <div><div className="text-text-muted">Version</div><div className="mt-1 font-medium text-text-primary">{asset.version}</div></div>
                    <div><div className="text-text-muted">Extraction</div><div className="mt-1 font-medium text-text-primary">{asset.extractionStatus}</div></div>
                  </div>
                </button>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => queueMutation.mutate(asset.id)}><Play className="h-4 w-4" />{actionLabel(asset.extractionStatus)}</Button>
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => setSelectedId(asset.id)}>Details</Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <SectionHeader title="Asset Table" description="List based on local assets and extraction status" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-left">
                <thead className="border-b border-border bg-surface-subtle text-[11px] uppercase tracking-[0.08em] text-text-muted">
                  <tr><th className="px-4 py-3">Title</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Locale</th><th className="px-4 py-3">Session</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Size</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Extraction</th><th className="px-4 py-3">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {assets.map((asset) => (
                    <tr key={asset.id} className="hover:bg-surface-subtle">
                      <td className="px-4 py-3"><button className="text-left" onClick={() => setSelectedId(asset.id)}><div className="text-sm font-semibold text-text-primary">{asset.title}</div><div className="mono mt-1 text-[11px] text-text-muted">{asset.originalFileName}</div></button></td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{asset.assetType}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{asset.country} · {asset.sourceLocale}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{asset.sessionIds.join(", ")}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{asset.version}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{formatBytes(asset.sizeBytes)}</td>
                      <td className="px-4 py-3"><StatusBadge status={asset.status === "failed" ? "error" : asset.status === "ready" ? "approved" : asset.status === "needs_review" ? "review" : "draft"} /></td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{asset.extractionStatus}</td>
                      <td className="px-4 py-3"><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => queueMutation.mutate(asset.id)}>{actionLabel(asset.extractionStatus)}</Button><Button size="sm" variant="secondary" onClick={() => draftMutation.mutate(asset.id)} disabled={asset.extractionStatus === "not_started" || asset.extractionStatus === "queued" || asset.extractionStatus === "extracting"}>Review draft</Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <DetailDrawer open={!!selectedId} onClose={() => setSelectedId(null)} title={selectedAsset?.title ?? "Asset detail"} subtitle={selectedAsset?.id} width="w-[860px]">
        {selectedAsset && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {["overview", "versions", "relationships", "extracted"].map((tab) => (
                <Button key={tab} variant={detailTab === tab ? "primary" : "secondary"} onClick={() => setDetailTab(tab as typeof detailTab)}>{tab}</Button>
              ))}
            </div>

            {detailTab === "overview" && (
              <Card>
                <SectionHeader title="Overview" description="Current asset metadata and action shortcuts" />
                <div className="grid gap-3 p-4 sm:grid-cols-2">
                  {[
                    ["Current version", selectedAsset.version],
                    ["Checksum", selectedAsset.checksumSha256],
                    ["Locale", `${selectedAsset.country} · ${selectedAsset.sourceLocale}`],
                    ["Sessions", selectedAsset.sessionIds.join(", ")],
                    ["Extraction", selectedAsset.extractionStatus],
                    ["Size", formatBytes(selectedAsset.sizeBytes)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-panel border border-border bg-surface-subtle p-3"><div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div><div className="mt-1 break-all text-sm font-medium text-text-primary">{value}</div></div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 p-4 pt-0">
                  <Button variant="secondary" onClick={() => queueMutation.mutate(selectedAsset.id)}><Clock3 className="h-4 w-4" />{actionLabel(selectedAsset.extractionStatus)}</Button>
                  <Button variant="secondary" onClick={() => draftMutation.mutate(selectedAsset.id)}><CheckCircle2 className="h-4 w-4" />Create review draft</Button>
                  <Button variant="secondary" onClick={() => setVersionModalOpen(true)}><FilePlus2 className="h-4 w-4" />Add new version</Button>
                  <Button variant="secondary" onClick={() => setRelationshipOpen(true)}><GitBranchPlus className="h-4 w-4" />Add relationship</Button>
                  <Button variant="secondary" onClick={() => archiveMutation.mutate(selectedAsset.id)}><Archive className="h-4 w-4" />Archive</Button>
                </div>
              </Card>
            )}

            {detailTab === "versions" && (
              <Card>
                <SectionHeader title="Versions" description="Switch the current version, add new versions, and compare quickly" action={<Button size="sm" variant="secondary" onClick={() => setVersionModalOpen(true)}>New version</Button>} />
                <div className="space-y-3 p-4">
                  {versions.map((version) => (
                    <div key={version.id} className="rounded-panel border border-border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={version.isCurrent ? "primary" : "neutral"}>{version.version}</Badge>
                            <Badge tone={version.extractionStatus === "completed" ? "success" : version.extractionStatus === "failed" ? "critical" : "warning"}>{version.extractionStatus}</Badge>
                          </div>
                          <div className="mt-2 text-sm font-semibold text-text-primary">{version.fileName}</div>
                          <div className="mono mt-1 text-[11px] text-text-muted">{version.checksumSha256}</div>
                          <div className="mt-1 text-xs text-text-secondary">{version.changeSummary}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!version.isCurrent && <Button size="sm" variant="secondary" onClick={() => currentVersionMutation.mutate({ assetId: selectedAsset.id, versionId: version.id })}>Set as current</Button>}
                          <Button size="sm" variant="secondary" onClick={() => setVersionCompareIds((current) => current?.left ? { left: current.left, right: version.id } : { left: version.id, right: version.id })}><ArrowLeftRight className="h-4 w-4" />Select for compare</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {versionDiffQuery.data && (
                    <Card className="border-dashed">
                      <SectionHeader title="Version diff" description={`${versionDiffQuery.data.left.version} ↔ ${versionDiffQuery.data.right.version}`} />
                      <div className="grid gap-4 p-4 lg:grid-cols-2">
                        <div><div className="mb-2 text-xs font-semibold text-text-primary">Added blocks</div><div className="space-y-2">{versionDiffQuery.data.addedBlocks.slice(0, 4).map((item) => <div key={item} className="rounded-panel border border-border bg-surface-subtle p-2 text-xs text-text-secondary">{item.slice(0, 180)}</div>)}</div></div>
                        <div><div className="mb-2 text-xs font-semibold text-text-primary">Removed blocks</div><div className="space-y-2">{versionDiffQuery.data.removedBlocks.slice(0, 4).map((item) => <div key={item} className="rounded-panel border border-border bg-surface-subtle p-2 text-xs text-text-secondary">{item.slice(0, 180)}</div>)}</div></div>
                      </div>
                    </Card>
                  )}
                </div>
              </Card>
            )}

            {detailTab === "relationships" && (
              <Card>
                <SectionHeader title="Relationships" description="translation_of, transcript_of, revision_of, and supports links" action={<Button size="sm" variant="secondary" onClick={() => setRelationshipOpen(true)}>Add relationship</Button>} />
                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-text-secondary">Outgoing</div>
                    {relationships.filter((item) => item.sourceAssetId === selectedAsset.id).map((item) => (
                      <div key={item.id} className="rounded-panel border border-border p-3">
                        <div className="text-sm font-semibold text-text-primary">{item.relationType}</div>
                        <div className="mt-1 text-xs text-text-secondary">{assets.find((asset) => asset.id === item.targetAssetId)?.title ?? item.targetAssetId}</div>
                        {item.notes && <div className="mt-2 text-xs text-text-secondary">{item.notes}</div>}
                      </div>
                    ))}
                    {!relationships.some((item) => item.sourceAssetId === selectedAsset.id) && <EmptyState title="No outgoing relationships" description="This asset currently has no references to other assets." />}
                  </div>
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-text-secondary">Incoming</div>
                    {relationships.filter((item) => item.targetAssetId === selectedAsset.id).map((item) => (
                      <div key={item.id} className="rounded-panel border border-border p-3">
                        <div className="text-sm font-semibold text-text-primary">{item.relationType}</div>
                        <div className="mt-1 text-xs text-text-secondary">{assets.find((asset) => asset.id === item.sourceAssetId)?.title ?? item.sourceAssetId}</div>
                        {item.notes && <div className="mt-2 text-xs text-text-secondary">{item.notes}</div>}
                      </div>
                    ))}
                    {!relationships.some((item) => item.targetAssetId === selectedAsset.id) && <EmptyState title="No incoming relationships" description="No other assets currently reference this asset." />}
                  </div>
                </div>
              </Card>
            )}

            {detailTab === "extracted" && (
              <Card>
                <SectionHeader title="Extracted Content" description="Preview extracted blocks from the current version" />
                <div className="space-y-3 p-4">
                  {extractedDocument?.blocks.slice(0, 10).map((block) => (
                    <div key={block.id} className="rounded-panel border border-border p-3">
                      <div className="flex flex-wrap gap-2"><SourceReferenceChip label={block.sourceLocator} />{block.pageNumber ? <SourceReferenceChip label={`page ${block.pageNumber}`} /> : null}</div>
                      <div className="mt-2 text-sm text-text-primary">{block.text.slice(0, 280)}</div>
                    </div>
                  ))}
                  {!extractedDocument && <EmptyState title="No extracted content yet" description="Queue extraction for the current version to see block-based output." />}
                </div>
              </Card>
            )}
          </div>
        )}
      </DetailDrawer>

      <Modal open={versionModalOpen} onClose={() => setVersionModalOpen(false)} title="Register New Asset Version" description="Add a new version without overwriting existing files." width="max-w-2xl">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Version"><input value={versionForm.version} onChange={(event) => setVersionForm((current) => ({ ...current, version: event.target.value }))} className={inputClass} /></Field>
          <Field label="Version file"><input type="file" onChange={(event) => setVersionFile(event.target.files?.[0] ?? null)} className={inputClass} /></Field>
          <div className="sm:col-span-2"><Field label="Change summary"><textarea value={versionForm.changeSummary} onChange={(event) => setVersionForm((current) => ({ ...current, changeSummary: event.target.value }))} className={textareaClass} /></Field></div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={versionForm.rerunExtraction} onChange={(event) => setVersionForm((current) => ({ ...current, rerunExtraction: event.target.checked }))} />Re-run extraction after saving</label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" onClick={() => setVersionModalOpen(false)}>Cancel</Button><Button loading={versionMutation.isPending} onClick={() => versionMutation.mutate()}>Save version</Button></div>
      </Modal>

      <Modal open={relationshipOpen} onClose={() => setRelationshipOpen(false)} title="Create Asset Relationship" description="Connect translation, transcript, revision, and support relationships between assets." width="max-w-2xl">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Relation type"><select value={relationshipForm.relationType} onChange={(event) => setRelationshipForm((current) => ({ ...current, relationType: event.target.value as AssetRelationshipType }))} className={inputClass}>{["translation_of", "transcript_of", "revision_of", "supports"].map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Target asset"><select value={relationshipForm.targetAssetId} onChange={(event) => setRelationshipForm((current) => ({ ...current, targetAssetId: event.target.value }))} className={inputClass}><option value="">Select asset</option>{assets.filter((asset) => asset.id !== selectedId).map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></Field>
          <div className="sm:col-span-2"><Field label="Notes"><textarea value={relationshipForm.notes} onChange={(event) => setRelationshipForm((current) => ({ ...current, notes: event.target.value }))} className={textareaClass} /></Field></div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" onClick={() => setRelationshipOpen(false)}>Cancel</Button><Button loading={relationshipMutation.isPending} onClick={() => relationshipMutation.mutate()}>Create relationship</Button></div>
      </Modal>
    </AppShell>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
