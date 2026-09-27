"use client";

import { useState } from "react";
import { AppShell } from "@/clinician/components/app-shell";
import { Button, Card, Modal, PageHeader, SectionHeader } from "@/shared/components/ui/primitives";
import { AssessmentForm } from "@/shared/components/trial/assessment-form";
import { RowsTable, useTrialAction, useTrialQuery } from "@/clinician/pages/trial/trial-ui";
import { useT } from "@/shared/i18n/context";
import type { AssessmentTask } from "@/types/trial";

/** The blinded outcome assessor's worklist (Protocol V9 p.9): the roster
 * without arms, and the interview instruments due. The store never sends
 * this role an arm, a conversation or a self-report task. */
export function AssessorWorklistPage() {
  const { t } = useT();
  const roster = useTrialQuery<Array<Record<string, unknown>>>(["blinded"], { op: "listBlindedParticipants" });
  const tasks = useTrialQuery<Array<AssessmentTask & { studyCode: string }>>(["interview-tasks"], { op: "listAssessmentTasks", mode: "interview" });
  const [target, setTarget] = useState<(AssessmentTask & { studyCode: string }) | null>(null);
  const submit = useTrialAction(() => setTarget(null));
  const due = (tasks.data ?? []).filter((task) => task.status === "due");

  return (
    <AppShell>
      <PageHeader eyebrow={t("trial.eyebrow")} title={t("trial.assessor.title")} description={t("trial.assessor.description")} />
      <div className="space-y-4 p-4 lg:p-6">
        <Card>
          <SectionHeader title={t("trial.assessor.due")} />
          <RowsTable
            rows={due as unknown as Array<Record<string, unknown>>}
            columns={["studyCode", "timepointCode", "instrumentCode", "windowStart", "windowEnd"]}
            labels={{ studyCode: t("trial.col.studyCode"), timepointCode: t("trial.col.timepoint"), instrumentCode: t("trial.col.instrument"), windowStart: t("trial.col.windowStart"), windowEnd: t("trial.col.windowEnd") }}
            empty={tasks.isLoading ? t("trial.loading") : t("trial.assessor.none")}
            actions={(row) => <Button size="sm" onClick={() => setTarget(row as unknown as AssessmentTask & { studyCode: string })}>{t("trial.assessor.enter")}</Button>}
          />
        </Card>
        <Card>
          <SectionHeader title={t("trial.assessor.roster")} />
          <RowsTable
            rows={roster.data ?? []}
            columns={["studyCode", "siteCode", "diagnosisStratum", "status", "enrolledAt", "assessmentsCompleted", "assessmentsDue"]}
            labels={{ studyCode: t("trial.col.studyCode"), siteCode: t("trial.col.site"), diagnosisStratum: t("trial.col.stratum"), status: t("trial.col.status"), enrolledAt: t("trial.col.enrolledAt"), assessmentsCompleted: t("trial.col.assessmentsDone"), assessmentsDue: t("trial.col.assessmentsDue") }}
            empty={t("trial.participants.empty")}
          />
        </Card>
      </div>
      <Modal open={Boolean(target)} onClose={() => setTarget(null)} title={target ? `${target.studyCode} · ${target.instrumentCode}` : ""} description={target ? t(`trial.timepoint.${target.timepointCode}`) : undefined} width="max-w-2xl">
        {target && <AssessmentForm key={target.id} instrumentCode={target.instrumentCode} submitting={submit.isPending} onSubmit={(items) => submit.mutate({ op: "submitAssessmentResponse", response: { taskId: target.id, items } })} />}
      </Modal>
    </AppShell>
  );
}
