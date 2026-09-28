"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientShell } from "@/patient/components/patient-shell";
import { Badge, Button, Card, EmptyState, Field, Modal, PageSkeleton, inputClass } from "@/shared/components/ui/primitives";
import { AssessmentForm } from "@/shared/components/trial/assessment-form";
import { callTrialStore } from "@/shared/data/repositories/trial-repository";
import { useT } from "@/shared/i18n/context";
import type { ArmCode, AssessmentTask, StudyVisit } from "@/types/trial";

type MyStatus = { studyCode: string; status: string; armCode: ArmCode | null; visits: StudyVisit[]; dueAssessments: AssessmentTask[] } | null;

/** The participant's own part of the study (.claude/TASK_SCOPE.json
 * note2026_09_28_rct_backend): their schedule, the questionnaires due now,
 * and -- in the therapist-only arm -- the weekly homework log. */
export function PatientStudyPage() {
  const { t } = useT();
  const client = useQueryClient();
  const status = useQuery({ queryKey: ["my-trial-status"], queryFn: () => callTrialStore<MyStatus>({ op: "getMyTrialStatus" }) });
  const [target, setTarget] = useState<AssessmentTask | null>(null);
  const [homework, setHomework] = useState({ week: "", minutes: "", completed: true });
  const done = async () => {
    toast.success(t("patientStudy.saved"));
    await client.invalidateQueries({ queryKey: ["my-trial-status"] });
  };
  const submit = useMutation({
    mutationFn: (input: { taskId: string; items: unknown[] }) => callTrialStore({ op: "submitAssessmentResponse", response: input }),
    onSuccess: async () => { setTarget(null); await done(); },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : t("patientStudy.failed")),
  });
  const logHomework = useMutation({
    mutationFn: () => callTrialStore({ op: "logHomework", log: { week: Number(homework.week), minutes: Number(homework.minutes), completed: homework.completed } }),
    onSuccess: async () => { setHomework({ week: "", minutes: "", completed: true }); await done(); },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : t("patientStudy.failed")),
  });

  if (status.isLoading) return <PatientShell title={t("patientStudy.title")}><PageSkeleton /></PatientShell>;
  const mine = status.data;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <PatientShell title={t("patientStudy.title")}>
      <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-8">
        {!mine ? (
          <Card><EmptyState title={t("patientStudy.notEnrolledTitle")} description={t("patientStudy.notEnrolled")} /></Card>
        ) : (
          <>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{mine.studyCode}</span>
                <Badge tone="primary">{t(`trial.status.${mine.status}`)}</Badge>
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-base font-semibold">{t("patientStudy.questionnaires")}</h2>
              {mine.dueAssessments.length === 0 ? (
                <p className="text-sm text-text-secondary">{t("patientStudy.noQuestionnaires")}</p>
              ) : (
                <ul className="space-y-2">
                  {mine.dueAssessments.map((task) => {
                    const open = today >= task.windowStart && today <= task.windowEnd;
                    return (
                      <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-border p-3 text-sm">
                        <div>
                          <div className="font-medium">{t(`trial.instrument.${task.instrumentCode}`)}</div>
                          <div className="text-xs text-text-secondary">{t(`trial.timepoint.${task.timepointCode}`)} · {task.windowStart} – {task.windowEnd}</div>
                        </div>
                        {open ? <Button size="sm" onClick={() => setTarget(task)}>{t("patientStudy.answer")}</Button> : <Badge>{today < task.windowStart ? t("patientStudy.upcoming") : t("patientStudy.closed")}</Badge>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {mine.visits.length > 0 && (
              <Card className="p-4">
                <h2 className="mb-3 text-base font-semibold">{t("patientStudy.schedule")}</h2>
                <ul className="divide-y divide-border text-sm">
                  {mine.visits.map((visit) => (
                    <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{t(`trial.visitType.${visit.visitType}`)}{visit.number ? ` ${visit.number}` : ""}</span>
                      <span className="text-xs text-text-secondary">{visit.windowStart} – {visit.windowEnd}</span>
                      <Badge tone={visit.status === "completed" ? "success" : visit.status === "scheduled" ? "neutral" : "warning"}>{t(`trial.visitStatus.${visit.status}`)}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {mine.status === "allocated" && mine.armCode === "CLINICIAN_ONLY" && (
              <Card className="p-4">
                <h2 className="mb-1 text-base font-semibold">{t("patientStudy.homework")}</h2>
                <p className="mb-3 text-xs text-text-secondary">{t("patientStudy.homeworkHint")}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t("trial.col.week")}><input className={`${inputClass} w-24`} inputMode="numeric" value={homework.week} onChange={(event) => setHomework({ ...homework, week: event.target.value })} /></Field>
                  <Field label={t("trial.col.minutes")}><input className={`${inputClass} w-24`} inputMode="numeric" value={homework.minutes} onChange={(event) => setHomework({ ...homework, minutes: event.target.value })} /></Field>
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={homework.completed} onChange={(event) => setHomework({ ...homework, completed: event.target.checked })} />{t("trial.detail.homeworkDone")}</label>
                  <Button loading={logHomework.isPending} disabled={!homework.week || !homework.minutes} onClick={() => logHomework.mutate()}>{t("trial.save")}</Button>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
      <Modal open={Boolean(target)} onClose={() => setTarget(null)} title={target ? t(`trial.instrument.${target.instrumentCode}`) : ""} description={t("patientStudy.answerHint")} width="max-w-2xl">
        {target && <AssessmentForm key={target.id} instrumentCode={target.instrumentCode} submitting={submit.isPending} onSubmit={(items) => submit.mutate({ taskId: target.id, items })} />}
      </Modal>
    </PatientShell>
  );
}
