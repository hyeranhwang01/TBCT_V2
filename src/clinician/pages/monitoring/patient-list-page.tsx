"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, ArrowUpDown, CheckCircle2, ChevronRight, PauseCircle, Search, TriangleAlert } from "lucide-react";
import { AppShell } from "@/clinician/components/app-shell";
import { Badge, Button, Card, EmptyState, PageHeader, PageSkeleton, inputClass } from "@/shared/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import { listRuntimeParticipants } from "@/lib/api/participant-api";
import { listRuntimeSessions } from "@/lib/api/runtime-session-api";
import { getSafetyEvents } from "@/lib/api/safety-operations-api";
import { getCohortProgressSummary } from "@/lib/worksheet/worksheet-projection";
import { listAllStandardizedAssessmentResponses, summarizeCohortAssessments, latestSelfHarmFlaggedParticipantIds } from "@/lib/api/standardized-assessment-api";
import { useRealtimeInvalidate } from "@/lib/supabase/use-realtime-invalidate";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";
import {
  daysSince,
  findSessionTitle,
  findStepTitle,
  maxOpenSeverity,
  summarizeParticipant,
  type MonitoringStatus,
  type ParticipantMonitoringSummary,
} from "@/clinician/pages/monitoring/patient-monitoring-utils";
import type { RuntimeParticipant } from "@/types/longitudinal-memory";

const STATUS_TONE: Record<MonitoringStatus, "primary" | "warning" | "critical" | "success" | "neutral"> = {
  inProgress: "primary",
  paused: "warning",
  needsReview: "critical",
  completed: "success",
  notStarted: "neutral",
};

// "Needs attention" sort inputs (see needsAttentionRows below) -- module
// scope, not component-local, so the useMemo below doesn't need them in its
// dependency array (they never change).
const STALE_DAYS_THRESHOLD = 7;
const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const;

function formatTimestamp(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function PatientListPage() {
  const { t, locale } = useT();
  const participantsQuery = useQuery({ queryKey: ["patient-monitoring-participants"], queryFn: listRuntimeParticipants });
  const sessionsQuery = useQuery({ queryKey: ["patient-monitoring-sessions"], queryFn: listRuntimeSessions });
  const safetyQuery = useQuery({ queryKey: ["patient-monitoring-safety-events"], queryFn: getSafetyEvents });
  // Cohort-wide outcome rollup -- not realtime-invalidated like the three
  // above (it's a per-participant aggregate, not a single-table read, and
  // this dashboard doesn't need it to the second); refetches on its own
  // normal staleness schedule.
  const cohortProgressQuery = useQuery({ queryKey: ["patient-monitoring-cohort-progress"], queryFn: getCohortProgressSummary });
  // One fetch, two derived views (cohort averages + which participants have
  // a live self-harm flag) -- see summarizeCohortAssessments's own doc
  // comment for why this isn't two separate cohort-wide reads.
  const assessmentResponsesQuery = useQuery({ queryKey: ["patient-monitoring-assessment-responses"], queryFn: listAllStandardizedAssessmentResponses });
  const cohortAssessmentSummary = useMemo(() => summarizeCohortAssessments(assessmentResponsesQuery.data ?? []), [assessmentResponsesQuery.data]);
  const selfHarmFlaggedParticipantIds = useMemo(() => latestSelfHarmFlaggedParticipantIds(assessmentResponsesQuery.data ?? []), [assessmentResponsesQuery.data]);
  // Both were refetchInterval: 5000, unfiltered full-table scans on a
  // dashboard clinicians tend to leave open all day -- directly the
  // "Neon egress" pattern this migration exists to fix.
  useRealtimeInvalidate([{ table: "runtime_sessions" }], ["patient-monitoring-sessions"]);
  useRealtimeInvalidate([{ table: "safety_events" }], ["patient-monitoring-safety-events"]);

  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | MonitoringStatus>("all");
  const [sessionFilter, setSessionFilter] = useState<"all" | string>("all");
  const [sortDescending, setSortDescending] = useState(true);
  const [myPatientsOnly, setMyPatientsOnly] = useState(false);

  const isLoading = participantsQuery.isLoading || sessionsQuery.isLoading || safetyQuery.isLoading;

  const rows = useMemo(() => {
    const participants = participantsQuery.data ?? [];
    const sessions = sessionsQuery.data ?? [];
    const safetyEvents = safetyQuery.data ?? [];
    return participants.map((participant) => ({
      participant,
      summary: summarizeParticipant(participant.id, sessions, safetyEvents, participant.updatedAt),
    }));
  }, [participantsQuery.data, sessionsQuery.data, safetyQuery.data]);

  const sessionOptions = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach(({ summary }) => {
      if (summary.currentSession?.sessionDefinitionId) ids.add(summary.currentSession.sessionDefinitionId);
    });
    return Array.from(ids);
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter(({ participant }) => {
        if (!query) return true;
        return participant.alias.toLowerCase().includes(query) || participant.id.toLowerCase().includes(query);
      })
      .filter(({ summary }) => statusFilter === "all" || summary.monitoringStatus === statusFilter)
      .filter(({ summary }) => sessionFilter === "all" || summary.currentSession?.sessionDefinitionId === sessionFilter)
      .filter(({ participant }) => !myPatientsOnly || participant.assignedClinician === user?.id)
      .sort((left, right) => {
        const leftTime = left.summary.lastActivity ?? "";
        const rightTime = right.summary.lastActivity ?? "";
        return sortDescending ? rightTime.localeCompare(leftTime) : leftTime.localeCompare(rightTime);
      });
  }, [rows, search, statusFilter, sessionFilter, sortDescending, myPatientsOnly, user?.id]);

  const summaryCounts = useMemo(() => {
    const counts: Record<MonitoringStatus, number> = { inProgress: 0, paused: 0, needsReview: 0, completed: 0, notStarted: 0 };
    rows.forEach(({ summary }) => {
      counts[summary.monitoringStatus] += 1;
    });
    return counts;
  }, [rows]);

  // Reuses getSafetyDashboardData's underlying data (safetyQuery, already
  // fetched above) rather than a new query -- just re-sorted by what
  // actually needs a clinician's attention first (open safety severity,
  // then how long a participant has gone quiet) instead of the main list's
  // single lastActivity-only sort.
  const needsAttentionRows = useMemo(() => {
    const safetyEvents = safetyQuery.data ?? [];
    return rows
      .map((row) => {
        const selfHarmFlagged = selfHarmFlaggedParticipantIds.has(row.participant.id);
        const openSafetySeverity = maxOpenSeverity(safetyEvents, row.participant.id);
        // A live PHQ-9 self-harm flag is at least as urgent as an open
        // "high" safety event -- there's no rank above "high" to promote
        // it to, so it floors the effective severity at "high" rather than
        // stacking a separate scale.
        const severity = selfHarmFlagged ? "high" : openSafetySeverity;
        return { ...row, severity, selfHarmFlagged, staleDays: daysSince(row.summary.lastActivity) };
      })
      .filter((row) => row.severity || row.selfHarmFlagged || (row.staleDays ?? 0) >= STALE_DAYS_THRESHOLD)
      .sort((left, right) => {
        const severityDiff = (right.severity ? SEVERITY_RANK[right.severity] : 0) - (left.severity ? SEVERITY_RANK[left.severity] : 0);
        if (severityDiff !== 0) return severityDiff;
        return (right.staleDays ?? 0) - (left.staleDays ?? 0);
      })
      .slice(0, 8);
  }, [rows, safetyQuery.data, selfHarmFlaggedParticipantIds]);

  if (isLoading) return <AppShell><PageSkeleton /></AppShell>;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Clinician"
        title={t("patientMonitoring.title")}
        description="Caseload overview across active, paused, and completed protocol sessions."
        actions={
          <Link href="/data-dashboard">
            <Button variant="secondary">{t("patientMonitoring.viewDataDashboard")}</Button>
          </Link>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        {needsAttentionRows.length > 0 && (
          <Card className="p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">{t("patientMonitoring.needsAttention.title")}</div>
            <div className="space-y-1.5">
              {needsAttentionRows.map(({ participant, staleDays, severity, selfHarmFlagged }) => (
                <Link
                  key={participant.id}
                  href={`/patients/${participant.id}`}
                  className="flex items-center justify-between gap-3 rounded-panel px-2 py-1.5 text-sm hover:bg-surface-hover"
                >
                  <span className="min-w-0 truncate font-medium text-text-primary">{participant.alias}</span>
                  <span className="flex shrink-0 gap-2">
                    {selfHarmFlagged && <Badge tone="critical">{t("patientMonitoring.needsAttention.selfHarmFlag")}</Badge>}
                    {severity && <Badge tone={severity === "high" ? "critical" : severity === "medium" ? "warning" : "neutral"}>{t(`patientMonitoring.severity.${severity}`)}</Badge>}
                    {(staleDays ?? 0) >= 7 && <Badge tone="neutral">{t("patientMonitoring.needsAttention.staleDays", { count: staleDays ?? 0 })}</Badge>}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        )}
        {/* Desktop/tablet (>=640px): 4-card grid. Clicking a card toggles the
            status filter to that status (and back to "all" on a second
            click), so the chevron affordance actually does something. */}
        <div className="hidden grid-cols-2 gap-3 sm:grid lg:grid-cols-4">
          <SummaryStat
            icon={<Activity className="h-4 w-4" />}
            label={t("patientMonitoring.summary.inProgress")}
            value={summaryCounts.inProgress}
            tone="primary"
            active={statusFilter === "inProgress"}
            onClick={() => setStatusFilter((value) => (value === "inProgress" ? "all" : "inProgress"))}
          />
          <SummaryStat
            icon={<PauseCircle className="h-4 w-4" />}
            label={t("patientMonitoring.summary.paused")}
            value={summaryCounts.paused}
            tone="warning"
            active={statusFilter === "paused"}
            onClick={() => setStatusFilter((value) => (value === "paused" ? "all" : "paused"))}
          />
          <SummaryStat
            icon={<TriangleAlert className="h-4 w-4" />}
            label={t("patientMonitoring.summary.needsReview")}
            value={summaryCounts.needsReview}
            tone="critical"
            active={statusFilter === "needsReview"}
            onClick={() => setStatusFilter((value) => (value === "needsReview" ? "all" : "needsReview"))}
          />
          <SummaryStat
            icon={<CheckCircle2 className="h-4 w-4" />}
            label={t("patientMonitoring.summary.completed")}
            value={summaryCounts.completed}
            tone="success"
            active={statusFilter === "completed"}
            onClick={() => setStatusFilter((value) => (value === "completed" ? "all" : "completed"))}
          />
        </div>
        {/* Mobile (<640px): same counts/labels, one compact row instead of 4 large cards (brief §9). */}
        <Card className="flex items-center gap-3 overflow-x-auto p-3 text-xs sm:hidden">
          <CompactSummaryStat label={t("patientMonitoring.summary.inProgress")} value={summaryCounts.inProgress} tone="primary" />
          <CompactSummaryStat label={t("patientMonitoring.summary.paused")} value={summaryCounts.paused} tone="warning" />
          <CompactSummaryStat label={t("patientMonitoring.summary.needsReview")} value={summaryCounts.needsReview} tone="critical" />
          <CompactSummaryStat label={t("patientMonitoring.summary.completed")} value={summaryCounts.completed} tone="success" />
        </Card>

        {cohortProgressQuery.data && cohortProgressQuery.data.length > 0 && (
          <Card className="p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">{t("patientMonitoring.cohortProgress.title")}</div>
            <div className="flex gap-3 overflow-x-auto">
              {cohortProgressQuery.data.map((row) => (
                <CohortProgressTile key={`${row.sessionDefinitionId}:${row.seriesKey}`} row={row} />
              ))}
            </div>
          </Card>
        )}

        {cohortAssessmentSummary.length > 0 && (
          <Card className="p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">{t("patientMonitoring.cohortAssessments.title")}</div>
            <div className="flex gap-3 overflow-x-auto">
              {cohortAssessmentSummary.map((row) => (
                <div key={row.instrument} className="flex shrink-0 flex-col gap-0.5 rounded-panel border border-border bg-surface-subtle px-3 py-2">
                  <span className="whitespace-nowrap text-[11px] text-text-secondary">{row.instrument === "phq9" ? "PHQ-9" : "GAD-7"}</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-lg font-semibold text-text-primary">{row.averageLatestScore}</span>
                    <span className="text-[11px] text-text-muted">{t("patientMonitoring.cohortProgress.sampleSize", { count: row.sampleSize })}</span>
                  </span>
                  {row.selfHarmFlagCount > 0 && <Badge tone="critical">{t("patientMonitoring.cohortAssessments.selfHarmFlagCount", { count: row.selfHarmFlagCount })}</Badge>}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Desktop/tablet (>=640px): unchanged filter bar. */}
        <Card className="hidden p-3 sm:block">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                className={cn(inputClass, "pl-9")}
                placeholder={t("patientMonitoring.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select className={cn(inputClass, "lg:w-48")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label={t("patientMonitoring.statusFilter")}>
              <option value="all">{t("common.all")}</option>
              <option value="inProgress">{t("patientMonitoring.status.inProgress")}</option>
              <option value="paused">{t("patientMonitoring.status.paused")}</option>
              <option value="needsReview">{t("patientMonitoring.status.needsReview")}</option>
              <option value="completed">{t("patientMonitoring.status.completed")}</option>
              <option value="notStarted">{t("patientMonitoring.status.notStarted")}</option>
            </select>
            <select className={cn(inputClass, "lg:w-56")} value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} aria-label={t("patientMonitoring.sessionFilter")}>
              <option value="all">{t("common.all")}</option>
              {sessionOptions.map((id) => (
                <option key={id} value={id}>{findSessionTitle(id, locale) ?? id}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSortDescending((value) => !value)}
              className="inline-flex h-9 items-center gap-2 rounded-panel border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:bg-surface-hover lg:w-56"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {t("patientMonitoring.sortByLastActivity")}
            </button>
            <button
              type="button"
              onClick={() => setMyPatientsOnly((value) => !value)}
              aria-pressed={myPatientsOnly}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-panel border px-3 text-xs font-medium hover:bg-surface-hover lg:w-40",
                myPatientsOnly ? "border-clinical-blue bg-clinical-blue-light text-clinical-blue" : "border-border bg-surface text-text-secondary",
              )}
            >
              {t("patientMonitoring.myPatientsOnly")}
            </button>
          </div>
        </Card>

        {/* Mobile (<640px): same search/filter/sort state and handlers, compact layout (brief §10). */}
        <Card className="space-y-2 p-3 sm:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              className={cn(inputClass, "pl-9")}
              placeholder={t("patientMonitoring.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label={t("patientMonitoring.statusFilter")}>
              <option value="all">{t("common.all")}</option>
              <option value="inProgress">{t("patientMonitoring.status.inProgress")}</option>
              <option value="paused">{t("patientMonitoring.status.paused")}</option>
              <option value="needsReview">{t("patientMonitoring.status.needsReview")}</option>
              <option value="completed">{t("patientMonitoring.status.completed")}</option>
              <option value="notStarted">{t("patientMonitoring.status.notStarted")}</option>
            </select>
            <select className={inputClass} value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} aria-label={t("patientMonitoring.sessionFilter")}>
              <option value="all">{t("common.all")}</option>
              {sessionOptions.map((id) => (
                <option key={id} value={id}>{findSessionTitle(id, locale) ?? id}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSortDescending((value) => !value)}
              className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-panel border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:bg-surface-hover"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {t("patientMonitoring.sortByLastActivity")}
            </button>
          </div>
        </Card>

        {!filteredRows.length ? (
          <Card><EmptyState title="No participants match the current filters" /></Card>
        ) : (
          <>
            {/* Wide screens: table */}
            <Card className="hidden overflow-hidden lg:block">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-4 py-3">{t("patientMonitoring.columns.participant")}</th>
                    <th className="px-4 py-3">{t("patientMonitoring.columns.currentSession")}</th>
                    <th className="px-4 py-3">{t("patientMonitoring.columns.currentStep")}</th>
                    <th className="px-4 py-3">{t("patientMonitoring.columns.status")}</th>
                    <th className="px-4 py-3">{t("patientMonitoring.columns.lastActivity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(({ participant, summary }) => (
                    <ParticipantRow key={participant.id} participant={participant} summary={summary} t={t} locale={locale} />
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Narrow screens (phone + tablet, both already <lg today): stacked
                cards -- unchanged design, only defensive overflow classes
                (min-w-0/truncate/shrink-0) added so long aliases/titles can
                never push this card past the viewport (brief §17). */}
            <div className="grid gap-3 lg:hidden">
              {filteredRows.map(({ participant, summary }) => (
                <Link key={participant.id} href={`/patients/${participant.id}`} className="transition-ui block active:scale-[0.998]">
                  <Card className="min-w-0 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-semibold text-text-primary">{participant.alias}</div>
                      <Badge dot className="shrink-0" tone={STATUS_TONE[summary.monitoringStatus]}>{t(`patientMonitoring.status.${summary.monitoringStatus}`)}</Badge>
                    </div>
                    <div className="mt-2 truncate text-xs text-text-secondary">{findSessionTitle(summary.currentSession?.sessionDefinitionId, locale) ?? "—"}</div>
                    <div className="mt-1 truncate text-xs text-text-secondary">{findStepTitle(summary.currentSession?.currentNodeId, locale) ?? "—"}</div>
                    <div className="mt-2 text-[11px] text-text-muted">{formatTimestamp(summary.lastActivity)}</div>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

const STAT_TONE_STYLES: Record<"primary" | "warning" | "critical" | "success", { iconWrap: string; bar: string }> = {
  primary: { iconWrap: "bg-clinical-blue-light text-clinical-blue", bar: "bg-clinical-blue" },
  warning: { iconWrap: "bg-warning-light text-warning", bar: "bg-warning" },
  critical: { iconWrap: "bg-critical-light text-critical", bar: "bg-critical" },
  success: { iconWrap: "bg-success-light text-success", bar: "bg-success" },
};

function SummaryStat({
  icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "primary" | "warning" | "critical" | "success";
  active: boolean;
  onClick: () => void;
}) {
  const styles = STAT_TONE_STYLES[tone];
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn("flex w-full flex-col gap-3 p-4 text-left transition hover:bg-surface-hover", active && "bg-surface-hover")}
      >
        <div className="flex items-center justify-between">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", styles.iconWrap)}>{icon}</span>
          <ChevronRight className="h-4 w-4 text-text-muted" />
        </div>
        <div>
          <div className="text-xs font-medium text-text-secondary">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-text-primary">{value}</div>
        </div>
        <div className={cn("h-1 w-full rounded-full", styles.bar)} />
      </button>
    </Card>
  );
}

// Same counts/labels as SummaryStat above, just laid out as one dense row
// instead of four large cards -- see brief §9 ("compact status summary").
function CompactSummaryStat({ label, value, tone }: { label: string; value: number; tone: "primary" | "warning" | "critical" | "success" }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span className="text-text-secondary">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

// Stat-tile form (label / value / signed delta) per the dataviz method's
// "figures" pattern -- reuses patientProfile.progress's i18n keys (same
// sessionDefinitionId/seriesKey vocabulary as the patient-facing progress
// chart, see session-progress-chart.tsx) rather than a parallel set.
// Every series here is "less is better" (belief in a distorted thought,
// guilt, shame), so a non-positive delta is success-toned and a positive
// one is warning-toned -- there's no exception among the sessions this
// covers today (see PROGRESS_SERIES_PLAN in worksheet-projection.ts).
function CohortProgressTile({ row }: { row: { sessionDefinitionId: string; seriesKey: string; averageDelta: number; sampleSize: number } }) {
  const { t } = useT();
  const sessionKey = row.sessionDefinitionId.replace("tbct-", "");
  return (
    <div className="flex shrink-0 flex-col gap-0.5 rounded-panel border border-border bg-surface-subtle px-3 py-2">
      <span className="whitespace-nowrap text-[11px] text-text-secondary">
        {t(`patientProfile.progress.sessions.${sessionKey}`)} · {t(`patientProfile.progress.series.${row.seriesKey}`)}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={cn("text-lg font-semibold", row.averageDelta <= 0 ? "text-success" : "text-warning")}>
          {row.averageDelta > 0 ? "+" : ""}{row.averageDelta}pp
        </span>
        <span className="text-[11px] text-text-muted">{t("patientMonitoring.cohortProgress.sampleSize", { count: row.sampleSize })}</span>
      </span>
    </div>
  );
}

function ParticipantRow({
  participant,
  summary,
  t,
  locale,
}: {
  participant: RuntimeParticipant;
  summary: ParticipantMonitoringSummary;
  t: ReturnType<typeof useT>["t"];
  locale: string;
}) {
  const router = useRouter();
  const href = `/patients/${participant.id}`;
  return (
    // group + relative: the "View ->" affordance below is absolutely
    // positioned over this row's own trailing padding (not a 6th column),
    // so revealing it on hover never shifts the Last Activity text or any
    // column width. Row-level onClick mirrors the alias <Link> below (kept
    // for accessibility/open-in-new-tab) so hovering/clicking anywhere in
    // the row -- not just the alias text -- does what the hover feedback
    // implies it will.
    <tr
      onClick={() => router.push(href)}
      className="transition-ui group relative cursor-pointer border-b border-border last:border-0 hover:-translate-y-px hover:bg-surface-hover hover:shadow-sm active:scale-[0.998]"
    >
      <td className="px-4 py-3">
        <Link href={href} onClick={(event) => event.stopPropagation()} className="transition-ui font-medium text-clinical-blue group-hover:text-clinical-blue/80 hover:underline">
          {participant.alias}
        </Link>
        <div className="text-[11px] text-text-muted">{participant.id}</div>
      </td>
      <td className="px-4 py-3 text-text-secondary">{findSessionTitle(summary.currentSession?.sessionDefinitionId, locale) ?? "—"}</td>
      <td className="px-4 py-3 text-text-secondary">{findStepTitle(summary.currentSession?.currentNodeId, locale) ?? "—"}</td>
      <td className="px-4 py-3"><Badge dot tone={STATUS_TONE[summary.monitoringStatus]}>{t(`patientMonitoring.status.${summary.monitoringStatus}`)}</Badge></td>
      <td className="relative px-4 py-3 text-text-secondary">
        {formatTimestamp(summary.lastActivity)}
        <span
          aria-hidden
          className="transition-ui pointer-events-none absolute inset-y-0 right-4 flex -translate-x-1 items-center gap-1 bg-surface-hover pl-3 text-xs font-semibold text-clinical-blue opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
        >
          {t("patientMonitoring.view")}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </td>
    </tr>
  );
}
