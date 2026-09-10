"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import { listRuntimeParticipants } from "@/lib/api/participant-api";
import { listRuntimeSessions } from "@/lib/api/runtime-session-api";
import { getSafetyEvents } from "@/lib/api/safety-operations-api";
import { getCohortAssessmentSummary } from "@/lib/api/standardized-assessment-api";
import { bucketByWeek } from "@/lib/runtime/data-dashboard-metrics";
import type { RuntimeSession } from "@/types/runtime-session";
import type { SafetyEvent } from "@/types/safety-operations";

// Validated single-hue line (dataviz skill's default palette; see
// session-progress-chart.tsx's own note -- the same color, reused here
// rather than re-validated, since a single-series chart has no adjacent-pair
// CVD concern to check in the first place).
const LINE_COLOR = "#2a78d6";
const WEEKS_SHOWN = 10;

type TrendMetric = "sessions" | "safetyEvents";

interface CustomTooltipEntry {
  value?: number | string | ReadonlyArray<number | string>;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: readonly CustomTooltipEntry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-panel border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-text-secondary">{label}</div>
      <div className="font-semibold text-text-primary">{payload[0].value}</div>
    </div>
  );
}

/**
 * A companion chapter (linked from the clinician Patient Monitoring page's
 * header) that charts data this app already collects -- not a place to
 * define new metrics, just a way to actually see the ones that exist as
 * they accumulate. Every source here (listRuntimeParticipants,
 * listRuntimeSessions, getSafetyEvents, getCohortAssessmentSummary) is the
 * same one the existing clinician pages already read from real Postgres,
 * not a new aggregation path.
 */
export function DataDashboardPage() {
  const { t } = useT();
  const [metric, setMetric] = useState<TrendMetric>("sessions");

  const participantsQuery = useQuery({ queryKey: ["data-dashboard-participants"], queryFn: listRuntimeParticipants });
  const sessionsQuery = useQuery({ queryKey: ["data-dashboard-sessions"], queryFn: listRuntimeSessions });
  const safetyQuery = useQuery({ queryKey: ["data-dashboard-safety-events"], queryFn: getSafetyEvents });
  const assessmentSummaryQuery = useQuery({ queryKey: ["data-dashboard-assessment-summary"], queryFn: getCohortAssessmentSummary });

  // useMemo, not a plain `?? []` fallback -- that would hand useMemo below a
  // fresh empty-array reference on every render while a query is still
  // loading, defeating its own memoization (and tripping exhaustive-deps).
  const sessions: RuntimeSession[] = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const safetyEvents: SafetyEvent[] = useMemo(() => safetyQuery.data ?? [], [safetyQuery.data]);
  const loading = participantsQuery.isLoading || sessionsQuery.isLoading || safetyQuery.isLoading;

  const stats = {
    participants: participantsQuery.data?.length ?? 0,
    sessionsTotal: sessions.length,
    sessionsCompleted: sessions.filter((session) => session.status === "completed").length,
    sessionsOpen: sessions.filter((session) => !["completed", "terminated", "failed"].includes(session.status)).length,
    safetyOpen: safetyEvents.filter((event) => !["closed", "resolved", "false_positive", "cancelled"].includes(event.status)).length,
  };

  const trendData = useMemo(() => {
    const source = metric === "sessions" ? sessions : safetyEvents;
    return bucketByWeek(source, WEEKS_SHOWN);
  }, [metric, sessions, safetyEvents]);

  if (loading) return <AppShell><PageSkeleton /></AppShell>;

  return (
    <AppShell>
      <PageHeader title={t("dataDashboard.pageTitle")} description={t("dataDashboard.pageDescription")} />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label={t("dataDashboard.stats.participants")} value={stats.participants} />
          <StatTile label={t("dataDashboard.stats.sessionsTotal")} value={stats.sessionsTotal} />
          <StatTile label={t("dataDashboard.stats.sessionsOpen")} value={stats.sessionsOpen} />
          <StatTile label={t("dataDashboard.stats.sessionsCompleted")} value={stats.sessionsCompleted} />
          <StatTile label={t("dataDashboard.stats.safetyOpen")} value={stats.safetyOpen} tone={stats.safetyOpen > 0 ? "critical" : "success"} />
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-text-primary">{t("dataDashboard.trend.title")}</div>
            <div className="flex gap-1 rounded-panel border border-border bg-surface-subtle p-1">
              <button
                type="button"
                onClick={() => setMetric("sessions")}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${metric === "sessions" ? "bg-clinical-blue text-white" : "text-text-secondary hover:bg-surface"}`}
              >
                {t("dataDashboard.trend.sessions")}
              </button>
              <button
                type="button"
                onClick={() => setMetric("safetyEvents")}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${metric === "safetyEvents" ? "bg-clinical-blue text-white" : "text-text-secondary hover:bg-surface"}`}
              >
                {t("dataDashboard.trend.safetyEvents")}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-text-secondary">{t("dataDashboard.trend.hint")}</p>
          <div className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="#DDE4EC" strokeWidth={1} vertical={false} />
                <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: "#8491A3" }} axisLine={{ stroke: "#DDE4EC" }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#8491A3" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip content={(props) => <CustomTooltip {...props} />} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={LINE_COLOR}
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: "#FFFFFF", fill: LINE_COLOR }}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: "#FFFFFF" }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {assessmentSummaryQuery.data && assessmentSummaryQuery.data.length > 0 && (
          <Card className="p-4">
            <div className="text-sm font-semibold text-text-primary">{t("dataDashboard.assessments.title")}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {assessmentSummaryQuery.data.map((row) => (
                <div key={row.instrument} className="rounded-panel border border-border bg-surface-subtle p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{row.instrument}</span>
                    <Badge tone="neutral">{t("dataDashboard.assessments.sampleSize", { count: row.sampleSize })}</Badge>
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-text-primary">{row.averageLatestScore}</div>
                  <div className="text-[11px] text-text-muted">{t("dataDashboard.assessments.averageScore")}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function StatTile({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "critical" | "success" }) {
  const valueClass = tone === "critical" ? "text-critical" : tone === "success" ? "text-success" : "text-text-primary";
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClass}`}>{value}</div>
    </Card>
  );
}
