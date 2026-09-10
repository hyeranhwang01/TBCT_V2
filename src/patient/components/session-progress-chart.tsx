"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/shared/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import type { SessionProgressCard } from "@/types/worksheet";

// Validated categorical pair (node scripts/validate_palette.js "#2a78d6,#eb6834"
// --mode light --surface "#FFFFFF" -- all checks pass: CVD deltaE 24.7,
// normal-vision deltaE 33.6). This app's own brand colors (clinical-blue +
// ai-violet) fail that same check as an adjacent pair (deltaE 9.7, below the
// 15 floor), so the two series below intentionally borrow from the dataviz
// skill's validated default palette rather than the app's brand pair.
const SERIES_COLORS = ["#2a78d6", "#eb6834"] as const;
const SURFACE = "#FFFFFF";

interface CustomTooltipEntry {
  dataKey?: string | number | ((obj: unknown) => unknown);
  color?: string;
  value?: number | string | ReadonlyArray<number | string>;
}

function CustomTooltip({ active, payload, label, seriesLabels }: { active?: boolean; payload?: readonly CustomTooltipEntry[]; label?: string | number; seriesLabels: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-panel border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-text-secondary">{label}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ backgroundColor: entry.color }} />
          <span className="font-semibold text-text-primary">{entry.value}%</span>
          <span className="text-text-muted">{seriesLabels[String(entry.dataKey)] ?? String(entry.dataKey)}</span>
        </div>
      ))}
    </div>
  );
}

/** One patient-facing "before → after" (or multi-checkpoint) line chart for
 * a single session's progress data. See getPatientProgressSeries in
 * worksheet-projection.ts for how this shape is assembled -- checkpoint/
 * seriesKey are stable keys resolved through i18n here, never pre-localized
 * by the API layer. */
export function SessionProgressChart({ card }: { card: SessionProgressCard }) {
  const { t } = useT();
  const sessionKey = card.sessionDefinitionId.replace("tbct-", "");
  const seriesLabels = Object.fromEntries(card.series.map((series) => [series.seriesKey, t(`patientProfile.progress.series.${series.seriesKey}`)]));

  // Union of every checkpoint across this card's series, in first-seen
  // order, so a chart with multiple series (S05) shares one x-axis even if
  // a series is missing a checkpoint the other has.
  const checkpointOrder: string[] = [];
  for (const series of card.series) {
    for (const point of series.points) {
      if (!checkpointOrder.includes(point.checkpoint)) checkpointOrder.push(point.checkpoint);
    }
  }
  const rows = checkpointOrder.map((checkpoint) => {
    const row: Record<string, string | number> = { checkpoint: t(`patientProfile.progress.checkpoints.${checkpoint}`) };
    for (const series of card.series) {
      const point = series.points.find((item) => item.checkpoint === checkpoint);
      if (point) row[series.seriesKey] = point.value;
    }
    return row;
  });

  const firstSeries = card.series[0];
  const delta = firstSeries && firstSeries.points.length >= 2 ? firstSeries.points.at(-1)!.value - firstSeries.points[0].value : undefined;

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold text-text-primary">{t(`patientProfile.progress.sessions.${sessionKey}`)}</div>
        {delta !== undefined && (
          <div className={delta <= 0 ? "text-xs font-medium text-success" : "text-xs font-medium text-warning"}>
            {delta > 0 ? "+" : ""}{delta}pp
          </div>
        )}
      </div>
      {card.series.length > 1 && (
        <div className="mt-1 flex gap-3 text-xs text-text-secondary">
          {card.series.map((series, index) => (
            <span key={series.seriesKey} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3" style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }} />
              {seriesLabels[series.seriesKey]}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="#DDE4EC" strokeWidth={1} vertical={false} />
            <XAxis dataKey="checkpoint" tick={{ fontSize: 11, fill: "#8491A3" }} axisLine={{ stroke: "#DDE4EC" }} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#8491A3" }} axisLine={false} tickLine={false} width={32} />
            <Tooltip content={(props) => <CustomTooltip {...props} seriesLabels={seriesLabels} />} />
            {card.series.map((series, index) => (
              <Line
                key={series.seriesKey}
                type="monotone"
                dataKey={series.seriesKey}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: SURFACE, fill: SERIES_COLORS[index % SERIES_COLORS.length] }}
                activeDot={{ r: 6, strokeWidth: 2, stroke: SURFACE }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
