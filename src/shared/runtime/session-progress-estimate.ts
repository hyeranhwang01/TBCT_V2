import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeSessionStatus } from "@/types/runtime-session";

/** Estimates how far through the current session's prompt sequence a
 * patient is, as a 0-100 percentage for the progress bar in
 * patient-shell.tsx. This is deliberately an ESTIMATE, not an exact
 * fraction: a session's node graph isn't strictly linear (a conditional
 * alternate node reached only under one branch, a clinician_escalation
 * safety-pause node reached only on a crisis signal), so summing every
 * node's prompt items overcounts the denominator for any patient who
 * takes the shorter path -- completed+skipped would then never reach
 * that inflated total. Excludes clinician_escalation nodes from the
 * denominator (never on the normal patient path) and caps the displayed
 * percentage at 95 while the session is still active, only showing 100
 * once the session has actually completed -- so this never claims to be
 * "done" before it is, even though the raw fraction is approximate. */
export function computeSessionProgressPercent(input: {
  sessionDefinitionId: string;
  nodes: ClinicalStageNode[];
  promptItems: PromptItem[];
  completedPromptItemIds: string[];
  skippedPromptItemIds: string[];
  sessionStatus: RuntimeSessionStatus;
}): number | undefined {
  if (input.sessionStatus === "completed" || input.sessionStatus === "terminated") return 100;

  const relevantNodeIds = new Set(
    input.nodes.filter((node) => node.sessionId === input.sessionDefinitionId && node.type !== "clinician_escalation").map((node) => node.id),
  );
  const totalItems = input.promptItems.filter((item) => item.sessionId === input.sessionDefinitionId && relevantNodeIds.has(item.nodeId));
  if (totalItems.length === 0) return undefined;

  const doneIds = new Set([...input.completedPromptItemIds, ...input.skippedPromptItemIds]);
  const doneCount = totalItems.filter((item) => doneIds.has(item.id)).length;
  const rawPercent = Math.round((doneCount / totalItems.length) * 100);
  return Math.min(rawPercent, 95);
}
