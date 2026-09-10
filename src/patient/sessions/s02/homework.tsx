"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives";
import { appendHomeworkEntry, listHomeworkEntries } from "@/lib/api/homework-api";
import { useT } from "@/lib/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

interface CheckInRoundData {
  [key: string]: unknown;
  date: string;
  itemType: "problem" | "goal";
  ratings: Record<string, number>; // item label -> fresh 0-5 rating
}

function RatingRow({ label, value, onChange, disabled }: { label: string; value?: number; onChange: (score: number) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-panel border border-border bg-surface-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-text-primary">{label}</div>
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            disabled={disabled}
            onClick={() => onChange(score)}
            className={`h-8 w-8 rounded-panel border text-sm font-semibold transition ${value === score ? "border-clinical-blue bg-clinical-blue text-white" : "border-border bg-surface text-text-secondary hover:bg-surface-hover"}`}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}

// S2 -- "Check-in": re-rates each problem/goal without showing the previous
// score first (the proposal's key rule), then reveals the full before/after
// "journey" once every item this round has a fresh rating.
export function CheckInHomework({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const problems = Array.isArray(session.runtimeContext.fields.problems) ? (session.runtimeContext.fields.problems as string[]) : [];
  const goals = Array.isArray(session.runtimeContext.fields.goals) ? (session.runtimeContext.fields.goals as string[]) : [];
  const baselineProblemRatings = Array.isArray(session.runtimeContext.fields.problemRatings) ? (session.runtimeContext.fields.problemRatings as number[]) : [];
  const baselineGoalRatings = Array.isArray(session.runtimeContext.fields.goalRatings) ? (session.runtimeContext.fields.goalRatings as number[]) : [];

  const roundsQuery = useQuery({ queryKey: ["homework-entries", homework.id, "checkin_round"], queryFn: () => listHomeworkEntries(homework.id, "checkin_round"), refetchInterval: 4000 });
  const rounds = useMemo(() => (roundsQuery.data ?? []).map((entry) => entry.data as unknown as CheckInRoundData), [roundsQuery.data]);

  const [draft, setDraft] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState(false);

  const allItems = [...problems.map((label) => ({ label, itemType: "problem" as const })), ...goals.map((label) => ({ label, itemType: "goal" as const }))];
  const allRated = allItems.length > 0 && allItems.every((item) => draft[item.label] !== undefined);

  const saveRound = useMutation({
    mutationFn: async () => {
      const problemRatings: CheckInRoundData = { date: new Date().toISOString(), itemType: "problem", ratings: Object.fromEntries(problems.map((label) => [label, draft[label]])) };
      const goalRatings: CheckInRoundData = { date: new Date().toISOString(), itemType: "goal", ratings: Object.fromEntries(goals.map((label) => [label, draft[label]])) };
      if (problems.length) await appendHomeworkEntry(homework.id, "checkin_round", problemRatings);
      if (goals.length) await appendHomeworkEntry(homework.id, "checkin_round", goalRatings);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["homework-entries", homework.id, "checkin_round"] }),
  });

  function journeyFor(label: string, baseline: number | undefined) {
    const history = rounds.flatMap((round) => (round.ratings[label] !== undefined ? [round.ratings[label]] : []));
    return [baseline, ...history].filter((value): value is number => value !== undefined);
  }

  return (
    <PatientShell title={t("homework.s02.title")} progressLabel={t("homework.s02.eyebrow")}>
      <div className="space-y-5">
        {!revealed ? (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-text-primary">{t("homework.s02.question")}</h2>
            <p className="mt-1 text-sm text-text-secondary">{t("homework.s02.hint")}</p>
            <div className="mt-4 space-y-4">
              {problems.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">{t("homework.s02.problems")}</div>
                  <div className="space-y-2">
                    {problems.map((label) => <RatingRow key={label} label={label} value={draft[label]} onChange={(score) => setDraft((prev) => ({ ...prev, [label]: score }))} />)}
                  </div>
                </div>
              )}
              {goals.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">{t("homework.s02.goals")}</div>
                  <div className="space-y-2">
                    {goals.map((label) => <RatingRow key={label} label={label} value={draft[label]} onChange={(score) => setDraft((prev) => ({ ...prev, [label]: score }))} />)}
                  </div>
                </div>
              )}
              {allItems.length === 0 && <EmptyState title={t("homework.s02.noItems")} description="" />}
            </div>
            {allItems.length > 0 && (
              <div className="mt-5">
                <Button
                  disabled={!allRated}
                  loading={saveRound.isPending}
                  onClick={async () => {
                    await saveRound.mutateAsync();
                    setRevealed(true);
                  }}
                >
                  {t("homework.s02.seeJourney")}
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-text-primary">{t("homework.s02.journeyTitle")}</h2>
            <div className="mt-4 space-y-3">
              {allItems.map((item, index) => {
                const baseline = item.itemType === "problem" ? baselineProblemRatings[problems.indexOf(item.label)] : baselineGoalRatings[goals.indexOf(item.label)];
                const path = journeyFor(item.label, baseline);
                return (
                  <div key={index} className="rounded-panel border border-border bg-surface-subtle p-3">
                    <div className="text-sm font-medium text-text-primary">{item.label}</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-text-secondary">
                      {path.map((score, i) => (
                        <span key={i} className="flex items-center gap-2">
                          {i > 0 && <span className="text-text-muted">→</span>}
                          <Badge tone={i === path.length - 1 ? "primary" : "neutral"}>{score}</Badge>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5"><Button variant="secondary" onClick={() => { setRevealed(false); setDraft({}); }}>{t("homework.s02.checkInAgain")}</Button></div>
          </Card>
        )}
      </div>
    </PatientShell>
  );
}
