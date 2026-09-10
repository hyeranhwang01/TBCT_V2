"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, Field, PageHeader, SectionHeader, inputClass, textareaClass } from "@/components/ui/primitives";

export function SettingsPage() {
  const [workspaceName, setWorkspaceName] = useState("TBCT Protocol Studio");
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [notes, setNotes] = useState("Clinical approval and safety validation are required before any production publish.");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Workspace Controls"
        title="Settings"
        description="Manage operating policies, notifications, release guards, and default settings for international study demos."
        meta={<><Badge tone="primary">Owner-only access</Badge><Badge tone="warning">Demo mode enabled</Badge></>}
        actions={<Button>Save</Button>}
      />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
          <Card className="overflow-hidden">
            <SectionHeader title="Workspace Profile" description="Default runtime environment and locale policy" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Workspace name"><input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} className={inputClass} /></Field>
              <Field label="Timezone"><input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass} /></Field>
              <div className="sm:col-span-2"><Field label="Publishing note"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClass} /></Field></div>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <SectionHeader title="Policy Controls" description="Explicitly display release and review policies" />
            <div className="space-y-3 p-4">
              {[
                ["Release gate", "Clinical approval required"],
                ["Validation gate", "Critical issues block publish"],
                ["Traceability", "Source references required for edited prompts"],
                ["Audit retention", "180 days searchable"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-panel border border-border bg-surface-subtle p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
                  <div className="mt-1 text-sm font-semibold text-text-primary">{value}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
