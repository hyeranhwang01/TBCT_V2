"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PtCard } from "@/patient/components/ui/kit";
import { useT } from "@/shared/i18n/context";
import type { SessionProgressCard } from "@/types/worksheet";

// Patient palette (v2): deep forest green and a darkened gold. The pair
// differs strongly in lightness, which is what keeps it distinguishable for
// every common color-vision deficiency, not just in hue.
const SERIES_COLORS = ["#1D4A31", "#C28A1E"] as const;
const SURFACE = "#FFFFFF";

interface CustomTooltipEntry {
  dataKey?: string | number | ((obj: unknown) => unknown);
  color?: string;
  value?: number | string | ReadonlyArray<number | string>;
}

function CustomTooltip({ active, payload, label, seriesLabels }: { active?: boolean; payload?: readonly CustomTooltipEntry[]; label?: string | number; seriesLabels: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-[var(--pt-shadow-md)]">
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
    <PtCard className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[15px] font-bold text-text-primary">{t(`patientProfile.progress.sessions.${sessionKey}`)}</div>
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
            <CartesianGrid stroke="#E6E3DA" strokeWidth={1} vertical={false} />
            <XAxis dataKey="checkpoint" tick={{ fontSize: 11, fill: "#808A84" }} axisLine={{ stroke: "#E6E3DA" }} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#808A84" }} axisLine={false} tickLine={false} width={32} />
            <Tooltip content={(props) => <CustomTooltip {...props} seriesLabels={seriesLabels} />} />
            {card.series.map((series, index) => (
              <Line
                key={series.seriesKey}
                type="monotone"
                dataKey={series.seriesKey}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={2.5}
                dot={{ r: 4, strokeWidth: 2, stroke: SURFACE, fill: SERIES_COLORS[index % SERIES_COLORS.length] }}
                activeDot={{ r: 6, strokeWidth: 2, stroke: SURFACE }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </PtCard>
  );
}
