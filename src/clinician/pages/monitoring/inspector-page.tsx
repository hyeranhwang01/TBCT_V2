"use client";

import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Card, EmptyState, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { RuntimeInspectorView } from "@/clinician/pages/monitoring/inspector-view";
import { getRuntimeSession } from "@/lib/api/runtime-session-api";
import { useT } from "@/lib/i18n/context";

// Standalone `/runtime/sessions/:id` route -- the actual Inspector content
// (protocol path, linked conversation/log, safety/provider/validation,
// memory) lives in runtime-inspector-view.tsx, shared with the "인스펙터"
// tab on patient-detail-page.tsx so both render identically from the same
// component instead of drifting apart.
export function RuntimeInspectorPage() {
  const params = useParams<{ sessionId: string }>();
  const pathname = usePathname();
  const { t } = useT();
  const sessionId = (Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId) ?? pathname.split("/").filter(Boolean).at(-1) ?? "";
  const sessionQuery = useQuery({ queryKey: ["runtime-inspector", sessionId], queryFn: () => getRuntimeSession(sessionId), enabled: Boolean(sessionId) });
  if (sessionQuery.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (!sessionQuery.data) return <AppShell><Card className="m-4 lg:m-6"><EmptyState title={t("runtimeInspector.notFound")} /></Card></AppShell>;
  const { session } = sessionQuery.data;

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("runtimeInspector.eyebrow")}
        title={t("runtimeInspector.title", { alias: session.patientAlias })}
        description={t("runtimeInspector.description")}
        meta={<><Badge tone="primary">{session.status}</Badge><Badge tone="neutral">{session.protocolVersion}</Badge><Badge tone="warning">{session.sessionDefinitionId}</Badge></>}
      />
      <div className="p-4 lg:p-6">
        <RuntimeInspectorView view={sessionQuery.data} />
      </div>
    </AppShell>
  );
}
