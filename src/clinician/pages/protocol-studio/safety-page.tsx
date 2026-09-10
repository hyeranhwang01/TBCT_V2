"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, Field, PageHeader, PageSkeleton, SectionHeader, SourceReferenceChip, StatusBadge, textareaClass } from "@/components/ui/primitives";
import { getSafetyRuleUsage, getSafetyRulesApi } from "@/lib/api/protocol-api";

export function SafetyPage() {
  const searchParams = useSearchParams();
  const ruleId = searchParams.get("rule");
  const nodeId = searchParams.get("node");
  const rulesQuery = useQuery({ queryKey: ["safety-rules-linked"], queryFn: () => getSafetyRulesApi({ active: true }) });
  const selected = rulesQuery.data?.find((rule) => rule.id === ruleId) ?? rulesQuery.data?.[0];
  const usageQuery = useQuery({
    queryKey: ["safety-rule-usage", selected?.id],
    queryFn: () => getSafetyRuleUsage(selected!.id),
    enabled: Boolean(selected?.id),
  });

  if (rulesQuery.isLoading || !selected) return <AppShell><PageSkeleton /></AppShell>;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Policy Management"
        title="Safety Rules"
        description="Active safety rules are linked back to protocol nodes and can be opened directly from the editor."
        meta={<><Badge tone="critical">High severity supported</Badge><Badge tone="success">{usageQuery.data?.length ?? 0} linked nodes</Badge>{nodeId && <Badge tone="warning">Opened from {nodeId}</Badge>}</>}
      />
      <div className="p-4 lg:p-6">
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <SectionHeader title="Rule List" description="Local active safety rules." />
            <div className="space-y-2 p-3">
              {(rulesQuery.data ?? []).map((rule) => (
                <Link key={rule.id} href={`/projects/demo/safety?rule=${rule.id}`}>
                  <div className={`rounded-panel border p-3 ${selected.id === rule.id ? "border-clinical-blue bg-clinical-blue-light" : "border-border"}`}>
                    <div className="flex flex-wrap gap-2"><Badge tone="primary">{rule.id}</Badge><StatusBadge status={rule.status} /></div>
                    <div className="mt-2 text-sm font-semibold text-text-primary">{rule.title}</div>
                    <div className="mt-1 text-xs text-text-secondary">{rule.riskType} · {rule.severity} · {rule.latestVersion}</div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <SectionHeader title="Rule Detail" description="Trigger, evidence, action, escalation, and suspension details." />
            <div className="space-y-4 p-4">
              <Field label="Trigger"><textarea value={selected.trigger} readOnly className={textareaClass} /></Field>
              <Field label="Detection Evidence"><textarea value={selected.evidence} readOnly className={textareaClass} /></Field>
              <Field label="System Action"><textarea value={selected.systemAction} readOnly className={textareaClass} /></Field>
              <Field label="Fixed Response"><textarea value={selected.fixedResponse} readOnly className={textareaClass} /></Field>
              <Field label="Clinician Escalation"><textarea value={selected.escalation} readOnly className={textareaClass} /></Field>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <SectionHeader title="Linked Protocol Locations" description="Bidirectional linkage back into the protocol editor." />
            <div className="space-y-4 p-4">
              <div className="rounded-panel border border-border bg-surface-subtle p-3">
                <div className="text-sm font-semibold text-text-primary">Linked nodes</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(usageQuery.data ?? []).map((node) => (
                    <Link key={node.id} href={`/projects/demo/protocols/tbct-br-001/canvas?node=${node.id}`}>
                      <SourceReferenceChip label={node.data.protocolNodeId} />
                    </Link>
                  ))}
                  {!usageQuery.data?.length && <SourceReferenceChip label="No linked node" />}
                </div>
              </div>
              <Link href={`/projects/demo/protocols/tbct-br-001/canvas${nodeId ? `?node=${nodeId}` : ""}`}>
                <Button variant="secondary">Open Protocol Editor</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
