"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, PageHeader, PageSkeleton, SectionHeader, ValidationSeverityBadge } from "@/components/ui/primitives";
import { getProtocolGraphApi, runProtocolValidation } from "@/lib/api/protocol-api";

export function ValidationPage() {
  const searchParams = useSearchParams();
  const selectedIssueId = searchParams.get("issue");
  const graphQuery = useQuery({ queryKey: ["protocol-graph-validation"], queryFn: () => getProtocolGraphApi(), staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true });
  const validationMutation = useMutation({ mutationFn: () => runProtocolValidation() });
  const data = validationMutation.data ?? graphQuery.data?.validationRun;
  const nodes = graphQuery.data?.nodes ?? [];
  const edges = graphQuery.data?.edges ?? [];
  const linkedEvidenceCount = new Set(nodes.flatMap((node) => node.data.sourceEvidenceIds)).size;
  const hasStartNode = nodes.some((node) => node.type === "session_start");
  const hasCompleteNode = nodes.some((node) => node.type === "session_complete");
  const requiredNodes = nodes.filter((node) => node.data.required);
  const evidenceLinkedNodes = requiredNodes.length
    ? requiredNodes.filter((node) => node.data.sourceEvidenceIds.length > 0)
    : nodes.filter((node) => node.data.sourceEvidenceIds.length > 0);
  const sourceEvidenceSatisfied = evidenceLinkedNodes.length;
  const runtimeActionSatisfied = nodes.filter((node) => node.data.runtimeAction).length;
  const conditionalEdges = edges.filter((edge) => edge.edgeType === "conditional");
  const branchLabelSatisfied = conditionalEdges.length === 0 || conditionalEdges.every((edge) => Boolean(edge.label));
  const totalChecks = 5;
  const satisfiedChecks = Number(hasStartNode) + Number(hasCompleteNode) + Number(sourceEvidenceSatisfied > 0) + Number(runtimeActionSatisfied > 0) + Number(branchLabelSatisfied);
  const validationTodos = [
    { label: "Start node exists", done: hasStartNode },
    { label: "Complete node exists", done: hasCompleteNode },
    { label: "Source evidence linked", done: sourceEvidenceSatisfied > 0 },
    { label: "Runtime action set", done: runtimeActionSatisfied > 0 },
    { label: "Conditional branch labels filled", done: branchLabelSatisfied },
  ];

  if (graphQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (!data) {
    return (
      <AppShell>
        <Card className="m-4 lg:m-6">
          <EmptyState title="No validation run" description="Run protocol validation first to populate the center." />
        </Card>
      </AppShell>
    );
  }

  const selected = data.issues.find((item) => item.id === selectedIssueId) ?? data.issues[0];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Protocol Health"
        title="Validation Center"
        description="릴리스 전에 무엇이 끝났고, 지금 무엇을 해야 하는지 보여줍니다."
        meta={<><Badge tone="critical">{data.summary.critical} critical</Badge><Badge tone="warning">{data.summary.warning} warnings</Badge><Badge tone="success">{data.summary.passedChecks} passed</Badge></>}
        actions={<Button variant="secondary" loading={validationMutation.isPending} onClick={() => validationMutation.mutate()}>Run validation</Button>}
      />
      <div className="space-y-4 p-4 lg:p-6">
        <Card className="overflow-hidden">
          <SectionHeader title="남은 일(TODO)" description="릴리스 전에 아직 확인해야 하는 항목들입니다." />
          <div className="border-t border-border bg-surface-subtle px-4 py-3 text-sm text-text-secondary">
            지금은 {satisfiedChecks}/{totalChecks}개가 끝났습니다. 체크 표시가 있으면 이미 됐다는 뜻이고, TODO는 지금 해야 할 일입니다.
          </div>
          <div className="space-y-2 p-4">
            {validationTodos.map((todo) => (
              <div key={todo.label} className={`flex items-start gap-3 rounded-panel border p-3 text-sm ${todo.done ? "border-success/30 bg-success/10 text-text-secondary" : "border-warning/30 bg-warning/10 text-text-primary"}`}>
                <div className={`mt-0.5 h-4 w-4 rounded-full border text-center text-[10px] leading-3 ${todo.done ? "border-success bg-success text-white" : "border-warning bg-warning text-white"}`}>
                  {todo.done ? "✓" : "TODO"}
                </div>
                <div>
                  <div className="font-medium">{todo.label}</div>
                  <div className="text-xs text-text-secondary">
                    {todo.done ? "이미 충족됨" : todo.label === "Source evidence linked" ? "이 노드에 근거 자료를 연결하세요." : todo.label === "Start node exists" ? "시작 노드를 하나 두세요." : todo.label === "Complete node exists" ? "끝 노드를 하나 두세요." : todo.label === "Runtime action set" ? "이 노드가 실행할 행동을 넣으세요." : "조건 분기라면 라벨을 채우세요."}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <SectionHeader title="완료된 것" description="이미 끝난 항목을 한눈에 보여줍니다." />
          <div className="grid gap-3 border-t border-border p-4 md:grid-cols-5">
            <div className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Start node</div>
              <div className="mt-1 font-semibold text-text-primary">{hasStartNode ? "1/1" : "0/1"}</div>
            </div>
            <div className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Complete node</div>
              <div className="mt-1 font-semibold text-text-primary">{hasCompleteNode ? "1/1" : "0/1"}</div>
            </div>
            <div className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Source evidence</div>
              <div className="mt-1 font-semibold text-text-primary">{sourceEvidenceSatisfied}개 노드 연결됨</div>
              <div className="mt-1 text-xs text-text-secondary">대상 노드 {requiredNodes.length || nodes.length || 1}개 중</div>
              <div className="mt-1 text-[11px] text-text-muted">고유 evidence ID {linkedEvidenceCount}개</div>
            </div>
            <div className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Runtime action</div>
              <div className="mt-1 font-semibold text-text-primary">{runtimeActionSatisfied}개 설정됨</div>
              <div className="mt-1 text-xs text-text-secondary">전체 노드 {nodes.length || 1}개 중</div>
            </div>
            <div className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.14em] text-text-secondary">Branch labels</div>
              <div className="mt-1 font-semibold text-text-primary">{branchLabelSatisfied ? `${conditionalEdges.length || 1}개 완료` : `0/${conditionalEdges.length || 1}개`}</div>
            </div>
          </div>
          <div className="border-t border-warning/20 bg-warning/10 px-4 py-4 text-sm text-text-primary">
            지금까지 끝난 검사는 {satisfiedChecks}/{totalChecks}개입니다. 아래 카드에서 하나씩 확인할 수 있습니다.
          </div>
        </Card>

        <Card className="overflow-hidden">
          <SectionHeader title="근거 연결 상태" description="어떤 노드가 이미 연결됐고, 어떤 노드가 아직 비었는지 보여줍니다." />
          <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
            <div className="rounded-panel border border-success/20 bg-success/10 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">연결된 노드</div>
              <div className="mt-2 space-y-2 text-sm text-text-primary">
                {evidenceLinkedNodes.length ? evidenceLinkedNodes.map((node) => (
                  <div key={node.id} className="rounded-panel border border-success/20 bg-surface p-2">
                    <div className="font-medium">{node.data.title}</div>
                    <div className="text-xs text-text-secondary">{node.data.sourceEvidenceIds.length}개 evidence 연결됨</div>
                  </div>
                )) : <div className="text-text-secondary">연결된 노드가 없습니다.</div>}
              </div>
            </div>
            <div className="rounded-panel border border-warning/20 bg-warning/10 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">아직 비어 있는 노드</div>
              <div className="mt-2 space-y-2 text-sm text-text-primary">
                {(requiredNodes.length ? requiredNodes : nodes).filter((node) => !node.data.sourceEvidenceIds.length).map((node) => (
                  <Link key={node.id} href={`/projects/demo/protocols/tbct-br-001/canvas?issue=&node=${node.id}&focus=source-evidence`} className="block rounded-panel border border-warning/20 bg-surface p-2 hover:bg-surface-subtle">
                    <div className="font-medium">{node.data.title}</div>
                    <div className="text-xs text-text-secondary">근거를 추가해야 하는 노드</div>
                  </Link>
                ))}
                {!(requiredNodes.length ? requiredNodes : nodes).some((node) => !node.data.sourceEvidenceIds.length) && <div className="text-text-secondary">비어 있는 노드가 없습니다.</div>}
              </div>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <SectionHeader title="검사 설명" description="각 항목이 무슨 뜻인지 쉽게 적었습니다." />
          <div className="border-t border-warning/20 bg-warning/10 px-4 py-4 text-sm text-text-primary">
            중요 항목이 먼저입니다. Critical이 있으면 릴리스가 막히고, Warning은 참고 사항입니다.
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <div className="rounded-panel border border-critical/20 bg-critical/10 p-3 text-sm text-text-secondary">
              <div className="font-semibold text-text-primary">Critical</div>
              <div className="mt-1">이건 꼭 고쳐야 합니다. 예: 시작 노드가 없거나, 근거 자료가 빠졌을 때입니다.</div>
            </div>
            <div className="rounded-panel border border-warning/20 bg-warning/10 p-3 text-sm text-text-secondary">
              <div className="font-semibold text-text-primary">Warning</div>
              <div className="mt-1">릴리스는 되지만 한 번 더 보는 것이 좋습니다. 예: 행동 설명이 부족한 경우입니다.</div>
            </div>
            <div className="rounded-panel border border-success/20 bg-success/10 p-3 text-sm text-text-secondary">
              <div className="font-semibold text-text-primary">Passed</div>
              <div className="mt-1">문제없이 통과한 항목입니다. 숫자가 높을수록 더 많이 준비된 상태입니다.</div>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
          <Card className="overflow-hidden">
            <SectionHeader title="문제 목록" description="지금 남아 있는 문제들을 보여줍니다." />
            <div className="divide-y divide-border">
              {data.issues.map((issue) => (
                <div key={issue.id} className="px-4 py-4 hover:bg-surface-subtle">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <ValidationSeverityBadge severity={issue.severity === "information" ? "info" : issue.severity} />
                        <Badge tone="neutral">{issue.category}</Badge>
                        {issue.sessionId && <Badge tone="primary">{issue.sessionId}</Badge>}
                        {issue.nodeId && <Badge tone="violet">{issue.nodeId}</Badge>}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-text-primary">{issue.message}</div>
                      <div className="mt-1 text-xs text-text-secondary">{issue.suggestedAction ?? "이 문제와 연결된 노드나 선을 고치고 다시 검증하세요."}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/projects/demo/protocols/tbct-br-001/canvas?issue=${issue.id}&node=${issue.nodeId ?? ""}&focus=${issue.category === "Source Traceability" ? "source-evidence" : "node"}`}>
                        <Button size="sm" variant="secondary">Open in canvas</Button>
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
              {!data.issues.length && <EmptyState title="No issues" description="Current protocol validation is clean." />}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <SectionHeader title="선택한 문제" description="이 문제를 어떻게 고칠지 보여줍니다." />
            <div className="space-y-4 p-4">
              {selected ? (
                <>
                  <ValidationSeverityBadge severity={selected.severity === "information" ? "info" : selected.severity} />
                  <div className="text-sm font-semibold text-text-primary">{selected.message}</div>
                  <div className="rounded-panel border border-border bg-surface-subtle p-3 text-xs text-text-secondary">{selected.category}</div>
                  <div className="rounded-panel border border-border p-3">
                    <div className="text-xs font-semibold text-text-primary">지금 할 일</div>
                    <div className="mt-2 text-xs text-text-secondary">{selected.suggestedAction ?? "이 문제와 연결된 노드나 선을 수정한 뒤 다시 검증하세요."}</div>
                  </div>
                  <Link href={`/projects/demo/protocols/tbct-br-001/canvas?issue=${selected.id}&node=${selected.nodeId ?? ""}&focus=${selected.category === "Source Traceability" ? "source-evidence" : "node"}`}>
                    <Button variant="secondary">Jump to Protocol Editor</Button>
                  </Link>
                </>
              ) : (
                <EmptyState title="No selected issue" description="Choose an issue from the list." />
              )}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
