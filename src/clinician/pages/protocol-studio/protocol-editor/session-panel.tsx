"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Card, SectionHeader } from "@/components/ui/primitives";
import { fadeUp } from "@/lib/motion/motion-variants";
import { motionDuration, motionEase } from "@/lib/motion/motion-tokens";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { getClinicianStepLabels, type FlowNode } from "./types";

interface SessionPanelProps {
  sessionTitle: string;
  nodes: FlowNode[];
  selectedStepId: string;
  onSelect: (stepId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  reducedMotion: boolean;
}

const labelTone: Record<string, "primary" | "warning" | "neutral" | "critical"> = {
  required: "primary",
  safety: "critical",
  conditional: "neutral",
  repeated: "neutral",
};

export function SessionPanel({ sessionTitle: _sessionTitle, nodes, selectedStepId, onSelect, collapsed, onToggleCollapsed, reducedMotion }: SessionPanelProps) {
  const { t } = useT();

  if (collapsed) {
    return (
      <Card className="flex w-[56px] shrink-0 flex-col items-center overflow-hidden py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t("protocolEditor.expandPanel")}
          className="rounded-panel border border-border p-2 text-text-secondary hover:bg-surface-subtle"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </Card>
    );
  }

  return (
    <Card className="protocol-builder-panel min-w-0 shrink-0 overflow-hidden">
      <SectionHeader
        title="세션 단계"
        action={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{nodes.length} 단계</Badge>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={t("protocolEditor.collapsePanel")}
              className="rounded-panel border border-border p-1.5 text-text-secondary hover:bg-surface-subtle"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        }
      />
      <div className="max-h-[calc(100vh-272px)] space-y-2 overflow-auto p-2.5">
        {nodes.map((flowNode, index) => {
          const step = flowNode.data.step;
          const labels = getClinicianStepLabels(step);
          return (
            <motion.button
              key={step.id}
              variants={reducedMotion ? undefined : fadeUp}
              initial={reducedMotion ? false : "initial"}
              animate={reducedMotion ? undefined : "animate"}
              whileHover={reducedMotion || selectedStepId === step.id ? undefined : { y: -1 }}
              whileTap={reducedMotion ? undefined : { scale: 0.998 }}
              transition={{ duration: motionDuration.instant, ease: motionEase.ui }}
              onClick={() => onSelect(step.id)}
              className={cn(
                "transition-ui w-full rounded-[12px] border p-3 text-left",
                selectedStepId === step.id
                  ? "border-clinical-blue bg-clinical-blue-light"
                  : "border-border hover:border-border-strong hover:bg-surface-subtle hover:shadow-sm",
              )}
            >
              <div className="flex items-start gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${selectedStepId === step.id ? "bg-ai-violet-light text-ai-violet" : "bg-surface-subtle text-text-secondary"}`}>{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><div className="text-sm font-semibold text-text-primary">{step.data.title}</div>
              {labels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {labels.map((label) => (
                    <Badge key={label} tone={labelTone[label]}>{t(`stepLabel.${label}`)}</Badge>
                  ))}
                </div>
              )}
              <div className="mt-2 truncate-2 text-xs leading-5 text-text-secondary">{cleanClinicalSummary(step.data.clinicalIntent)}</div></div></div>
            </motion.button>
          );
        })}
      </div>
    </Card>
  );
}

function cleanClinicalSummary(value: string | undefined) {
  return (value ?? "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/\bAsk:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
