"use client";

import { useState } from "react";
import { AppShell } from "@/clinician/components/app-shell";
import { Badge, Button, Card, Field, Modal, PageHeader, SectionHeader, inputClass, textareaClass } from "@/shared/components/ui/primitives";
import { RowsTable, useTrialAction, useTrialQuery } from "@/clinician/pages/trial/trial-ui";
import { useT } from "@/shared/i18n/context";
import type { AdverseEvent, ReviewTask } from "@/types/trial";

const SERIOUS_CRITERIA = ["death", "life_threatening", "hospitalisation", "disability", "other_medically_important"];

/** Review tasks (weekly PHQ-2, suicidality item, C-SSRS, deterioration) and
 * adverse events with their reporting deadlines (clinician, admin). */
export function TrialSafetyPage() {
  const { t } = useT();
  const reviews = useTrialQuery<ReviewTask[]>(["reviews"], { op: "listReviewTasks", status: "open" });
  const events = useTrialQuery<AdverseEvent[]>(["adverse-events"], { op: "listAdverseEvents" });
  const roster = useTrialQuery<Array<{ studyParticipantId: string; studyCode: string; runtimeParticipantId: string }>>(["participants"], { op: "listTrialParticipants" });
  const action = useTrialAction();
  const [reviewTarget, setReviewTarget] = useState<ReviewTask | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const blank = { studyParticipantId: "", detectedAt: new Date().toISOString().slice(0, 16), onsetAt: "", description: "", serious: false, seriousnessCriteria: [] as string[], severity: "mild", relatedness: "not_assessed", outcome: "ongoing", actionTaken: "" };
  const [form, setForm] = useState(blank);
  const codeOf = (id?: string | null) => roster.data?.find((row) => row.studyParticipantId === id)?.studyCode ?? id ?? "—";
  const now = Date.now();

  return (
    <AppShell>
      <PageHeader eyebrow={t("trial.eyebrow")} title={t("trial.safety.title")} description={t("trial.safety.description")} actions={<Button variant="secondary" loading={action.isPending} onClick={() => action.mutate({ op: "checkDeterioration" })}>{t("trial.safety.checkDeterioration")}</Button>} />
      <div className="space-y-4 p-4 lg:p-6">
        <Card>
          <SectionHeader title={t("trial.safety.reviews")} description={t("trial.safety.reviewsHint")} />
          <RowsTable
            rows={(reviews.data ?? []).map((task) => ({ ...task, studyCode: codeOf(task.studyParticipantId), overdue: new Date(task.dueAt).getTime() < now })) as unknown as Array<Record<string, unknown>>}
            columns={["studyCode", "source", "reason", "dueAt", "overdue"]}
            labels={{ studyCode: t("trial.col.studyCode"), source: t("trial.col.source"), reason: t("trial.col.reason"), dueAt: t("trial.col.dueAt"), overdue: t("trial.col.overdue") }}
            empty={t("trial.safety.noReviews")}
            actions={(row) => <Button size="sm" variant="secondary" onClick={() => { setReviewTarget(row as unknown as ReviewTask); setNote(""); }}>{t("trial.safety.resolve")}</Button>}
          />
        </Card>
        <Card>
          <SectionHeader title={t("trial.safety.adverseEvents")} action={<Button size="sm" onClick={() => { setForm(blank); setOpen(true); }}>{t("trial.safety.newAe")}</Button>} />
          <RowsTable
            rows={(events.data ?? []).map((event) => ({ ...event, studyCode: codeOf(event.studyParticipantId) })) as unknown as Array<Record<string, unknown>>}
            columns={["studyCode", "detectedAt", "description", "serious", "severity", "relatedness", "outcome", "reportDueAt", "reportedAt", "status"]}
            labels={{ studyCode: t("trial.col.studyCode"), detectedAt: t("trial.col.detectedAt"), description: t("trial.col.description"), serious: t("trial.col.serious"), severity: t("trial.col.severity"), relatedness: t("trial.col.relatedness"), outcome: t("trial.col.outcome"), reportDueAt: t("trial.col.reportDue"), reportedAt: t("trial.col.reportedAt"), status: t("trial.col.status") }}
            empty={t("trial.safety.noAes")}
            actions={(row) => (
              <div className="flex justify-end gap-1">
                {row.serious === true && !row.reportedAt && <Button size="sm" variant="danger" onClick={() => action.mutate({ op: "updateAdverseEvent", id: String(row.id), patch: { reportedAt: new Date().toISOString() } })}>{t("trial.safety.markReported")}</Button>}
                {row.status === "open" && <Button size="sm" variant="secondary" onClick={() => action.mutate({ op: "updateAdverseEvent", id: String(row.id), patch: { status: "closed" } })}>{t("trial.safety.close")}</Button>}
              </div>
            )}
          />
        </Card>
      </div>

      <Modal open={Boolean(reviewTarget)} onClose={() => setReviewTarget(null)} title={t("trial.safety.resolve")} description={reviewTarget?.reason}>
        <Field label={t("trial.safety.note")}><textarea className={textareaClass} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <Button className="mt-3" loading={action.isPending} disabled={!note.trim()} onClick={() => reviewTarget && action.mutate({ op: "resolveReviewTask", taskId: reviewTarget.id, note: note.trim() }, { onSuccess: () => setReviewTarget(null) })}>{t("trial.save")}</Button>
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title={t("trial.safety.newAe")} description={t("trial.safety.newAeHint")} width="max-w-2xl">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("trial.col.studyCode")}>
            <select className={inputClass} value={form.studyParticipantId} onChange={(event) => setForm({ ...form, studyParticipantId: event.target.value })}>
              <option value="">{t("trial.choose")}</option>
              {roster.data?.map((row) => <option key={row.studyParticipantId} value={row.studyParticipantId}>{row.studyCode}</option>)}
            </select>
          </Field>
          <Field label={t("trial.col.detectedAt")}><input type="datetime-local" className={inputClass} value={form.detectedAt} onChange={(event) => setForm({ ...form, detectedAt: event.target.value })} /></Field>
          <Field label={t("trial.col.onsetAt")}><input type="datetime-local" className={inputClass} value={form.onsetAt} onChange={(event) => setForm({ ...form, onsetAt: event.target.value })} /></Field>
          <Field label={t("trial.col.severity")}>
            <select className={inputClass} value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}>
              {["mild", "moderate", "severe"].map((option) => <option key={option} value={option}>{t(`trial.aeSeverity.${option}`)}</option>)}
            </select>
          </Field>
          <Field label={t("trial.col.relatedness")}>
            <select className={inputClass} value={form.relatedness} onChange={(event) => setForm({ ...form, relatedness: event.target.value })}>
              {["not_assessed", "not_related", "unlikely", "possible", "probable", "definite"].map((option) => <option key={option} value={option}>{t(`trial.relatedness.${option}`)}</option>)}
            </select>
          </Field>
          <Field label={t("trial.col.outcome")}>
            <select className={inputClass} value={form.outcome} onChange={(event) => setForm({ ...form, outcome: event.target.value })}>
              {["ongoing", "recovering", "recovered", "recovered_with_sequelae", "fatal", "unknown"].map((option) => <option key={option} value={option}>{t(`trial.aeOutcome.${option}`)}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2"><Field label={t("trial.col.description")}><textarea className={textareaClass} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.serious} onChange={(event) => setForm({ ...form, serious: event.target.checked })} />{t("trial.safety.serious")}</label>
          {form.serious && (
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              {SERIOUS_CRITERIA.map((criterion) => (
                <label key={criterion} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={form.seriousnessCriteria.includes(criterion)} onChange={(event) => setForm({ ...form, seriousnessCriteria: event.target.checked ? [...form.seriousnessCriteria, criterion] : form.seriousnessCriteria.filter((item) => item !== criterion) })} />
                  {t(`trial.seriousCriteria.${criterion}`)}
                </label>
              ))}
              <Badge tone="warning">{t("trial.safety.deadline")}</Badge>
            </div>
          )}
        </div>
        <Button
          className="mt-4"
          loading={action.isPending}
          disabled={!form.studyParticipantId || !form.description.trim() || (form.serious && !form.seriousnessCriteria.length)}
          onClick={() => action.mutate({
            op: "createAdverseEvent",
            event: {
              studyParticipantId: form.studyParticipantId,
              runtimeParticipantId: roster.data?.find((row) => row.studyParticipantId === form.studyParticipantId)?.runtimeParticipantId ?? null,
              detectedAt: new Date(form.detectedAt).toISOString(),
              onsetAt: form.onsetAt ? new Date(form.onsetAt).toISOString() : null,
              description: form.description.trim(),
              serious: form.serious,
              seriousnessCriteria: form.serious ? form.seriousnessCriteria : [],
              severity: form.severity as AdverseEvent["severity"],
              relatedness: form.relatedness as AdverseEvent["relatedness"],
              outcome: form.outcome as AdverseEvent["outcome"],
              actionTaken: form.actionTaken || null,
            },
          }, { onSuccess: () => setOpen(false) })}
        >
          {t("trial.save")}
        </Button>
      </Modal>
    </AppShell>
  );
}
