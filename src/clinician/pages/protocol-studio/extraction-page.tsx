"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, Copy, Expand, Save, SplitSquareHorizontal, XCircle } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, PageSkeleton, SaveStatus, SectionHeader, SourceReferenceChip, StatusBadge, ValidationSeverityBadge, inputClass, textareaClass } from "@/components/ui/primitives";
import {
  approveStructuredItem,
  createProtocolDraftCandidate,
  createReviewDecision,
  createSourceEvidenceFromBlocks,
  createStructuredItem,
  getClinicalAssetsApi,
  getExtractionReviewDraftApi,
  getLatestExtractionReviewDraftApi,
  updateStructuredItem,
  validateExtractionDraft,
} from "@/lib/api/clinical-assets-api";
import { duplicateSessionEntry, getActiveSessionId, getSessionById, getSessionNodeCount, getSessionPromptCount, getSessionTotals, loadSessionDefinitions, loadSessionPlan, restoreDefaultSessionPlan, saveSessionPlan, setStartingSession, toggleSessionEntryActive, reorderSessionEntry } from "@/lib/session-catalog";
import type { DraftValidationIssue, ExtractedBlock, StructuredTbctItem, TbctMappingType } from "@/types/clinical-assets";

const mappingOptions: { value: TbctMappingType; label: string }[] = [
  { value: "session_goal", label: "Session Goal" },
  { value: "clinical_intent", label: "Clinical Intent" },
  { value: "basic_question", label: "Basic Question" },
  { value: "expected_response", label: "Expected Response" },
  { value: "follow_up_branch", label: "Follow-up Branch" },
  { value: "therapeutic_activity", label: "Therapeutic Activity" },
  { value: "homework", label: "Homework" },
  { value: "visualization", label: "Visualization" },
  { value: "completion_condition", label: "Completion Condition" },
  { value: "safety_rule", label: "Safety Rule" },
  { value: "clinician_intervention_condition", label: "Clinician Intervention Condition" },
];

export function ExtractionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const draftId = searchParams.get("draft");
  const deepLinkedItemId = searchParams.get("item");
  const deepLinkedAssetId = searchParams.get("asset");
  const deepLinkedVersionId = searchParams.get("version");
  const deepLinkedBlockId = searchParams.get("block");
  const selectedTab = searchParams.get("tab") === "source-review" ? "source-review" : "session-flow";
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [validationResult, setValidationResult] = useState<{ issues: DraftValidationIssue[]; summary: { totalItems: number; approvedItems: number; evidenceCoverage: number; readiness: string } } | null>(null);
  const [mappingForm, setMappingForm] = useState({
    mappingType: "basic_question" as TbctMappingType,
    title: "",
    content: "",
    clinicalRationale: "",
    sessionId: "Session 03",
  });

  const draftQuery = useQuery({
    queryKey: ["extraction-local-draft", draftId ?? "latest"],
    queryFn: async () => {
      if (draftId) {
        const requestedDraft = await getExtractionReviewDraftApi(draftId);
        if (requestedDraft) return requestedDraft;
      }
      return getLatestExtractionReviewDraftApi();
    },
  });
  const manualsQuery = useQuery({ queryKey: ["clinical-manual-assets"], queryFn: () => getClinicalAssetsApi({}) });

  const draftData = draftQuery.data;
  const draftAsset = draftData?.asset ?? null;
  const draftDocument = draftData?.document ?? null;
  const draftRecord = draftData?.draft ?? null;
  const blocks = useMemo(() => draftData?.sourceBlocks ?? [], [draftData?.sourceBlocks]);
  const structuredItems = useMemo(() => draftData?.structuredItems ?? [], [draftData?.structuredItems]);
  const evidence = useMemo(() => draftData?.evidence ?? [], [draftData?.evidence]);
  const activeItem = structuredItems.find((item) => item.id === activeItemId) ?? structuredItems[0] ?? null;

  useEffect(() => {
    if (!activeItemId && structuredItems[0]) setActiveItemId(structuredItems[0].id);
  }, [activeItemId, structuredItems]);

  useEffect(() => {
    if (deepLinkedItemId && structuredItems.some((item) => item.id === deepLinkedItemId)) {
      setActiveItemId(deepLinkedItemId);
    }
  }, [deepLinkedItemId, structuredItems]);

  useEffect(() => {
    if (!deepLinkedBlockId) return;
    const matchedEvidence = evidence.find((entry) => entry.blockId.split(",").includes(deepLinkedBlockId));
    if (matchedEvidence) {
      setSelectedBlockIds(matchedEvidence.blockId.split(","));
      return;
    }
    if (blocks.some((block) => block.id === deepLinkedBlockId)) {
      setSelectedBlockIds([deepLinkedBlockId]);
    }
  }, [blocks, deepLinkedBlockId, evidence]);

  const selectedBlocks = useMemo(
    () => blocks.filter((block) => selectedBlockIds.includes(block.id)).sort((a, b) => a.blockIndex - b.blockIndex),
    [blocks, selectedBlockIds],
  );

  const selectedEvidence = useMemo(() => {
    if (!activeItem) return [];
    return evidence.filter((item) => activeItem.sourceEvidenceIds.includes(item.id));
  }, [activeItem, evidence]);

  const manualAssets = useMemo(
    () => (manualsQuery.data ?? []).filter((asset) => asset.protocolId || asset.assetType === "therapist_manual" || asset.assetType === "patient_manual"),
    [manualsQuery.data],
  );
  const [sessionPlan, setSessionPlan] = useState(() => loadSessionPlan());
  const sessionTotals = useMemo(() => getSessionTotals(), []);
  const activeSessionId = getActiveSessionId();

  const refreshDraft = async () => {
    await queryClient.invalidateQueries({ queryKey: ["extraction-local-draft", draftId] });
  };

  const refreshPlan = () => setSessionPlan({ ...loadSessionPlan(), orderedEntries: [...loadSessionPlan().orderedEntries] });

  const createMappingMutation = useMutation({
    mutationFn: async () => {
      if (!draftData?.draft || !draftData.asset || !draftData.document || !selectedBlocks.length) throw new Error("Select source blocks first");
      const sourceEvidence = await createSourceEvidenceFromBlocks(
        draftData.draft.id,
        draftData.asset.id,
        draftData.document.id,
        selectedBlocks,
        draftData.asset.currentVersionId,
      );
      return createStructuredItem({
        draftId: draftData.draft.id,
        sessionId: mappingForm.sessionId,
        mappingType: mappingForm.mappingType,
        title: mappingForm.title || selectedBlocks[0].text.slice(0, 48),
        content: mappingForm.content || selectedBlocks.map((block) => block.text).join("\n\n"),
        clinicalRationale: mappingForm.clinicalRationale,
        sourceEvidenceIds: [sourceEvidence.id],
        createdBy: "Demo User",
      });
    },
    onSuccess: async (item) => {
      setSaveState("saved");
      setSelectedBlockIds([]);
      setActiveItemId(item.id);
      setMappingOpen(false);
      await refreshDraft();
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: Partial<StructuredTbctItem> }) => updateStructuredItem(itemId, patch),
    onSuccess: async () => {
      setSaveState("saved");
      await refreshDraft();
    },
  });

  const approveMutation = useMutation({
    mutationFn: (itemId: string) => approveStructuredItem(itemId),
    onSuccess: async () => {
      await refreshDraft();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await updateStructuredItem(itemId, { status: "rejected" });
      if (draftData?.draft.id) {
        await createReviewDecision({ draftId: draftData.draft.id, structuredItemId: itemId, decision: "reject", createdBy: "Demo User" });
      }
    },
    onSuccess: refreshDraft,
  });

  const validationMutation = useMutation({
    mutationFn: () => validateExtractionDraft(draftData!.draft.id),
    onSuccess: (result) => setValidationResult(result),
  });

  const candidateMutation = useMutation({
    mutationFn: () => createProtocolDraftCandidate(draftData!.draft.id),
    onSuccess: (candidate) => {
      router.push(`/projects/demo/protocols/tbct-br-001/canvas?candidate=${candidate.id}`);
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) && !(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "m" && selectedBlocks.length) setMappingOpen(true);
      if (event.key.toLowerCase() === "a" && activeItem) void approveMutation.mutate(activeItem.id);
      if (event.key.toLowerCase() === "r" && activeItem) void rejectMutation.mutate(activeItem.id);
      if (event.key.toLowerCase() === "e" && activeItem) setActiveItemId(activeItem.id);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && activeItem) {
        event.preventDefault();
        setSaveState("saving");
        updateItemMutation.mutate({ itemId: activeItem.id, patch: { updatedAt: new Date().toISOString() } });
      }
      if (event.key === "Escape") {
        setSelectedBlockIds([]);
        setMappingOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeItem, approveMutation, rejectMutation, selectedBlocks.length, updateItemMutation]);

  if (draftQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if ((!draftRecord || !draftAsset || !draftDocument) && selectedTab !== "session-flow") {
    return (
      <AppShell>
          <Card className="m-4 lg:m-6">
            <EmptyState title="No draft available" description="Create an extraction review draft from Clinical Assets first." />
        </Card>
      </AppShell>
    );
  }

  const nextIssueCount = validationResult?.issues.length ?? 0;
  const approvedCount = structuredItems.filter((item) => item.status === "approved").length;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Clinical Structuring Review"
        title={selectedTab === "session-flow" ? "Session Flow Workspace" : "Extraction Review"}
        description={selectedTab === "session-flow" ? "Review the full TBCT session sequence first, then move into the source review trail only when needed." : "Select source blocks, map to TBCT items, link evidence, approve review items, and generate protocol draft candidates."}
        meta={<><Badge tone="primary">{deepLinkedAssetId ?? draftAsset?.id ?? "No draft"}</Badge><Badge tone="neutral">{deepLinkedVersionId ?? draftAsset?.currentVersionId ?? "Current version"}</Badge><Badge tone="neutral">{draftRecord?.sessionId ?? "Unlinked session"}</Badge><Badge tone="warning">{structuredItems.length} items</Badge><Badge tone="success">{approvedCount} approved</Badge></>}
        actions={<><Button variant={selectedTab === "session-flow" ? "primary" : "secondary"} onClick={() => router.push(`/projects/demo/extraction${draftId ? `?draft=${draftId}&` : "?"}tab=session-flow`)}>Session Flow</Button><Button variant={selectedTab === "source-review" ? "primary" : "secondary"} onClick={() => router.push(`/projects/demo/extraction${draftId ? `?draft=${draftId}&` : "?"}tab=source-review`)}>Source Review</Button><select className={inputClass} value={draftAsset?.id ?? ""} onChange={(event) => { const selected = manualAssets.find((asset) => asset.id === event.target.value); if (!selected) return; router.push(`/projects/demo/extraction${selected.extractionDraftId ? `?draft=${selected.extractionDraftId}` : ""}`); }}><option value={draftAsset?.id ?? ""}>{draftAsset?.title ?? "Select manual"}</option>{manualAssets.filter((asset) => asset.id !== draftAsset?.id).map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select><SaveStatus state={saveState} /><Button variant="secondary" onClick={() => validationMutation.mutate()}>Draft validation</Button><Button onClick={() => candidateMutation.mutate()} disabled={!approvedCount}>Create Protocol Draft</Button></>}
      />

      <div className="p-4 lg:p-6">
        {selectedTab === "session-flow" && (
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <SectionHeader title="Session Flow Overview" description="The same extraction data is summarized at the session level without replacing Source Review." action={<Badge tone="neutral">{sessionPlan.id}</Badge>} />
              <div className="grid gap-3 border-t border-border p-4 md:grid-cols-4">
                <div className="rounded-panel border border-border bg-surface-subtle p-3"><div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Sessions</div><div className="mt-1 text-lg font-semibold text-text-primary">{loadSessionDefinitions().length}</div></div>
                <div className="rounded-panel border border-border bg-surface-subtle p-3"><div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Enabled</div><div className="mt-1 text-lg font-semibold text-text-primary">{sessionTotals.enabled}/8</div></div>
                <div className="rounded-panel border border-border bg-surface-subtle p-3"><div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Nodes</div><div className="mt-1 text-lg font-semibold text-text-primary">{sessionTotals.nodes}</div></div>
                <div className="rounded-panel border border-border bg-surface-subtle p-3"><div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Prompts</div><div className="mt-1 text-lg font-semibold text-text-primary">{sessionTotals.prompts}</div></div>
              </div>
            </Card>
            <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
              <Card className="overflow-hidden">
                <SectionHeader title="Ordered Session Plan" description="Each session is surfaced as a step in the plan." action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { const restored = restoreDefaultSessionPlan(); setSessionPlan(restored); }}>Restore default</Button><Button size="sm" variant="secondary" onClick={() => { saveSessionPlan(sessionPlan); refreshPlan(); }}>Save Session Plan</Button></div>} />
                <div className="divide-y divide-border">
                  {sessionPlan.orderedEntries.map((entry) => {
                    const session = getSessionById(entry.sessionId);
                    const sessionTitle = session?.title ?? "Unknown session";
                    const repeatLabel = entry.occurrence > 1 ? ` — Repeat ${entry.occurrence}` : "";
                    return (
                    <div key={entry.entryId} className={`flex items-start justify-between gap-4 px-4 py-4 hover:bg-surface-subtle ${selectedTab === "session-flow" && entry.sessionId === activeSessionId ? "bg-clinical-blue-light/30" : ""}`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="primary">Order {entry.order}</Badge>
                          <Badge tone={entry.active ? "success" : "neutral"}>{entry.active ? "active" : "inactive"}</Badge>
                          <Badge tone={session?.status === "released" ? "success" : session?.status === "reviewed" ? "primary" : "neutral"}>{session?.technique ?? entry.sessionId}</Badge>
                        </div>
                        <div className="mt-2 text-sm font-semibold text-text-primary">{String(entry.order).padStart(2, "0")} · {sessionTitle}{repeatLabel}</div>
                        <div className="mt-1 text-xs text-text-secondary">{session?.technique ?? "Unknown technique"} · {getSessionNodeCount(entry.sessionId)} nodes · {getSessionPromptCount(entry.sessionId)} prompts</div>
                      </div>
                      <div className="flex flex-col items-end gap-2 text-right text-xs text-text-secondary"><div>{getSessionNodeCount(entry.sessionId)} nodes</div><div>{getSessionPromptCount(entry.sessionId)} prompts</div><div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => { setSessionPlan(reorderSessionEntry(entry.sessionId, -1)); }}>Up</Button><Button size="sm" variant="secondary" onClick={() => { setSessionPlan(reorderSessionEntry(entry.sessionId, 1)); }}>Down</Button><Button size="sm" variant="secondary" onClick={() => { setSessionPlan(toggleSessionEntryActive(entry.sessionId)); refreshPlan(); }}>{entry.active ? "Disable" : "Enable"}</Button><Button size="sm" variant="secondary" onClick={() => { setSessionPlan(duplicateSessionEntry(entry.sessionId)); refreshPlan(); }}>Duplicate</Button><Button size="sm" variant="primary" onClick={() => { setSessionPlan(setStartingSession(entry.sessionId)); refreshPlan(); }}>Start</Button></div></div>
                    </div>
                    );
                  })}
                </div>
              </Card>
              <Card className="overflow-hidden">
                <SectionHeader title="Session Drill-down" description="Keep the current extraction review flow, but preview the selected session first." />
                <div className="space-y-3 border-t border-border p-4">
                  <div className="rounded-panel border border-border bg-surface-subtle p-3"><div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Current plan</div><div className="mt-1 text-sm font-semibold text-text-primary">{sessionPlan.id}</div></div>
                  <div className="rounded-panel border border-border bg-surface-subtle p-3"><div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Starting session</div><div className="mt-1 text-sm font-semibold text-text-primary">{sessionPlan.startingEntryId}</div></div>
                  <div className="rounded-panel border border-border bg-surface-subtle p-3"><div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Occurrence model</div><div className="mt-1 text-sm font-semibold text-text-primary">Session occurrences are tracked separately from the base definition.</div></div>
                  <Button onClick={() => router.push(`/projects/demo/protocols/tbct-br-001/canvas?sessionId=${activeSessionId}`)}>Open Session Builder</Button>
                </div>
              </Card>
            </div>
          </div>
        )}

        {selectedTab === "source-review" && draftRecord && draftAsset && draftDocument && (
        <>
        <div className="mb-4 grid gap-3 xl:grid-cols-4">
          <Card className="p-4"><div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Structured items</div><div className="mt-2 text-2xl font-semibold text-text-primary">{structuredItems.length}</div></Card>
          <Card className="p-4"><div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Approved</div><div className="mt-2 text-2xl font-semibold text-text-primary">{approvedCount}</div></Card>
          <Card className="p-4"><div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Evidence coverage</div><div className="mt-2 text-2xl font-semibold text-text-primary">{validationResult?.summary.evidenceCoverage ?? 0}%</div></Card>
          <Card className="p-4"><div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Validation issues</div><div className="mt-2 text-2xl font-semibold text-text-primary">{nextIssueCount}</div></Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[31%_43%_26%]">
          <Card className="overflow-hidden">
            <SectionHeader title="Source Viewer" description="Block search, multi-select, and evidence mapping" action={<Badge tone="primary">{selectedBlocks.length} selected</Badge>} />
            <div className="border-b border-border p-3">
              <div className="flex gap-2">
                <input className={inputClass} placeholder="Search block text" />
                <Button variant="secondary" disabled={!selectedBlocks.length} onClick={() => {
                  setMappingForm((current) => ({ ...current, content: selectedBlocks.map((block) => block.text).join("\n\n"), title: selectedBlocks[0]?.text.slice(0, 48) ?? "" }));
                  setMappingOpen(true);
                }}>Map to TBCT item</Button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-340px)] space-y-3 overflow-auto p-4">
              {blocks.map((block) => {
                const selected = selectedBlockIds.includes(block.id);
                return (
                  <button
                    key={block.id}
                    onClick={(event) => {
                      if (event.shiftKey && selectedBlockIds.length) {
                        const lastIndex = blocks.findIndex((entry) => entry.id === selectedBlockIds.at(-1));
                        const currentIndex = blocks.findIndex((entry) => entry.id === block.id);
                        const range = blocks.slice(Math.min(lastIndex, currentIndex), Math.max(lastIndex, currentIndex) + 1).map((entry) => entry.id);
                        setSelectedBlockIds(range);
                      } else {
                        setSelectedBlockIds((current) => current.includes(block.id) ? current.filter((id) => id !== block.id) : [...current, block.id]);
                      }
                    }}
                    className={`w-full rounded-panel border p-3 text-left ${selected ? "border-clinical-blue bg-clinical-blue-light" : "border-border hover:bg-surface-subtle"}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-text-primary">{block.type}</div>
                      <div className="text-[11px] text-text-muted">{block.pageNumber ? `Page ${block.pageNumber}` : block.sourceLocator}</div>
                    </div>
                    <div className="mt-2 text-sm text-text-primary">{block.text}</div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <SectionHeader title="Structured TBCT Workspace" description="Edit structured items by type and link source evidence" />
            <div className="max-h-[calc(100vh-340px)] space-y-4 overflow-auto p-4">
              {structuredItems.length === 0 && <EmptyState title="No structured items yet" description="Select source blocks on the left and map them to TBCT items." />}
              {groupItems(structuredItems).map(([group, items]) => (
                <div key={group} className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{group}</div>
                  {items.map((item) => (
                    <div key={item.id} className={`rounded-panel border p-3 ${activeItemId === item.id ? "border-clinical-blue" : "border-border"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button className="text-left" onClick={() => setActiveItemId(item.id)}>
                          <div className="text-sm font-semibold text-text-primary">{item.title}</div>
                          <div className="mt-1 text-xs text-text-secondary">{mappingOptions.find((option) => option.value === item.mappingType)?.label}</div>
                        </button>
                        <StatusBadge status={item.status} />
                      </div>
                      <textarea
                        value={item.content}
                        onChange={(event) => updateItemMutation.mutate({ itemId: item.id, patch: { content: event.target.value, changeReason: "Inline edit" } })}
                        className={`${textareaClass} mt-3 min-h-20`}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.sourceEvidenceIds.map((evidenceId) => {
                          const entry = evidence.find((itemEvidence) => itemEvidence.id === evidenceId);
                          return (
                            <SourceReferenceChip
                              key={evidenceId}
                              label={entry?.sourceLocator ?? evidenceId}
                              title={entry?.quotedText}
                              onClick={() => {
                                if (!entry) return;
                                setActiveItemId(item.id);
                                setSelectedBlockIds(entry.blockId.split(","));
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <SectionHeader title="Clinical Review Panel" description="Current item review and draft validation" />
            <div className="max-h-[calc(100vh-340px)] space-y-4 overflow-auto p-4">
              {activeItem ? (
                <>
                  <div className="grid gap-3">
                    <ReviewMetric label="Status" value={activeItem.status} />
                    <ReviewMetric label="Evidence count" value={`${activeItem.sourceEvidenceIds.length}`} />
                    <ReviewMetric label="Session" value={activeItem.sessionId ?? "Unlinked"} />
                  </div>
                  <Field label="Clinical rationale">
                    <textarea
                      value={activeItem.clinicalRationale ?? ""}
                      onChange={(event) => updateItemMutation.mutate({ itemId: activeItem.id, patch: { clinicalRationale: event.target.value, changeReason: "Clinical rationale update" } })}
                      className={textareaClass}
                    />
                  </Field>
                  <div className="rounded-panel border border-border bg-surface-subtle p-3">
                    <div className="text-xs font-semibold text-text-primary">Source evidence</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedEvidence.map((entry) => (
                        <SourceReferenceChip
                          key={entry.id}
                          label={entry.sourceLocator}
                          title={entry.quotedText}
                          onClick={() => setSelectedBlockIds(entry.blockId.split(","))}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => rejectMutation.mutate(activeItem.id)}><XCircle className="h-4 w-4" />Reject</Button>
                    <Button onClick={() => approveMutation.mutate(activeItem.id)}><CheckCircle2 className="h-4 w-4" />Approve</Button>
                  </div>
                </>
              ) : (
                <EmptyState title="No structured item selected" description="Select an item in the center workspace." />
              )}

              {validationResult && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">Validation issues</div>
                  {validationResult.issues.map((issue) => (
                    <button key={issue.id} onClick={() => issue.itemId && setActiveItemId(issue.itemId)} className="w-full rounded-panel border border-border p-3 text-left">
                      <ValidationSeverityBadge severity={issue.severity === "information" ? "info" : issue.severity} />
                      <div className="mt-2 text-sm text-text-primary">{issue.message}</div>
                    </button>
                  ))}
                  {validationResult.issues.length === 0 && <EmptyState title="No validation issues" description="The draft candidate is ready to generate." />}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="sticky bottom-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <Badge tone="neutral">A Approve</Badge>
            <Badge tone="neutral">R Reject</Badge>
            <Badge tone="neutral">M Map</Badge>
            <Badge tone="neutral">Ctrl/Cmd + S Save</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => validationMutation.mutate()}>Run validation</Button>
            <Button variant="secondary" onClick={() => setMappingOpen(true)} disabled={!selectedBlocks.length}><Copy className="h-4 w-4" />Map selected blocks</Button>
            <Button onClick={() => candidateMutation.mutate()} disabled={!approvedCount}><Save className="h-4 w-4" />Create Protocol Draft</Button>
            <Button variant="ghost"><Expand className="h-4 w-4" /></Button>
            <Button variant="ghost"><SplitSquareHorizontal className="h-4 w-4" /></Button>
            <Button variant="ghost"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="ghost"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
        </>
        )}
      </div>

      <Modal open={mappingOpen} onClose={() => setMappingOpen(false)} title="Map to TBCT Item" description="Save selected source blocks as a structured item." width="max-w-2xl">
        <div className="grid gap-4 p-5">
          <Field label="Mapping type"><select value={mappingForm.mappingType} onChange={(event) => setMappingForm((current) => ({ ...current, mappingType: event.target.value as TbctMappingType }))} className={inputClass}>{mappingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
          <Field label="Title"><input value={mappingForm.title} onChange={(event) => setMappingForm((current) => ({ ...current, title: event.target.value }))} className={inputClass} /></Field>
          <Field label="Structured content"><textarea value={mappingForm.content} onChange={(event) => setMappingForm((current) => ({ ...current, content: event.target.value }))} className={textareaClass} /></Field>
          <Field label="Clinical rationale"><textarea value={mappingForm.clinicalRationale} onChange={(event) => setMappingForm((current) => ({ ...current, clinicalRationale: event.target.value }))} className={textareaClass} /></Field>
          <Field label="Session ID"><input value={mappingForm.sessionId} onChange={(event) => setMappingForm((current) => ({ ...current, sessionId: event.target.value }))} className={inputClass} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" onClick={() => setMappingOpen(false)}>Cancel</Button><Button loading={createMappingMutation.isPending} onClick={() => createMappingMutation.mutate()}>Save Structured Item</Button></div>
      </Modal>
    </AppShell>
  );
}

function groupItems(items: StructuredTbctItem[]) {
  const groups: Record<string, StructuredTbctItem[]> = {
    "Session Foundation": [],
    "Therapeutic Dialogue": [],
    Intervention: [],
    "Control and Safety": [],
  };
  for (const item of items) {
    if (["session_goal", "clinical_intent"].includes(item.mappingType)) groups["Session Foundation"].push(item);
    else if (["basic_question", "expected_response", "follow_up_branch"].includes(item.mappingType)) groups["Therapeutic Dialogue"].push(item);
    else if (["therapeutic_activity", "homework", "visualization"].includes(item.mappingType)) groups.Intervention.push(item);
    else groups["Control and Safety"].push(item);
  }
  return Object.entries(groups).filter(([, value]) => value.length > 0);
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel border border-border bg-surface-subtle p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}
