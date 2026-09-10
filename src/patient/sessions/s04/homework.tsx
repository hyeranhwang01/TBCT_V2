"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Button, Card, Field, textareaClass } from "@/components/ui/primitives";
import { appendHomeworkEntry, listHomeworkEntries, updateHomeworkRecord } from "@/lib/api/homework-api";
import { useT } from "@/lib/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

type TryOutcome = "as_planned" | "partly" | "not_yet" | "did_not_come_up";
interface AttemptEntryData {
  [key: string]: unknown;
  date: string;
  outcome: TryOutcome;
  whatHappened?: string;
  whatNoticed?: string;
  discussWithTherapist: boolean;
}

const OUTCOME_KEYS: TryOutcome[] = ["as_planned", "partly", "not_yet", "did_not_come_up"];

// S4 -- "Action Plan" follow-up: the session ends with a plan (own behavior
// only, per the manual's explicit caution against planning to change the
// other person). Homework is reporting back on the SAME plan, one or more
// times, not authoring a new one.
export function ActionPlanHomework({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const fields = session.runtimeContext.fields;
  const plannedActions = Array.isArray(fields.plannedActions) ? (fields.plannedActions as string[]) : fields.plannedActions ? [String(fields.plannedActions)] : [];

  const attemptsQuery = useQuery({ queryKey: ["homework-entries", homework.id, "attempt"], queryFn: () => listHomeworkEntries(homework.id, "attempt"), refetchInterval: 4000 });
  const attempts = (attemptsQuery.data ?? []).map((entry) => entry.data as unknown as AttemptEntryData);

  const [outcome, setOutcome] = useState<TryOutcome | null>(null);
  const [whatHappened, setWhatHappened] = useState("");
  const [whatNoticed, setWhatNoticed] = useState("");
  const [discuss, setDiscuss] = useState(false);

  const saveAttempt = useMutation({
    mutationFn: async () => {
      const data: AttemptEntryData = { date: new Date().toISOString(), outcome: outcome!, whatHappened: whatHappened || undefined, whatNoticed: whatNoticed || undefined, discussWithTherapist: discuss };
      await appendHomeworkEntry(homework.id, "attempt", data);
      await updateHomeworkRecord(homework.id, { status: "in_progress" });
    },
    onSuccess: () => {
      setOutcome(null);
      setWhatHappened("");
      setWhatNoticed("");
      setDiscuss(false);
      queryClient.invalidateQueries({ queryKey: ["homework-entries", homework.id, "attempt"] });
    },
  });

  return (
    <PatientShell title={t("homework.s04.title")} progressLabel={t("homework.s04.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">{t("homework.s04.whatICanChange")}</div>
          <ul className="mt-2 space-y-1.5">
            {plannedActions.map((action, index) => <li key={index} className="rounded-panel border border-border bg-surface-subtle p-3 text-sm text-text-primary">{action}</li>)}
          </ul>
          {fields.actionObstacles !== undefined && <ReadOnlyRow label={t("homework.s04.obstacle")} value={String(fields.actionObstacles)} />}
          {fields.obstacleSolutions !== undefined && <ReadOnlyRow label={t("homework.s04.solution")} value={String(fields.obstacleSolutions)} />}
          {fields.implementationTiming !== undefined && <ReadOnlyRow label={t("homework.s04.when")} value={String(fields.implementationTiming)} />}
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s04.didYouTry")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {OUTCOME_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setOutcome(key)}
                className={`rounded-panel border px-3.5 py-2 text-sm transition ${outcome === key ? "border-clinical-blue bg-clinical-blue-light text-clinical-blue" : "border-border bg-surface text-text-secondary hover:bg-surface-hover"}`}
              >
                {t(`homework.s04.outcome.${key}`)}
              </button>
            ))}
          </div>
          {outcome && outcome !== "did_not_come_up" && (
            <div className="mt-4 space-y-3">
              <Field label={t("homework.s04.whatHappened")}><textarea className={textareaClass} value={whatHappened} onChange={(event) => setWhatHappened(event.target.value)} /></Field>
              <Field label={t("homework.s04.whatNoticed")}><textarea className={textareaClass} value={whatNoticed} onChange={(event) => setWhatNoticed(event.target.value)} /></Field>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input type="checkbox" checked={discuss} onChange={(event) => setDiscuss(event.target.checked)} />
                {t("homework.s04.discussWithTherapist")}
              </label>
            </div>
          )}
          {outcome && <div className="mt-4"><Button onClick={() => saveAttempt.mutate()} loading={saveAttempt.isPending}>{t("homework.s04.save")}</Button></div>}
        </Card>

        {attempts.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-text-primary">{t("homework.s04.history")}</h2>
            <ul className="mt-3 space-y-2">
              {attempts.map((attempt, index) => (
                <li key={index} className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
                  <div className="font-medium text-text-primary">{t(`homework.s04.outcome.${attempt.outcome}`)} · {new Date(attempt.date).toLocaleDateString()}</div>
                  {attempt.whatHappened && <div className="mt-1 text-text-secondary">{attempt.whatHappened}</div>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PatientShell>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">{label}</div>
      <div className="mt-1 rounded-panel border border-border bg-surface-subtle p-3 text-sm text-text-primary">{value}</div>
    </div>
  );
}
