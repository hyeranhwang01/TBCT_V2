"use client";

import { Badge, Card, EmptyState, SectionHeader } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import type { RuntimeMessage, RuntimeSessionView, SessionExecutionLog } from "@/types/runtime-session";

type StepStatus = "completed" | "current" | "notStarted";

const STEP_TONE: Record<StepStatus, string> = {
  completed: "border-success bg-success-light/50",
  current: "border-clinical-blue bg-clinical-blue-light/60",
  notStarted: "border-border bg-surface-subtle",
};

const STEP_BADGE_TONE: Record<StepStatus, "success" | "primary" | "neutral"> = {
  completed: "success",
  current: "primary",
  notStarted: "neutral",
};

// Consecutive messages that share a nodeId are one "turn" -- the same node can
// be revisited (e.g. a clarification loop), so this is a run-length grouping
// over chronological order, not a group per unique node.
type TurnGroup = { nodeId?: string; nodeTitle: string; messages: RuntimeMessage[] };

function groupMessagesByNode(messages: RuntimeMessage[], nodeTitleFor: (nodeId?: string) => string): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    if (last && last.nodeId === message.nodeId) last.messages.push(message);
    else groups.push({ nodeId: message.nodeId, nodeTitle: nodeTitleFor(message.nodeId), messages: [message] });
  }
  return groups;
}

/** Protocol path + linked conversation/execution-log + safety/provider/
 * validation + memory sections -- the actual "Runtime Inspector" content,
 * pulled out of runtime-inspector-page.tsx (its standalone `/runtime/
 * sessions/:id` route) so patient-detail-page.tsx's own "인스펙터" tab can
 * render the exact same view inline, fed from the session data it already
 * has on hand (getRuntimeSession is the heaviest single query in the app --
 * this deliberately takes the already-fetched RuntimeSessionView as a prop
 * instead of fetching it again). */
export function RuntimeInspectorView({ view }: { view: RuntimeSessionView }) {
  const { t } = useT();
  const { session, messages, logs, escalations, providerEvents, validationEvents, nodes, edges, memoryRetrievalRuns, memoryUsageLogs } = view;
  const STEP_LABEL: Record<StepStatus, string> = {
    completed: t("runtimeInspector.step.completed"),
    current: t("runtimeInspector.step.current"),
    notStarted: t("runtimeInspector.step.notStarted"),
  };
  const ROLE_LABEL: Record<string, string> = {
    assistant: t("runtimeInspector.role.program"),
    patient: t("runtimeInspector.role.you"),
    clinician: t("runtimeInspector.role.clinician"),
    system: t("runtimeInspector.role.system"),
  };

  // The release can hold nodes for every session in the program -- only this
  // session's steps belong on the progress path.
  const sessionNodes = nodes.filter((node) => node.sessionId === session.sessionDefinitionId);
  const currentIndex = sessionNodes.findIndex((node) => node.id === session.currentNodeId);
  const stepStatus = (index: number): StepStatus => {
    if (session.status === "completed") return "completed";
    if (currentIndex === -1) return "notStarted";
    if (index < currentIndex) return "completed";
    if (index === currentIndex) return "current";
    return "notStarted";
  };
  const nodeTitleFor = (nodeId?: string) => sessionNodes.find((node) => node.id === nodeId)?.title ?? "Unassigned step";

  const sessionLevelLogs = logs.filter((log) => log.stage === "session");
  const logsForNode = (nodeId?: string): SessionExecutionLog[] => logs.filter((log) => log.stage !== "session" && log.nodeId === nodeId);
  const turnGroups = groupMessagesByNode(messages, nodeTitleFor);

  // Session-level lifecycle logs (pause/resume/completion) aren't tied to a
  // step, so they don't belong in the Conversation/Execution-Log pairing --
  // but dropping them into a separate, timeless box loses when they happened.
  // Interleave them into the same timeline instead, at their real
  // chronological position, styled as a thin divider rather than a card.
  type TimelineRow = { kind: "turn"; at: string; group: TurnGroup } | { kind: "sessionEvent"; at: string; log: SessionExecutionLog };
  const timelineRows: TimelineRow[] = [
    ...turnGroups.map((group): TimelineRow => ({ kind: "turn", at: group.messages[0].createdAt, group })),
    ...sessionLevelLogs.map((log): TimelineRow => ({ kind: "sessionEvent", at: log.timestamp, log })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SectionHeader title={t("runtimeInspector.protocolPath.title")} description={t("runtimeInspector.protocolPath.description")} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sessionNodes.map((node, index) => {
            const status = stepStatus(index);
            const visitCount = messages.filter((message) => message.nodeId === node.id && message.role === "patient").length;
            return (
              <div key={node.id} className={`rounded-panel border p-3 ${STEP_TONE[status]}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-text-primary">{node.title}</div>
                  <Badge tone={STEP_BADGE_TONE[status]}>{STEP_LABEL[status]}</Badge>
                </div>
                <div className="mt-1 text-xs text-text-secondary">{node.type}</div>
                <div className="mt-2 text-[11px] text-text-muted">{visitCount > 0 ? t("runtimeInspector.step.respondedCount", { count: visitCount }) : t("runtimeInspector.step.noResponse")}</div>
                <div className="mt-2 text-[11px] text-text-muted">
                  {t("runtimeInspector.step.next")}: {edges.filter((edge) => edge.source === node.id).map((edge) => edge.target).join(", ") || "end"}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <SectionHeader title={t("runtimeInspector.conversationLog.title")} description={t("runtimeInspector.conversationLog.description")} />
        <div className="divide-y divide-border">
          {timelineRows.map((row, rowIndex) => {
            if (row.kind === "sessionEvent") {
              // Not a step-scoped card -- a thin, differently-colored divider
              // dropped into the same timeline at its real point in time, so
              // when it happened relative to the conversation stays clear.
              return (
                <div key={row.log.id} className="flex items-center gap-3 bg-warning-light/20 px-4 py-2">
                  <div className="h-px flex-1 bg-warning" />
                  <div className="whitespace-nowrap text-[11px] font-semibold text-text-secondary">{row.log.summary}</div>
                  <div className="whitespace-nowrap text-[10px] text-text-muted">{new Date(row.log.timestamp).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} KST</div>
                  <div className="h-px flex-1 bg-warning" />
                </div>
              );
            }
            const group = row.group;
            const groupLogs = logsForNode(group.nodeId);
            const hasBoth = group.messages.length > 0 && groupLogs.length > 0;
            return (
              <div key={`${group.nodeId ?? "unassigned"}-${rowIndex}`} className="grid grid-cols-[1fr_24px_1fr] gap-0">
                <div className="space-y-2 bg-surface-subtle/40 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">{group.nodeTitle}</div>
                  {group.messages.map((message) => (
                    <div key={message.id} className={`max-w-[95%] rounded-panel border px-3 py-2 ${message.role === "patient" ? "ml-auto border-clinical-blue-light bg-clinical-blue-light/60" : message.role === "system" ? "border-warning-light bg-warning-light/60" : message.role === "clinician" ? "border-success bg-success-light/50" : "border-border bg-surface"}`}>
                      <div className="text-[11px] font-semibold text-text-muted">{ROLE_LABEL[message.role] ?? message.role}</div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">{message.content}</div>
                      <div className="mt-1 text-[10px] text-text-muted">{new Date(message.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} KST</div>
                    </div>
                  ))}
                </div>
                <div className="relative flex justify-center bg-surface">
                  {hasBoth && <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-clinical-blue/40" />}
                  {hasBoth && <div className="relative top-6 h-2 w-2 rounded-full bg-clinical-blue" />}
                </div>
                <div className="space-y-2 p-4">
                  {groupLogs.length ? groupLogs.map((log) => (
                    <div key={log.id} className="rounded-panel border border-border p-3">
                      <div className="text-xs font-semibold text-text-muted">{log.stage} · {log.status}</div>
                      <div className="mt-1 text-sm text-text-primary">{log.summary}</div>
                    </div>
                  )) : (
                    <div className="text-xs text-text-secondary">{t("runtimeInspector.conversationLog.noLog")}</div>
                  )}
                </div>
              </div>
            );
          })}
          {!timelineRows.length && <EmptyState title={t("runtimeInspector.conversationLog.noConversation")} />}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
        <Card className="p-4">
          <SectionHeader title={t("runtimeInspector.safety.title")} description={t("runtimeInspector.safety.description")} />
          <div className="mt-4 space-y-2">
            {escalations.length ? escalations.map((item) => <Metric key={item.id} label={item.severity} value={item.triggerSummary} />) : <div className="text-xs text-text-secondary">{t("runtimeInspector.safety.none")}</div>}
          </div>
        </Card>
        <Card className="p-4">
          <SectionHeader title={t("runtimeInspector.provider.title")} description={t("runtimeInspector.provider.description")} />
          <div className="mt-4 space-y-2">
            {providerEvents.length ? providerEvents.map((event) => <Metric key={event.id} label={event.provider} value={`${event.model} · ${event.latencyMs ?? 0}ms`} />) : <div className="text-xs text-text-secondary">{t("runtimeInspector.provider.none")}</div>}
          </div>
        </Card>
        <Card className="p-4">
          <SectionHeader title={t("runtimeInspector.outputValidation.title")} description={t("runtimeInspector.outputValidation.description")} />
          <div className="mt-4 space-y-2">
            {validationEvents.length ? validationEvents.map((event) => <Metric key={event.id} label={event.accepted ? t("runtimeInspector.outputValidation.accepted") : t("runtimeInspector.outputValidation.fallback")} value={event.issues.join(", ") || t("runtimeInspector.outputValidation.clean")} />) : <div className="text-xs text-text-secondary">{t("runtimeInspector.outputValidation.none")}</div>}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="p-4">
          <SectionHeader title={t("runtimeInspector.memory.title")} description={t("runtimeInspector.memory.description")} />
          <div className="mt-4 space-y-3">
            {(memoryRetrievalRuns ?? []).map((run) => (
              <div key={run.id} className="rounded-panel border border-border p-3">
                <div className="text-xs font-semibold text-text-muted">{t("runtimeInspector.memory.run", { id: run.id })}</div>
                <div className="mt-1 text-sm text-text-primary">{t("runtimeInspector.memory.selected", { selected: run.selectedMemoryIds.length, evaluated: run.candidatesEvaluated })}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {run.selectedMemoryIds.map((memoryId) => <Badge key={memoryId} tone="primary">{memoryId}</Badge>)}
                </div>
                <div className="mt-2 text-xs text-text-secondary">{run.excluded.slice(0, 3).map((item) => `${item.memoryId}: ${item.reason}`).join(" · ") || t("runtimeInspector.memory.noExclusions")}</div>
              </div>
            ))}
            {!memoryRetrievalRuns?.length && <div className="text-xs text-text-secondary">{t("runtimeInspector.memory.none")}</div>}
          </div>
        </Card>
        <Card className="p-4">
          <SectionHeader title={t("runtimeInspector.memoryUsage.title")} description={t("runtimeInspector.memoryUsage.description")} />
          <div className="mt-4 space-y-2">
            {(memoryUsageLogs ?? []).map((item) => (
              <div key={item.id} className="rounded-panel border border-border p-3">
                <div className="text-xs font-semibold text-text-muted">{item.usageType}</div>
                <div className="mt-1 text-sm text-text-primary">{item.reason}</div>
              </div>
            ))}
            {!memoryUsageLogs?.length && <div className="text-xs text-text-secondary">{t("runtimeInspector.memoryUsage.none")}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel border border-border bg-surface-subtle p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}
