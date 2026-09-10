"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { Card, SectionHeader } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { nodeTone, summarizeCondition, type FlowNode } from "./types";

function ProtocolNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { t } = useT();
  const step = data.step;
  const isStart = step.type === "session_start";
  const isComplete = step.type === "session_complete";
  const rawCondition = (step.data.runtimeAction?.payload as Record<string, unknown> | undefined)?.activationCondition;
  const conditionSummary = summarizeCondition(rawCondition as { kind?: string; field?: string; operator?: string; value?: unknown } | null | undefined);
  const promptCount = step.data.promptItemIds?.length ?? 0;

  return (
    <div className={cn("relative w-[280px] max-w-[280px] rounded-panel border bg-surface px-4 py-3", nodeTone(step.data.status), selected && "ring-2 ring-clinical-blue-light")}>
      <Handle type="target" position={Position.Top} className="!h-4 !w-4 !border-2 !border-white !bg-clinical-blue !shadow-md" style={{ top: -8 }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {isStart && <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-success">Start</span>}
            {isComplete && <span className="rounded-full bg-clinical-blue-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-clinical-blue">Complete</span>}
          </div>
          <div className="mt-2 text-sm font-semibold text-text-primary">{step.data.title}</div>
          <div className="mt-1 truncate-2 text-xs leading-5 text-text-secondary">{step.data.clinicalIntent}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1 text-[11px] text-text-secondary">
        <span>{t("protocolEditor.questionsCount", { count: promptCount })}</span>
        {step.data.safetyRuleIds.length > 0 ? (
          <span className="font-semibold text-critical">{t("protocolEditor.requiredSafetyStep")}</span>
        ) : conditionSummary ? (
          <span>{t("protocolEditor.shownWhen", { condition: conditionSummary })}</span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-4 !w-4 !border-2 !border-white !bg-ai-violet !shadow-md" style={{ bottom: -8 }} />
    </div>
  );
}

export const protocolNodeTypes = { protocolNode: ProtocolNodeView };

interface CanvasPanelProps {
  flowNodes: FlowNode[];
  edges: Edge[];
  immutableSourceView: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeClick: (nodeId: string) => void;
  onNodeDragStart: (nodeId: string) => void;
  onNodeDragStop: (nodeId: string, position: { x: number; y: number }) => void;
  onConnect: (connection: Connection) => void;
  onEdgeDoubleClick: (edgeId: string) => void;
  /** Overrides the canvas viewport's height classes. Defaults to the
   * original desktop-tuned value below, so every existing (desktop/tablet)
   * call site that omits this prop renders exactly as before -- only the
   * mobile "Flow" tab passes a full-viewport override. */
  heightClassName?: string;
  /** Extra class on the outer Card, used by the mobile "Flow" tab to scope
   * touch-target CSS (see globals.css's .mobile-flow-view rule) without any
   * selector that could ever match the desktop tree. */
  className?: string;
}

export function CanvasPanel({ flowNodes, edges, immutableSourceView, onNodesChange, onNodeClick, onNodeDragStart, onNodeDragStop, onConnect, onEdgeDoubleClick, heightClassName, className }: CanvasPanelProps) {
  const { t } = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewportWidth(Math.round(viewport.getBoundingClientRect().width)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const centeredX = Math.max(20, Math.round((viewportWidth - 280) / 2));
  const displayNodes = useMemo(
    () => flowNodes.map((node) => ({ ...node, position: { ...node.position, x: centeredX } })),
    [centeredX, flowNodes],
  );

  const handleNodesChange = (changes: NodeChange[]) => {
    onNodesChange(changes.map((change) => (
      change.type === "position" && change.position
        ? { ...change, position: { ...change.position, x: centeredX } }
        : change
    )));
  };

  return (
    <Card className={cn("protocol-builder-panel min-w-0 max-w-full flex-1 overflow-hidden", className)}>
      <SectionHeader title="플로우 캔버스" />
      <div ref={viewportRef} className={cn("relative w-full overflow-hidden dot-grid", heightClassName ?? "h-[calc(100vh-272px)] min-h-[520px]")}>
        <ReactFlowProvider>
          <div className="absolute inset-0 h-full w-full">
            <ReactFlow
              className="h-full w-full"
              style={{ height: "100%", width: "100%" }}
              nodes={displayNodes}
              edges={edges}
              nodeTypes={protocolNodeTypes}
              nodesDraggable={!immutableSourceView}
              nodesConnectable={!immutableSourceView}
              // A prior fix (5832c42, "stop protocol editor layout and
              // canvas jitter") disabled panning/zooming outright, right
              // after the previous commit forced every node onto one
              // centered column reaching up to y=10000 (translateExtent
              // below) -- the jitter was very likely left-click canvas-pan
              // fighting with left-click node-drag on that single crowded
              // column, but the fix also removed the only way to reach
              // nodes below the first screenful ("map doesn't move even
              // when I drag it", confirmed live). Restored navigation via
              // gestures that can't collide with node-dragging: middle/
              // right-click drag to pan (panOnDrag as a button list, not a
              // bare boolean, leaves plain left-click drag exclusively for
              // repositioning a node), mouse-wheel scroll to pan, and pinch
              // to zoom. zoomOnDoubleClick stays off -- it would collide
              // with onEdgeDoubleClick below. autoPanOnNodeDrag/
              // autoPanOnConnect stay off too -- unrelated to this bug and
              // not implicated in the original jitter report either.
              panOnDrag={[1, 2]}
              panOnScroll
              zoomOnScroll={false}
              zoomOnPinch
              zoomOnDoubleClick={false}
              preventScrolling={false}
              autoPanOnNodeDrag={false}
              autoPanOnConnect={false}
              onNodesChange={handleNodesChange}
              onNodeClick={(_, node) => onNodeClick(node.id)}
              onNodeDragStart={(_, node) => onNodeDragStart(node.id)}
              onNodeDragStop={(_, node) => onNodeDragStop(node.id, node.position)}
              onConnect={(connection: Connection) => onConnect(connection)}
              onEdgeDoubleClick={(_, edge) => onEdgeDoubleClick(edge.id)}
              defaultViewport={{ x: 0, y: 12, zoom: 1 }}
              minZoom={0.55}
              maxZoom={1.25}
              translateExtent={[[-40, -80], [Math.max(viewportWidth + 40, 360), 10000]]}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
              <MiniMap className="!bg-surface" pannable zoomable />
              <Controls position="bottom-left" />
            </ReactFlow>
          </div>
        </ReactFlowProvider>
      </div>
    </Card>
  );
}
