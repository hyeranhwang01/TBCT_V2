"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Button, Card, Field, textareaClass } from "@/components/ui/primitives";
import { appendHomeworkEntry, listHomeworkEntries, updateHomeworkRecord } from "@/lib/api/homework-api";
import { useT } from "@/lib/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

type ReadyOutcome = "as_planned" | "partly" | "changed_plan" | "did_not_do_it";
interface OutcomeEntryData { [key: string]: unknown; date: string; outcome: ReadyOutcome; whatHappened?: string }

// S7 -- "Decision Plan": branches on implementationReadiness from the
// session ("ready" | "not_ready"). The proposal's hard rule: if the
// participant was not ready, this page must NEVER show a "try it" prompt --
// that branch only ever asks what would help them revisit the decision,
// never simulates readiness that wasn't actually reached.
export function DecisionPlanHomework({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const ready = session.runtimeContext.fields.implementationReadiness === "ready";
  // Two entirely separate components (not a hook called conditionally
  // inside one) -- each has its own unconditional hook order, which is what
  // React's rules of hooks actually require.
  return ready ? <ReadyView session={session} homework={homework} /> : <NotReadyView session={session} homework={homework} />;
}

function ReadyView({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const fields = session.runtimeContext.fields;
  const proposedActions = fields.proposedActions ? String(fields.proposedActions) : undefined;
  const [outcome, setOutcome] = useState<ReadyOutcome | null>(null);
  const [whatHappened, setWhatHappened] = useState("");

  const outcomesQuery = useQuery({ queryKey: ["homework-entries", homework.id, "outcome"], queryFn: () => listHomeworkEntries(homework.id, "outcome"), refetchInterval: 4000 });
  const outcomes = (outcomesQuery.data ?? []).map((entry) => entry.data as unknown as OutcomeEntryData);

  const saveOutcome = useMutation({
    mutationFn: async () => {
      const data: OutcomeEntryData = { date: new Date().toISOString(), outcome: outcome!, whatHappened: whatHappened || undefined };
      await appendHomeworkEntry(homework.id, "outcome", data);
    },
    onSuccess: () => {
      setOutcome(null);
      setWhatHappened("");
      queryClient.invalidateQueries({ queryKey: ["homework-entries", homework.id, "outcome"] });
    },
  });

  return (
    <PatientShell title={t("homework.s07.title")} progressLabel={t("homework.s07.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">{t("homework.s07.myDecision")}</div>
          <div className="mt-1.5 text-sm text-text-primary">✓ {t("homework.s07.imReady")}</div>
          {fields.desiredOrFearedAction !== undefined && <ReadOnlyRow label={t("homework.s07.action")} value={String(fields.desiredOrFearedAction)} />}
          {proposedActions && <ReadOnlyRow label={t("homework.s07.action")} value={proposedActions} />}
          {fields.implementationPlan !== undefined && <ReadOnlyRow label={t("homework.s07.when")} value={String(fields.implementationPlan)} />}
          {fields.possibleObstacles !== undefined && <ReadOnlyRow label={t("homework.s07.obstacle")} value={String(fields.possibleObstacles)} />}
          {fields.obstacleSolutions !== undefined && <ReadOnlyRow label={t("homework.s07.myResponse")} value={String(fields.obstacleSolutions)} />}
          {fields.supportPeople !== undefined && <ReadOnlyRow label={t("homework.s07.support")} value={String(fields.supportPeople)} />}
          {fields.followUpPlan !== undefined && <ReadOnlyRow label={t("homework.s07.howIllKnow")} value={String(fields.followUpPlan)} />}
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s07.howDidItGo")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["as_planned", "partly", "changed_plan", "did_not_do_it"] as ReadyOutcome[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setOutcome(key)}
                className={`rounded-panel border px-3.5 py-2 text-sm transition ${outcome === key ? "border-clinical-blue bg-clinical-blue-light text-clinical-blue" : "border-border bg-surface text-text-secondary hover:bg-surface-hover"}`}
              >
                {t(`homework.s07.outcome.${key}`)}
              </button>
            ))}
          </div>
          {outcome && (
            <div className="mt-4">
              <Field label={t("homework.s07.whatActuallyHappened")}><textarea className={textareaClass} value={whatHappened} onChange={(event) => setWhatHappened(event.target.value)} /></Field>
              <div className="mt-3"><Button loading={saveOutcome.isPending} onClick={() => saveOutcome.mutate()}>{t("homework.s07.save")}</Button></div>
            </div>
          )}
        </Card>

        {outcomes.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-text-primary">{t("homework.s07.history")}</h2>
            <ul className="mt-3 space-y-2">
              {outcomes.map((entry, index) => (
                <li key={index} className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
                  <div className="font-medium text-text-primary">{t(`homework.s07.outcome.${entry.outcome}`)} · {new Date(entry.date).toLocaleDateString()}</div>
                  {entry.whatHappened && <div className="mt-1 text-text-secondary">{entry.whatHappened}</div>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PatientShell>
  );
}

function NotReadyView({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord }) {
  const { t } = useT();
  const [whatWouldHelp, setWhatWouldHelp] = useState(String(homework.data.whatWouldHelp ?? ""));
  const [support, setSupport] = useState(String(homework.data.support ?? ""));
  const [who, setWho] = useState(String(homework.data.who ?? ""));
  const [when, setWhen] = useState(String(homework.data.when ?? ""));

  const save = useMutation({
    mutationFn: () => updateHomeworkRecord(homework.id, { status: "in_progress", data: { ...homework.data, whatWouldHelp, support, who, when } }),
  });

  return (
    <PatientShell title={t("homework.s07.preparingTitle")} progressLabel={t("homework.s07.eyebrow")}>
      <Card className="p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">{t("homework.s07.myDecision")}</div>
        <div className="mt-1.5 text-sm text-text-primary">{t("homework.s07.notReadyYet")}</div>
        {session.runtimeContext.fields.laterReadinessPreparation !== undefined && (
          <div className="mt-2 rounded-panel border border-border bg-surface-subtle p-3 text-sm text-text-secondary">{String(session.runtimeContext.fields.laterReadinessPreparation)}</div>
        )}
        <div className="mt-4 space-y-3">
          <Field label={t("homework.s07.whatWouldHelp")}><textarea className={textareaClass} value={whatWouldHelp} onChange={(event) => setWhatWouldHelp(event.target.value)} /></Field>
          <Field label={t("homework.s07.whatSupport")}><textarea className={textareaClass} value={support} onChange={(event) => setSupport(event.target.value)} /></Field>
          <Field label={t("homework.s07.whoCouldITalkTo")}><textarea className={textareaClass} value={who} onChange={(event) => setWho(event.target.value)} /></Field>
          <Field label={t("homework.s07.whenMightIRevisit")}><textarea className={textareaClass} value={when} onChange={(event) => setWhen(event.target.value)} /></Field>
        </div>
        <div className="mt-4"><Button loading={save.isPending} onClick={() => save.mutate()}>{t("homework.s07.save")}</Button></div>
      </Card>
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
