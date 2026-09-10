"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, EmptyState, SectionHeader } from "@/components/ui/primitives";
import { ScoreChip } from "@/components/runtime/worksheet-renderers/shared";
import { getListScoreHistory } from "@/lib/worksheet/worksheet-projection";

// Clinician-only "Progress" tab content (Patient Monitoring's session
// detail screen). Only two sessions have a data shape that supports a real
// cross-run comparison today: S02 (problems/goals are index-matched
// item+0-5-score list pairs) and S06 (symptom items, same shape) -- both
// already read by getListScoreHistory, which finds every prior run of the
// *same* session definition for this participant and aligns items
// case/whitespace-insensitively across runs (worksheet-projection.ts).
//
// Deliberately NOT built: matching an item across *different* session
// numbers (e.g. a S02 problem re-appearing in S06) -- the data model has no
// such linkage, and fabricating one would violate the "no invented
// connections" rule this feature is built around. Sessions without a
// configured pair below simply show "not available" rather than a
// half-working table.
const HISTORY_CAPABLE_SESSIONS: Record<string, Array<{ itemsKey: string; scoresKey: string; label: string }>> = {
  "tbct-s02": [
    { itemsKey: "problems", scoresKey: "problemRatings", label: "Problems" },
    { itemsKey: "goals", scoresKey: "goalRatings", label: "Goals" },
  ],
  "tbct-s06": [{ itemsKey: "symptomItems", scoresKey: "symptomItemScores", label: "Symptoms" }],
};

export function sessionSupportsProgressTab(sessionDefinitionId?: string): boolean {
  return Boolean(sessionDefinitionId && HISTORY_CAPABLE_SESSIONS[sessionDefinitionId]);
}

export function SessionProgressPanel({
  runtimeSessionId,
  sessionDefinitionId,
}: {
  runtimeSessionId: string;
  sessionDefinitionId: string;
}) {
  const configs = HISTORY_CAPABLE_SESSIONS[sessionDefinitionId] ?? [];

  if (!configs.length) {
    return (
      <Card>
        <EmptyState
          title="Not available for this session"
          description="Longitudinal ratings are only shown for sessions with repeated, item-matched scoring across runs."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {configs.map((config) => (
        <ProgressTable key={config.itemsKey} runtimeSessionId={runtimeSessionId} sessionDefinitionId={sessionDefinitionId} config={config} />
      ))}
    </div>
  );
}

function ProgressTable({
  runtimeSessionId,
  sessionDefinitionId,
  config,
}: {
  runtimeSessionId: string;
  sessionDefinitionId: string;
  config: { itemsKey: string; scoresKey: string; label: string };
}) {
  const historyQuery = useQuery({
    queryKey: ["worksheet-history", sessionDefinitionId, config.itemsKey, runtimeSessionId],
    queryFn: () =>
      getListScoreHistory({
        runtimeSessionId,
        sessionDefinitionId,
        itemsWorksheetFieldKey: config.itemsKey,
        scoresWorksheetFieldKey: config.scoresKey,
      }),
    refetchInterval: 5000,
  });
  const history = historyQuery.data;

  return (
    <Card>
      <SectionHeader title={config.label} description="Structured ratings tracked across repeated runs of this session." />
      <div className="p-4">
        {!history || history.runs.length < 2 ? (
          <div className="text-sm text-text-muted">Not available yet — needs more than one run of this session with matching items.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.05em] text-text-muted">Item</th>
                  {history.runs.map((run) => (
                    <th key={run.runtimeSessionId} className="px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-[0.05em] text-text-muted">
                      {run.runLabel}
                      {run.startedAt && <div className="mt-0.5 font-normal normal-case text-[10px] text-text-muted">{new Date(run.startedAt).toLocaleDateString()}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={row.item} className="border-t border-border">
                    <td className="px-2 py-1.5 text-text-primary">{row.item}</td>
                    {history.runs.map((run) => (
                      <td key={run.runtimeSessionId} className="px-2 py-1.5 text-center">
                        <ScoreChip score={row.scoresByRunId[run.runtimeSessionId] ?? null} />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 border-border-strong font-semibold">
                  <td className="px-2 py-1.5 text-text-primary">Total</td>
                  {history.runs.map((run) => (
                    <td key={run.runtimeSessionId} className="px-2 py-1.5 text-center text-text-primary">
                      {history.totalsByRunId[run.runtimeSessionId] ?? "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
