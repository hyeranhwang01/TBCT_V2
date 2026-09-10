"use client";

import {
  getPromptValidationWarnings,
  getSessionCommonRules,
  getSessionNodes,
  getSessionPrompts,
  movePromptItem,
  restorePromptItemFromVerbatim,
  savePromptItems,
  saveSessionCommonRules,
  sessionCatalog,
  togglePromptItemStatus,
  updatePromptItem,
  type PromptItem,
  type SessionCommonRules,
} from "@/lib/session-catalog";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyNodeChanges, type Connection, type NodeChange } from "@xyflow/react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, EmptyState, Modal, PageHeader, PageSkeleton, SaveStatus, inputClass } from "@/components/ui/primitives";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import { useT } from "@/lib/i18n/context";
import {
  attachSafetyRuleToNode,
  createProtocolEdge,
  deleteProtocolEdge,
  deleteProtocolNode,
  duplicateProtocolNode,
  getProtocolDefinitionApi,
  getProtocolGraphApi,
  getSafetyRulesApi,
  importProtocolDraftCandidate,
  previewCandidateImport,
  runProtocolValidation,
  runRuntimeScenario,
  updateProtocolNodeApi,
  upsertProtocolDefinition,
} from "@/lib/api/protocol-api";
import { getClinicalAssetsApi, getExtractionReviewDraftApi, getProtocolDraftCandidateBySourceDraftIdApi } from "@/lib/api/clinical-assets-api";
import type { LocalClinicalAsset, SourceEvidence, ProtocolDraftItem } from "@/types/clinical-assets";
import type { ProtocolDefinition, ProtocolGraphNode, RuntimeExecutionLog } from "@/types/protocol-runtime";
import { SessionPanel } from "./protocol-editor/session-panel";
import { CanvasPanel } from "./protocol-editor/canvas-panel";
import { InspectorPanel, type NextStepOption } from "./protocol-editor/inspector-panel";
import { toEdges, toNodes, type FlowNode } from "./protocol-editor/types";
import { MobileContextBar } from "./protocol-editor/mobile/mobile-context-bar";
import { MobileProtocolTabs, type MobileProtocolTab } from "./protocol-editor/mobile/mobile-protocol-tabs";
import { MobileStepList } from "./protocol-editor/mobile/mobile-step-list";

export function ProtocolPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useT();
  const candidateId = searchParams.get("candidate");
  const manualId = searchParams.get("asset");
  const issueId = searchParams.get("issue");
  const issueNodeId = searchParams.get("node");
  const focusField = searchParams.get("focus");
  const selectedSessionId = searchParams.get("sessionId") ?? searchParams.get("session") ?? "tbct-session-03";
  const [selectedStepId, setSelectedStepId] = useState<string>("");
  const [selectedPromptItemId, setSelectedPromptItemId] = useState<string>("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [runtimeLog, setRuntimeLog] = useState<RuntimeExecutionLog | null>(null);
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [definitionForm, setDefinitionForm] = useState<Partial<ProtocolDefinition>>({});
  const [sessionPanelCollapsed, setSessionPanelCollapsed] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileProtocolTab>("steps");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"question" | "nextStep" | "closingPath" | "generic", string>>>({});
  const reducedMotion = useReducedMotionPreference();

  const logProtocolAction = (action: string, details: Record<string, unknown>) => {
    console.log(`[Protocol Editor] ${action}`, details);
  };

  const graphQuery = useQuery({ queryKey: ["protocol-graph", selectedSessionId], queryFn: () => getProtocolGraphApi("TBCT-BR-001", selectedSessionId) });
  const definitionQuery = useQuery({ queryKey: ["protocol-definition", "TBCT-BR-001"], queryFn: () => getProtocolDefinitionApi("TBCT-BR-001") });
  const manualsQuery = useQuery({ queryKey: ["protocol-manual-assets"], queryFn: () => getClinicalAssetsApi({}) });
  const selectedManual = manualsQuery.data?.find((asset: LocalClinicalAsset) => asset.id === manualId) ?? manualsQuery.data?.find((asset: LocalClinicalAsset) => asset.extractionDraftId) ?? null;
  const evidenceDraftQuery = useQuery({
    queryKey: ["protocol-manual-evidence", selectedManual?.extractionDraftId],
    queryFn: () => getExtractionReviewDraftApi(selectedManual?.extractionDraftId ?? ""),
    enabled: Boolean(selectedManual?.extractionDraftId),
  });
  const selectedCandidateQuery = useQuery({
    queryKey: ["protocol-candidate-by-draft", selectedManual?.extractionDraftId],
    queryFn: () => getProtocolDraftCandidateBySourceDraftIdApi(selectedManual?.extractionDraftId ?? ""),
    enabled: Boolean(selectedManual?.extractionDraftId),
  });
  const previewQuery = useQuery({
    queryKey: ["protocol-import-preview", candidateId, selectedCandidateQuery.data?.id],
    queryFn: () => previewCandidateImport(candidateId ?? selectedCandidateQuery.data?.id ?? ""),
    enabled: Boolean(candidateId || selectedCandidateQuery.data?.id),
  });
  const safetyRulesQuery = useQuery({ queryKey: ["safety-rules-live"], queryFn: () => getSafetyRulesApi({ active: true }) });

  const selectedNode = graphQuery.data?.nodes.find((item) => item.id === selectedStepId) ?? graphQuery.data?.nodes[0] ?? null;
  const [draft, setDraft] = useState<ProtocolGraphNode | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("");
  const selectedIssue = graphQuery.data?.validationRun?.issues.find((issue) => issue.id === issueId) ?? null;
  const shouldFocusSourceEvidence = Boolean(focusField === "source-evidence" && issueNodeId && issueId && selectedIssue?.category === "Source Traceability");

  useEffect(() => {
    if (candidateId && previewQuery.data) setImportPreviewOpen(true);
  }, [candidateId, previewQuery.data]);

  useEffect(() => {
    if (issueNodeId && graphQuery.data?.nodes.some((node) => node.id === issueNodeId)) {
      setSelectedStepId(issueNodeId);
      return;
    }
    if (selectedNode) {
      setSelectedStepId(selectedNode.id);
      setDraft(selectedNode);
    }
  }, [graphQuery.data?.nodes, issueNodeId, selectedNode]);

  useEffect(() => {
    if (selectedNode) setDraft(selectedNode);
  }, [selectedNode]);

  const refreshGraph = async () => {
    await queryClient.invalidateQueries({ queryKey: ["protocol-graph", selectedSessionId] });
    await queryClient.invalidateQueries({ queryKey: ["protocol-graph-validation", selectedSessionId] });
    await queryClient.refetchQueries({ queryKey: ["protocol-graph-validation", selectedSessionId] });
    await queryClient.invalidateQueries({ queryKey: ["protocol-manual-evidence", selectedManual?.extractionDraftId] });
  };

  const attachEvidenceMutation = useMutation({
    mutationFn: () => {
      if (!draft || !selectedEvidenceId) throw new Error("Select evidence first");
      return updateProtocolNodeApi(draft.id, {
        data: {
          ...draft.data,
          sourceEvidenceIds: [...new Set([...draft.data.sourceEvidenceIds, selectedEvidenceId])],
          metadata: { ...draft.data.metadata, updatedBy: "Demo User", updatedAt: new Date().toISOString() },
        },
      });
    },
    onSuccess: async () => {
      setSelectedEvidenceId("");
      toast.success("Source evidence attached");
      await validationMutation.mutateAsync();
      await refreshGraph();
    },
    onError: () => toast.error("Failed to attach evidence"),
  });

  const importMutation = useMutation({
    mutationFn: () => importProtocolDraftCandidate(candidateId ?? selectedCandidateQuery.data?.id ?? ""),
    onSuccess: async () => {
      logProtocolAction("candidate import success", { candidateId, protocolId: "TBCT-BR-001", sessionId: selectedSessionId });
      setImportPreviewOpen(false);
      toast.success("Candidate import completed");
      await refreshGraph();
    },
    onError: (error: unknown) => {
      logProtocolAction("candidate import failed", { candidateId, error: String(error) });
      toast.error("Candidate import failed");
    },
  });

  const validationMutation = useMutation({
    mutationFn: () => runProtocolValidation("TBCT-BR-001", selectedSessionId),
    onMutate: () => {
      logProtocolAction("validation start", {
        protocolId: "TBCT-BR-001",
        sessionId: selectedSessionId,
        nodeCount: graphQuery.data?.nodes.length ?? 0,
        edgeCount: graphQuery.data?.edges.length ?? 0,
      });
    },
    onSuccess: async () => {
      const summary = graphQuery.data?.validationRun?.summary;
      logProtocolAction("validation success", {
        protocolId: "TBCT-BR-001",
        sessionId: selectedSessionId,
        critical: summary?.critical ?? 0,
        warning: summary?.warning ?? 0,
        information: summary?.information ?? 0,
      });
      await refreshGraph();
    },
    onError: (error: unknown) => {
      logProtocolAction("validation failed", {
        protocolId: "TBCT-BR-001",
        sessionId: selectedSessionId,
        error: String(error),
      });
      toast.error("Protocol validation failed");
    },
  });

  const runtimeMutation = useMutation({
    mutationFn: () => runRuntimeScenario("TBCT-BR-001", selectedSessionId),
    onSuccess: (result) => {
      setRuntimeLog(result);
      toast.success("Runtime preview completed");
    },
  });

  const saveNodeMutation = useMutation({
    mutationFn: (node: ProtocolGraphNode) =>
      updateProtocolNodeApi(node.id, {
        position: node.position,
        data: {
          ...node.data,
          metadata: { ...node.data.metadata, updatedBy: "Demo User", updatedAt: new Date().toISOString() },
        },
      }),
    onSuccess: async () => {
      setSaveState("saved");
      await refreshGraph();
    },
    onError: () => {
      setSaveState("error");
      toast.error("Node save failed");
    },
  });

  const saveDefinitionMutation = useMutation({
    mutationFn: () => upsertProtocolDefinition("TBCT-BR-001", definitionForm),
    onSuccess: async () => {
      toast.success("Protocol definition saved");
      await queryClient.invalidateQueries({ queryKey: ["protocol-definition", "TBCT-BR-001"] });
      await refreshGraph();
    },
    onError: () => toast.error("Protocol definition save failed"),
  });

  const duplicateNodeMutation = useMutation({
    mutationFn: (nodeId: string) => duplicateProtocolNode(nodeId, { keepSourceEvidence: true }),
    onSuccess: async () => {
      toast.success("Node duplicated");
      await refreshGraph();
    },
  });

  const deleteNodeMutation = useMutation({
    mutationFn: (nodeId: string) => deleteProtocolNode(nodeId, { reason: "Delete node from canvas" }),
    onSuccess: async () => {
      setSelectedStepId("");
      toast.success("Node deleted");
      await refreshGraph();
    },
  });

  const createEdgeMutation = useMutation({
    mutationFn: (connection: Connection) =>
      createProtocolEdge({
        protocolId: "TBCT-BR-001",
        sessionId: selectedSessionId,
        source: connection.source ?? "",
        target: connection.target ?? "",
        edgeType: "default",
        priority: 1,
        reason: "React Flow connect",
      }),
    onSuccess: async () => {
      toast.success("Edge created");
      await refreshGraph();
    },
  });

  const deleteEdgeMutation = useMutation({
    mutationFn: (edgeId: string) => deleteProtocolEdge(edgeId),
    onSuccess: async () => {
      toast.success("Edge deleted");
      await refreshGraph();
    },
  });

  const attachSafetyMutation = useMutation({
    mutationFn: ({ nodeId, ruleId }: { nodeId: string; ruleId: string }) => attachSafetyRuleToNode(nodeId, ruleId, "Linked in protocol editor"),
    onSuccess: async () => {
      toast.warning("Safety rule attached");
      await refreshGraph();
    },
  });

  const nodes = useMemo(() => toNodes(graphQuery.data?.nodes ?? []), [graphQuery.data?.nodes]);
  const edges = useMemo(() => toEdges(graphQuery.data?.edges ?? []), [graphQuery.data?.edges]);
  const availableEvidence = (evidenceDraftQuery.data?.evidence ?? []) as SourceEvidence[];
  const validationRun = graphQuery.data?.validationRun;
  const selectedSessionMeta = sessionCatalog.find((session) => session.id === graphQuery.data?.session.id)
    ?? sessionCatalog.find((session) => session.id === selectedSessionId)
    ?? sessionCatalog[0];
  const sessionFlowNodes = nodes;
  const sessionFlowEdges = edges;
  const immutableSourceView = graphQuery.data?.definition?.id === "tbct-br-001";
  const selectedSessionNode = useMemo(() => sessionFlowNodes.find((item) => item.id === selectedStepId) ?? sessionFlowNodes[0] ?? null, [sessionFlowNodes, selectedStepId]);
  const builderNodes = getSessionNodes(selectedSessionMeta.id);
  const selectedBuilderNode = builderNodes.find((node) => node.id === selectedSessionNode?.id) ?? null;
  const sessionPrompts = getSessionPrompts(selectedSessionMeta.id, selectedSessionNode?.id);
  const selectedPromptItem = sessionPrompts.find((item) => item.id === selectedPromptItemId) ?? sessionPrompts[0] ?? null;
  const sessionCommonRules = getSessionCommonRules(selectedSessionMeta.id);
  void selectedBuilderNode;
  void getPromptValidationWarnings;

  const compiledPreviewQuery = useQuery({
    queryKey: ["compiled-runtime-prompt-preview-simple", selectedPromptItem?.id],
    enabled: Boolean(selectedPromptItem),
    queryFn: async () => selectedPromptItem?.editableText ?? "",
  });

  useEffect(() => {
    setFlowNodes(sessionFlowNodes);
  }, [sessionFlowNodes]);

  useEffect(() => {
    if (selectedPromptItem?.id) setSelectedPromptItemId(selectedPromptItem.id);
  }, [selectedPromptItem?.id]);

  useEffect(() => {
    if (definitionQuery.data) setDefinitionForm(definitionQuery.data);
  }, [definitionQuery.data]);

  useEffect(() => {
    setFieldErrors({});
  }, [draft?.id]);

  const nextStepOptions: NextStepOption[] = useMemo(() => {
    if (!draft) return [];
    return (graphQuery.data?.edges ?? [])
      .filter((edge) => edge.source === draft.id)
      .map((edge) => ({
        edgeId: edge.id,
        targetNodeId: edge.target,
        targetTitle: graphQuery.data?.nodes.find((node) => node.id === edge.target)?.data.title ?? edge.target,
      }));
  }, [draft, graphQuery.data?.edges, graphQuery.data?.nodes]);

  const compiledPreviewText = compiledPreviewQuery.data ?? null;

  const mapIssueToField = (category: string): "question" | "nextStep" | "closingPath" | "generic" => {
    const normalized = category.toLowerCase();
    if (normalized.includes("prompt") || normalized.includes("question")) return "question";
    if (normalized.includes("transition") || normalized.includes("branch") || normalized.includes("edge")) return "nextStep";
    if (normalized.includes("safety")) return "generic";
    if (normalized.includes("start") || normalized.includes("completion") || normalized.includes("closing")) return "closingPath";
    return "generic";
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaveState("saving");
    try {
      const run = await validationMutation.mutateAsync();
      const nodeIssues = run.issues.filter((issue) => issue.nodeId === draft.id);
      const blocking = nodeIssues.filter((issue) => issue.severity === "critical");
      if (blocking.length > 0) {
        const nextErrors: Partial<Record<"question" | "nextStep" | "closingPath" | "generic", string>> = {};
        for (const issue of blocking) {
          const field = mapIssueToField(issue.category);
          if (field === "question") nextErrors.question = t("protocolEditor.errors.missingQuestion");
          else if (field === "nextStep") nextErrors.nextStep = t("protocolEditor.errors.missingNextStep");
          else if (field === "closingPath") nextErrors.closingPath = t("protocolEditor.errors.missingClosingPath");
          else nextErrors.generic = issue.category.toLowerCase().includes("safety") ? t("protocolEditor.errors.safetyStepLocked") : t("protocolEditor.errors.generic");
        }
        setFieldErrors(nextErrors);
        setSaveState("error");
        return;
      }
      setFieldErrors({});
      await saveNodeMutation.mutateAsync(draft);
      toast.success(t("protocolEditor.saveSuccess"));
    } catch {
      setSaveState("error");
      toast.error("Protocol validation failed");
    }
  };

  const handleDelete = () => {
    if (!draft) return;
    const isSafetyLocked = draft.data.safetyRuleIds.length > 0 || draft.type === "safety_check";
    if (isSafetyLocked) {
      setFieldErrors((current) => ({ ...current, generic: t("protocolEditor.errors.safetyStepLocked") }));
      return;
    }
    deleteNodeMutation.mutate(draft.id);
  };

  if (graphQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;

  return (
    <AppShell>
      <PageHeader
        className="protocol-builder-hero"
        title={t("protocolEditor.pageTitle")}
        description={t("protocolEditor.pageDescription")}
        meta={<Badge tone="neutral">{selectedSessionMeta?.title ?? selectedSessionId}</Badge>}
        actions={
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">{t("protocolEditor.session")}</div>
            <select
              className={inputClass}
              value={selectedSessionMeta?.id ?? selectedSessionId}
              onChange={(event) => router.push(`/projects/demo/protocols/tbct-br-001/canvas?sessionId=${event.target.value}${candidateId ? `&candidate=${candidateId}` : ""}${manualId ? `&asset=${manualId}` : ""}`)}
            >
              {sessionCatalog.map((session) => (
                <option key={session.id} value={session.id}>{session.number.toString().padStart(2, "0")} · {session.title}</option>
              ))}
            </select>
          </div>
        }
      />

      {/* canvasPanelProps/inspectorPanelProps are shared verbatim between the
          desktop 3-panel row below and the mobile Flow/Prompt tabs further
          down, so mobile can never drift from what desktop actually wires
          up -- only layout-only props (heightClassName/cardClassName/etc.,
          all optional with desktop-preserving defaults) differ per call site. */}
      {(() => {
        const canvasPanelProps = {
          flowNodes,
          edges: sessionFlowEdges,
          immutableSourceView,
          onNodesChange: (changes: NodeChange[]) => setFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as FlowNode[]),
          onNodeClick: (nodeId: string) => setSelectedStepId(nodeId),
          onNodeDragStart: (nodeId: string) => {
            setSaveState("saving");
            logProtocolAction("node drag start", { nodeId });
          },
          onNodeDragStop: (nodeId: string, position: { x: number; y: number }) => {
            if (immutableSourceView) return;
            const current = sessionFlowNodes.find((item) => item.id === nodeId)?.data.step;
            if (!current) return;
            logProtocolAction("node drag stop", { nodeId, title: current.data.title, from: current.position, to: position });
            void saveNodeMutation.mutate({ ...current, position });
          },
          onConnect: (connection: Connection) => {
            if (immutableSourceView) return;
            if (!connection.source || !connection.target) return;
            createEdgeMutation.mutate(connection);
          },
          onEdgeDoubleClick: (edgeId: string) => {
            if (!immutableSourceView) deleteEdgeMutation.mutate(edgeId);
          },
        };
        const inspectorPanelProps = {
          draft,
          onDraftChange: setDraft,
          immutableSourceView,
          sessionPrompts,
          selectedPromptItem,
          onSelectPromptItem: setSelectedPromptItemId,
          onRestoreVerbatim: (id: string) => { const next = restorePromptItemFromVerbatim(id); if (next) setSelectedPromptItemId(next.id); },
          onToggleStatus: (id: string) => { const next = togglePromptItemStatus(id); if (next) setSelectedPromptItemId(next.id); },
          onMovePromptItem: (id: string, direction: -1 | 1) => { const next = movePromptItem(id, direction); if (next) setSelectedPromptItemId(next.id); },
          onUpdatePromptItem: (id: string, patch: Partial<PromptItem>) => { updatePromptItem(id, patch); savePromptItems(sessionPrompts.map((item) => (item.id === id ? { ...item, ...patch } : item))); },
          sessionCommonRules,
          onSaveSessionCommonRules: (next: SessionCommonRules) => saveSessionCommonRules(selectedSessionMeta.id, next),
          nextStepOptions,
          compiledPreviewText,
          validationRun,
          fieldErrors,
          onSave: handleSave,
          onPreview: () => runtimeMutation.mutate(),
          saving: saveNodeMutation.isPending || validationMutation.isPending,
          previewing: runtimeMutation.isPending,
          onDuplicate: () => draft && duplicateNodeMutation.mutate(draft.id),
          onDelete: handleDelete,
          availableEvidence,
          selectedEvidenceId,
          onSelectedEvidenceIdChange: setSelectedEvidenceId,
          onAttachEvidence: () => attachEvidenceMutation.mutate(),
          attachingEvidence: attachEvidenceMutation.isPending,
          safetyRules: (safetyRulesQuery.data ?? []).map((rule) => ({ id: rule.id, title: rule.title })),
          onAttachSafetyRule: (ruleId: string) => draft && attachSafetyMutation.mutate({ nodeId: draft.id, ruleId }),
          focusSourceEvidence: shouldFocusSourceEvidence,
        };
        return (
          <>
            {/* Desktop/tablet (>=640px): unchanged 3-panel row, byte-identical
                to before this pass -- only hidden below 640px, where the
                mobile tabbed view below takes over. */}
            <div className="protocol-builder-grid hidden gap-3 p-4 sm:flex sm:flex-col xl:grid lg:p-4">
              <SessionPanel
                sessionTitle={selectedSessionMeta?.title ?? selectedSessionId}
                nodes={sessionFlowNodes}
                selectedStepId={selectedStepId}
                onSelect={setSelectedStepId}
                collapsed={sessionPanelCollapsed}
                onToggleCollapsed={() => setSessionPanelCollapsed((current) => !current)}
                reducedMotion={Boolean(reducedMotion)}
              />
              <CanvasPanel {...canvasPanelProps} />
              <InspectorPanel {...inspectorPanelProps} />
            </div>

            {/* Mobile (<640px): context bar + Steps/Flow/Prompt secondary nav
                (brief §4/§8) instead of one long stacked page. Same state,
                same mutations, same CanvasPanel/InspectorPanel components as
                above -- only the surrounding chrome differs. */}
            {/* Fixed viewport-relative heights below (not flex-fill) --
                React Flow measures its container once on mount for fitView,
                and a flex column whose height resolves after that first
                measurement leaves it fit to a near-zero size that never
                recovers. calc(100vh-...) is available synchronously on
                first paint, so it doesn't hit that race. The subtracted
                pixel count is the header + context bar + tabs actually
                measured at 390px width -- generous rather than exact, since
                slightly short is far safer here than a blank canvas. */}
            <div className="sm:hidden">
              <MobileContextBar sessionTitle={selectedSessionMeta?.title ?? selectedSessionId} stepTitle={selectedSessionNode?.data.step.data.title} />
              <MobileProtocolTabs active={mobileTab} onChange={setMobileTab} />
              {mobileTab === "steps" && (
                <div className="p-4">
                  <MobileStepList
                    nodes={sessionFlowNodes}
                    selectedStepId={selectedStepId}
                    onSelect={(stepId) => {
                      setSelectedStepId(stepId);
                      setMobileTab("prompt");
                    }}
                  />
                </div>
              )}
              {mobileTab === "flow" && (
                <CanvasPanel {...canvasPanelProps} className="mobile-flow-view rounded-none border-x-0" heightClassName="h-[calc(100vh-136px)]" />
              )}
              {mobileTab === "prompt" && (
                <div className="p-4">
                  {draft ? (
                    <InspectorPanel {...inspectorPanelProps} cardClassName="w-full max-w-none" bodyHeightClassName="max-h-[calc(100vh-260px)]" />
                  ) : (
                    <EmptyState title={t("protocolEditor.noStepSelected")} description={t("protocolEditor.mobile.selectStepHint")} />
                  )}
                </div>
              )}
            </div>
            <div className="sticky bottom-0 z-20 hidden items-center justify-between border-t border-border bg-surface/95 px-6 py-3 shadow-[0_-8px_28px_rgba(35,50,80,0.08)] backdrop-blur xl:flex">
              <SaveStatus state={saveState} />
              <div className="flex gap-3"><Button variant="secondary" loading={runtimeMutation.isPending} onClick={() => runtimeMutation.mutate()}>미리보기</Button><Button loading={saveNodeMutation.isPending || validationMutation.isPending} onClick={() => void handleSave()}>변경사항 저장</Button></div>
            </div>
          </>
        );
      })()}

      <Modal open={importPreviewOpen} onClose={() => setImportPreviewOpen(false)} title="Import Preview" description="Candidate conflicts must be resolved before final import." width="max-w-4xl">
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <div className="rounded-panel border border-border p-4">
            <div className="text-sm font-semibold text-text-primary">Candidate items</div>
            <div className="mt-3 space-y-2">
              {(previewQuery.data?.candidate.items as ProtocolDraftItem[] | undefined)?.map((item) => (
                <div key={item.id} className="rounded-panel border border-border p-3">
                  <div className="text-sm font-semibold text-text-primary">{item.title}</div>
                  <div className="mt-1 text-xs text-text-secondary">{item.proposedNodeType}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-panel border border-border p-4">
            <div className="text-sm font-semibold text-text-primary">Conflicts and warnings</div>
            <div className="mt-3 space-y-2">
              {(previewQuery.data?.warnings ?? []).map((warning) => (
                <div key={warning.id} className="rounded-panel border border-border p-3 text-sm text-text-primary">{warning.message}</div>
              ))}
              {!previewQuery.data?.warnings.length && <div className="text-sm text-text-secondary">No conflicts. The candidate can be imported directly into the graph.</div>}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={() => setImportPreviewOpen(false)}>Cancel</Button>
          <Button loading={importMutation.isPending} onClick={() => importMutation.mutate()}>Import candidate</Button>
        </div>
      </Modal>

    </AppShell>
  );
}
