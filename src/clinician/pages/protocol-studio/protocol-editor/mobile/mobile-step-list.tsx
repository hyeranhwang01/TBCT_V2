"use client";

import { Badge, EmptyState } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { getClinicianStepLabels, type FlowNode } from "../types";

// Same required/safety/conditional/repeated labels as the desktop
// SessionPanel (session-panel.tsx) -- reused via getClinicianStepLabels so
// nothing about what counts as "required"/"repeated" is redefined here.
const labelTone: Record<string, "primary" | "warning" | "neutral" | "critical"> = {
  required: "primary",
  safety: "critical",
  conditional: "neutral",
  repeated: "neutral",
};

function patientSafeSummary(value: string | undefined) {
  if (!value) return "";
  return value
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/\bAsk:\s*/gi, "")
    .replace(/\b(?:SITUATION|AUTOMATIC THOUGHT|EMOTION|BEHAVIOR) BOX\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function MobileStepList({ nodes, selectedStepId, onSelect }: { nodes: FlowNode[]; selectedStepId: string; onSelect: (stepId: string) => void }) {
  const { t } = useT();

  if (!nodes.length) return <EmptyState title={t("protocolEditor.mobile.noStepsYet")} />;

  return (
    <div className="grid content-start gap-3">
      {nodes.map((flowNode) => {
        const step = flowNode.data.step;
        const labels = getClinicianStepLabels(step);
        const promptCount = step.data.promptItemIds?.length ?? 0;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(step.id)}
            className={cn(
              "static m-0 block min-h-[44px] w-full self-start rounded-panel border p-4 text-left",
              selectedStepId === step.id ? "border-clinical-blue bg-clinical-blue-light" : "border-border bg-surface",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold text-text-primary">{step.data.title}</div>
              <span className="shrink-0 text-[11px] text-text-muted">{t("protocolEditor.questionsCount", { count: promptCount })}</span>
            </div>
            {labels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {labels.map((label) => (
                  <Badge key={label} tone={labelTone[label]}>{t(`stepLabel.${label}`)}</Badge>
                ))}
              </div>
            )}
            {patientSafeSummary(step.data.clinicalIntent) && (
              <div className="truncate-2 mt-3 text-sm leading-6 text-text-secondary">{patientSafeSummary(step.data.clinicalIntent)}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
