"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/clinician/components/app-shell";
import { Badge, Button, Card, Field, Modal, PageHeader, SectionHeader, inputClass, textareaClass } from "@/shared/components/ui/primitives";
import { AssessmentForm } from "@/shared/components/trial/assessment-form";
import { RowsTable, useTrialAction, useTrialQuery } from "@/clinician/pages/trial/trial-ui";
import { SCREENING_CRITERIA } from "@/shared/trial/default-study-config";
import { useAuth } from "@/shared/auth/auth-context";
import { useT } from "@/shared/i18n/context";
import type { Allocation, AssessmentTask, ConsentType, EligibilityDecision, ProtocolDeviation, Screening, StudyConsent, StudyParticipant, StudyVisit, Therapist, Withdrawal } from "@/types/trial";

type Detail = {
  participant: StudyParticipant;
  screenings: Screening[];
  eligibility: EligibilityDecision[];
  consents: StudyConsent[];
  withdrawals: Withdrawal[];
  allocation: Allocation | null;
  visits: StudyVisit[];
  tasks: AssessmentTask[];
  deviations: ProtocolDeviation[];
};

const DEVIATION_CATEGORIES = ["eligibility", "consent", "randomization", "visit_window", "intervention", "ai_release_change", "assessment", "safety_reporting", "data", "other"];
const WITHDRAWAL_REASONS = ["participant_choice", "adverse_event", "suicidality", "lost_to_follow_up", "investigator_decision", "other"] as const;

/** One study participant through the trial: screening, eligibility,
 * consent, enrolment, allocation, the visit schedule and attendance,
 * assessments, deviations and withdrawal. */
export function TrialParticipantDetailPage() {
  const { t } = useT();
  const { role } = useAuth();
  const id = decodeURIComponent(usePathname().split("/").filter(Boolean).pop() ?? "");
  const detail = useTrialQuery<Detail>(["participant", id], id ? { op: "getTrialParticipant", studyParticipantId: id } : null);
  const context = useTrialQuery<{ therapists: Therapist[] }>(["context"], { op: "getStudyContext" });
  const action = useTrialAction();
  const [criteria, setCriteria] = useState<Record<string, boolean>>({});
  const [screening, setScreening] = useState({ phq9Total: "", gad7Total: "", cssrsRisk: "" });
  const [eligibility, setEligibility] = useState({ decision: "eligible", reasons: "", overrideReason: "" });
  const [consent, setConsent] = useState({ consentType: "main", version: "", status: "granted", method: "written" });
  const [withdrawal, setWithdrawal] = useState({ reasonCategory: "participant_choice", initiatedBy: "participant", dataDisposition: "retain_collected", reasonText: "" });
  const [deviation, setDeviation] = useState({ category: "other", severity: "minor", description: "" });
  const [homework, setHomework] = useState({ week: "", minutes: "", completed: true });
  const [visitTarget, setVisitTarget] = useState<StudyVisit | null>(null);
  const [visitForm, setVisitForm] = useState({ status: "completed", durationMinutes: "", modality: "video" });
  const [taskTarget, setTaskTarget] = useState<AssessmentTask | null>(null);

  if (!detail.data) {
    return <AppShell><PageHeader title={t("trial.detail.title")} description={detail.isLoading ? t("trial.loading") : detail.error instanceof Error ? detail.error.message : ""} /></AppShell>;
  }
  const { participant, allocation } = detail.data;
  const status = participant.status;
  const latestConsent = (type: ConsentType) => [...detail.data!.consents].reverse().find((item) => item.consentType === type);
  const canExport = role === "clinician" || role === "admin";
  const exportHref = (format: "json" | "csv", attempts: "all" | "official") => `/api/session-records/export?participantId=${encodeURIComponent(participant.runtimeParticipantId)}&format=${format}&attempts=${attempts}`;

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("trial.eyebrow")}
        title={participant.studyCode}
        description={t("trial.detail.description")}
        meta={
          <>
            <Badge tone="primary">{t(`trial.status.${status}`)}</Badge>
            {participant.diagnosisStratum && <Badge>{t(`trial.stratum.${participant.diagnosisStratum}`)}</Badge>}
            {allocation && <Badge tone="success">{t(`trial.arm.${allocation.armCode}`)}</Badge>}
          </>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        {status === "screening" && (
          <Card>
            <SectionHeader title={t("trial.detail.screening")} description={t("trial.detail.screeningHint")} />
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {SCREENING_CRITERIA.map((criterion) => (
                <label key={criterion.code} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={criteria[criterion.code] ?? false} onChange={(event) => setCriteria({ ...criteria, [criterion.code]: event.target.checked })} />
                  <span>{t(`trial.criteria.${criterion.code}`)}</span>
                </label>
              ))}
            </div>
            <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
              <Field label="PHQ-9"><input className={inputClass} inputMode="numeric" value={screening.phq9Total} onChange={(event) => setScreening({ ...screening, phq9Total: event.target.value })} /></Field>
              <Field label="GAD-7"><input className={inputClass} inputMode="numeric" value={screening.gad7Total} onChange={(event) => setScreening({ ...screening, gad7Total: event.target.value })} /></Field>
              <Field label="C-SSRS">
                <select className={inputClass} value={screening.cssrsRisk} onChange={(event) => setScreening({ ...screening, cssrsRisk: event.target.value })}>
                  <option value="">—</option>
                  {["none", "low", "moderate", "high"].map((risk) => <option key={risk} value={risk}>{t(`trial.risk.${risk}`)}</option>)}
                </select>
              </Field>
              <div className="flex items-end">
                <Button
                  loading={action.isPending}
                  onClick={() => action.mutate({
                    op: "recordScreening",
                    screening: {
                      studyParticipantId: participant.id,
                      criteria: SCREENING_CRITERIA.map((criterion) => ({ code: criterion.code, met: criteria[criterion.code] ?? false })),
                      phq9Total: screening.phq9Total ? Number(screening.phq9Total) : null,
                      gad7Total: screening.gad7Total ? Number(screening.gad7Total) : null,
                      cssrsRisk: (screening.cssrsRisk || null) as Screening["cssrsRisk"],
                    },
                  })}
                >
                  {t("trial.detail.saveScreening")}
                </Button>
              </div>
            </div>
            {detail.data.screenings.length > 0 && (
              <div className="border-t border-border p-4">
                <p className="mb-3 text-sm">{t("trial.detail.lastScreening", { result: t(`trial.result.${detail.data.screenings[detail.data.screenings.length - 1].result}`) })}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t("trial.detail.decision")}>
                    <select className={inputClass} value={eligibility.decision} onChange={(event) => setEligibility({ ...eligibility, decision: event.target.value })}>
                      <option value="eligible">{t("trial.status.eligible")}</option>
                      <option value="ineligible">{t("trial.status.ineligible")}</option>
                    </select>
                  </Field>
                  <Field label={t("trial.detail.reasons")}><input className={inputClass} value={eligibility.reasons} onChange={(event) => setEligibility({ ...eligibility, reasons: event.target.value })} /></Field>
                  <Field label={t("trial.detail.overrideReason")} hint={t("trial.detail.overrideHint")}><input className={inputClass} value={eligibility.overrideReason} onChange={(event) => setEligibility({ ...eligibility, overrideReason: event.target.value })} /></Field>
                </div>
                <Button
                  className="mt-3"
                  loading={action.isPending}
                  onClick={() => action.mutate({ op: "decideEligibility", studyParticipantId: participant.id, decision: eligibility.decision as "eligible" | "ineligible", reasons: eligibility.reasons.split(",").map((item) => item.trim()).filter(Boolean), overrideReason: eligibility.overrideReason.trim() || undefined })}
                >
                  {t("trial.detail.saveDecision")}
                </Button>
              </div>
            )}
          </Card>
        )}

        <Card>
          <SectionHeader title={t("trial.detail.consentAndEnrolment")} />
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            {(["main", "ai_interaction_logging", "extended_retention"] as const).map((type) => {
              const current = latestConsent(type);
              return (
                <div key={type} className="rounded-panel border border-border p-3 text-sm">
                  <div className="font-semibold">{t(`trial.consent.${type}`)}</div>
                  <div className="mt-1 text-xs text-text-secondary">{current ? `${t(`trial.consentStatus.${current.status}`)} · v${current.version} · ${current.decidedAt.slice(0, 10)}` : t("trial.consentStatus.none")}</div>
                </div>
              );
            })}
          </div>
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-5">
            <Field label={t("trial.detail.consentType")}>
              <select className={inputClass} value={consent.consentType} onChange={(event) => setConsent({ ...consent, consentType: event.target.value })}>
                {["main", "ai_interaction_logging", "extended_retention"].map((type) => <option key={type} value={type}>{t(`trial.consent.${type}`)}</option>)}
              </select>
            </Field>
            <Field label={t("trial.detail.formVersion")}><input className={inputClass} value={consent.version} onChange={(event) => setConsent({ ...consent, version: event.target.value })} /></Field>
            <Field label={t("trial.col.status")}>
              <select className={inputClass} value={consent.status} onChange={(event) => setConsent({ ...consent, status: event.target.value })}>
                <option value="granted">{t("trial.consentStatus.granted")}</option>
                <option value="withdrawn">{t("trial.consentStatus.withdrawn")}</option>
              </select>
            </Field>
            <Field label={t("trial.detail.method")}>
              <select className={inputClass} value={consent.method} onChange={(event) => setConsent({ ...consent, method: event.target.value })}>
                <option value="written">{t("trial.method.written")}</option>
                <option value="electronic">{t("trial.method.electronic")}</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Button loading={action.isPending} disabled={!consent.version.trim()} onClick={() => action.mutate({ op: "recordConsent", consent: { studyParticipantId: participant.id, consentType: consent.consentType as ConsentType, version: consent.version.trim(), status: consent.status as "granted" | "withdrawn", method: consent.method as "written" | "electronic" } })}>
                {t("trial.detail.saveConsent")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            {!allocation && (
              <Field label={t("trial.col.stratum")}>
                <select className={inputClass} value={participant.diagnosisStratum ?? ""} onChange={(event) => event.target.value && action.mutate({ op: "setDiagnosisStratum", studyParticipantId: participant.id, diagnosisStratum: event.target.value as "MDD" | "ANXIETY" })}>
                  <option value="">—</option>
                  <option value="MDD">{t("trial.stratum.MDD")}</option>
                  <option value="ANXIETY">{t("trial.stratum.ANXIETY")}</option>
                </select>
              </Field>
            )}
            {status === "eligible" && <Button loading={action.isPending} onClick={() => action.mutate({ op: "enrollParticipant", studyParticipantId: participant.id })}>{t("trial.detail.enroll")}</Button>}
            {status === "enrolled" && (
              <Button loading={action.isPending} onClick={() => window.confirm(t("trial.detail.allocateConfirm")) && action.mutate({ op: "allocateParticipant", studyParticipantId: participant.id })}>{t("trial.detail.allocate")}</Button>
            )}
            <Field label={t("trial.detail.therapist")}>
              <select className={inputClass} value={participant.therapistId ?? ""} onChange={(event) => event.target.value && action.mutate({ op: "assignTherapist", studyParticipantId: participant.id, therapistId: event.target.value })}>
                <option value="">—</option>
                {context.data?.therapists.filter((therapist) => therapist.siteId === participant.siteId).map((therapist) => <option key={therapist.id} value={therapist.id}>{therapist.displayName}</option>)}
              </select>
            </Field>
            {status === "allocated" && <Button variant="secondary" loading={action.isPending} onClick={() => window.confirm(t("trial.detail.completeConfirm")) && action.mutate({ op: "completeParticipant", studyParticipantId: participant.id })}>{t("trial.detail.complete")}</Button>}
          </div>
        </Card>

        {detail.data.visits.length > 0 && (
          <Card>
            <SectionHeader title={t("trial.detail.visits")} description={t("trial.detail.visitsHint")} />
            <RowsTable
              rows={detail.data.visits as unknown as Array<Record<string, unknown>>}
              columns={["visitType", "number", "aiModuleNumber", "windowStart", "windowEnd", "status", "attended", "durationMinutes", "modality", "runtimeSessionId"]}
              labels={{ visitType: t("trial.col.visitType"), number: "#", aiModuleNumber: t("trial.col.aiModule"), windowStart: t("trial.col.windowStart"), windowEnd: t("trial.col.windowEnd"), status: t("trial.col.status"), attended: t("trial.col.attended"), durationMinutes: t("trial.col.minutes"), modality: t("trial.col.modality"), runtimeSessionId: t("trial.col.aiSession") }}
              empty=""
              actions={(row) => (row.status === "scheduled" && row.visitType !== "ai_session" && row.visitType !== "between_module"
                ? <Button size="sm" variant="secondary" onClick={() => { setVisitTarget(row as unknown as StudyVisit); setVisitForm({ status: "completed", durationMinutes: "", modality: "video" }); }}>{t("trial.detail.record")}</Button>
                : null)}
            />
          </Card>
        )}

        {status === "allocated" && allocation?.armCode === "CLINICIAN_ONLY" && (
          <Card>
            <SectionHeader title={t("trial.detail.homework")} description={t("trial.detail.homeworkHint")} />
            <div className="flex flex-wrap items-end gap-3 p-4">
              <Field label={t("trial.col.week")}><input className={`${inputClass} w-24`} inputMode="numeric" value={homework.week} onChange={(event) => setHomework({ ...homework, week: event.target.value })} /></Field>
              <Field label={t("trial.col.minutes")}><input className={`${inputClass} w-24`} inputMode="numeric" value={homework.minutes} onChange={(event) => setHomework({ ...homework, minutes: event.target.value })} /></Field>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={homework.completed} onChange={(event) => setHomework({ ...homework, completed: event.target.checked })} />{t("trial.detail.homeworkDone")}</label>
              <Button loading={action.isPending} disabled={!homework.week || !homework.minutes} onClick={() => action.mutate({ op: "logHomework", log: { studyParticipantId: participant.id, week: Number(homework.week), minutes: Number(homework.minutes), completed: homework.completed } })}>{t("trial.save")}</Button>
            </div>
          </Card>
        )}

        <Card>
          <SectionHeader title={t("trial.detail.assessments")} />
          <RowsTable
            rows={detail.data.tasks as unknown as Array<Record<string, unknown>>}
            columns={["timepointCode", "occurrence", "instrumentCode", "mode", "windowStart", "windowEnd", "status"]}
            labels={{ timepointCode: t("trial.col.timepoint"), occurrence: "#", instrumentCode: t("trial.col.instrument"), mode: t("trial.col.mode"), windowStart: t("trial.col.windowStart"), windowEnd: t("trial.col.windowEnd"), status: t("trial.col.status") }}
            empty={t("trial.detail.noTasks")}
            actions={(row) => (row.status === "due" && row.mode === "self" ? <Button size="sm" variant="secondary" onClick={() => setTaskTarget(row as unknown as AssessmentTask)}>{t("trial.detail.enterPaper")}</Button> : null)}
          />
        </Card>

        <Card>
          <SectionHeader title={t("trial.detail.deviations")} />
          <RowsTable
            rows={detail.data.deviations as unknown as Array<Record<string, unknown>>}
            columns={["detectedAt", "category", "severity", "description", "status", "correctiveAction"]}
            labels={{ detectedAt: t("trial.col.date"), category: t("trial.col.category"), severity: t("trial.col.severity"), description: t("trial.col.description"), status: t("trial.col.status"), correctiveAction: t("trial.col.action") }}
            empty={t("trial.detail.noDeviations")}
          />
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
            <Field label={t("trial.col.category")}>
              <select className={inputClass} value={deviation.category} onChange={(event) => setDeviation({ ...deviation, category: event.target.value })}>
                {DEVIATION_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </Field>
            <Field label={t("trial.col.severity")}>
              <select className={inputClass} value={deviation.severity} onChange={(event) => setDeviation({ ...deviation, severity: event.target.value })}>
                <option value="minor">{t("trial.severity.minor")}</option>
                <option value="major">{t("trial.severity.major")}</option>
              </select>
            </Field>
            <Field label={t("trial.col.description")}><input className={inputClass} value={deviation.description} onChange={(event) => setDeviation({ ...deviation, description: event.target.value })} /></Field>
            <div className="flex items-end">
              <Button loading={action.isPending} disabled={!deviation.description.trim()} onClick={() => action.mutate({ op: "createDeviation", deviation: { studyParticipantId: participant.id, category: deviation.category, severity: deviation.severity as "minor" | "major", description: deviation.description.trim() } })}>{t("trial.detail.addDeviation")}</Button>
            </div>
          </div>
        </Card>

        {canExport && (
          <Card>
            <SectionHeader title={t("trial.detail.records")} description={t("trial.detail.recordsHint")} />
            <div className="flex flex-wrap gap-2 p-4">
              <a href={exportHref("json", "all")}><Button variant="secondary">{t("trial.detail.exportJsonAll")}</Button></a>
              <a href={exportHref("csv", "all")}><Button variant="secondary">{t("trial.detail.exportCsvAll")}</Button></a>
              <a href={exportHref("csv", "official")}><Button variant="secondary">{t("trial.detail.exportCsvOfficial")}</Button></a>
            </div>
          </Card>
        )}

        {status !== "withdrawn" && status !== "completed" && status !== "ineligible" && (
          <Card>
            <SectionHeader title={t("trial.detail.withdraw")} description={t("trial.detail.withdrawHint")} />
            <div className="grid gap-3 p-4 sm:grid-cols-4">
              <Field label={t("trial.detail.reason")}>
                <select className={inputClass} value={withdrawal.reasonCategory} onChange={(event) => setWithdrawal({ ...withdrawal, reasonCategory: event.target.value })}>
                  {WITHDRAWAL_REASONS.map((reason) => <option key={reason} value={reason}>{t(`trial.withdrawReason.${reason}`)}</option>)}
                </select>
              </Field>
              <Field label={t("trial.detail.initiatedBy")}>
                <select className={inputClass} value={withdrawal.initiatedBy} onChange={(event) => setWithdrawal({ ...withdrawal, initiatedBy: event.target.value })}>
                  {["participant", "investigator", "safety"].map((who) => <option key={who} value={who}>{t(`trial.initiatedBy.${who}`)}</option>)}
                </select>
              </Field>
              <Field label={t("trial.detail.dataDisposition")}>
                <select className={inputClass} value={withdrawal.dataDisposition} onChange={(event) => setWithdrawal({ ...withdrawal, dataDisposition: event.target.value })}>
                  {["retain_collected", "exclude_from_analysis", "erasure_requested"].map((option) => <option key={option} value={option}>{t(`trial.disposition.${option}`)}</option>)}
                </select>
              </Field>
              <Field label={t("trial.col.description")}><textarea className={`${textareaClass} min-h-9`} value={withdrawal.reasonText} onChange={(event) => setWithdrawal({ ...withdrawal, reasonText: event.target.value })} /></Field>
            </div>
            <div className="px-4 pb-4">
              <Button
                variant="danger"
                loading={action.isPending}
                onClick={() => window.confirm(t("trial.detail.withdrawConfirm")) && action.mutate({
                  op: "withdrawParticipant",
                  withdrawal: { studyParticipantId: participant.id, reasonCategory: withdrawal.reasonCategory as Withdrawal["reasonCategory"], initiatedBy: withdrawal.initiatedBy as Withdrawal["initiatedBy"], dataDisposition: withdrawal.dataDisposition as Withdrawal["dataDisposition"], reasonText: withdrawal.reasonText.trim() || null },
                })}
              >
                {t("trial.detail.withdrawButton")}
              </Button>
            </div>
          </Card>
        )}
      </div>

      <Modal open={Boolean(visitTarget)} onClose={() => setVisitTarget(null)} title={t("trial.detail.recordVisit")} description={visitTarget ? `${t(`trial.visitType.${visitTarget.visitType}`)} #${visitTarget.number} · ${visitTarget.windowStart}–${visitTarget.windowEnd}` : undefined}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("trial.col.status")}>
            <select className={inputClass} value={visitForm.status} onChange={(event) => setVisitForm({ ...visitForm, status: event.target.value })}>
              {["completed", "missed", "cancelled"].map((option) => <option key={option} value={option}>{t(`trial.visitStatus.${option}`)}</option>)}
            </select>
          </Field>
          <Field label={t("trial.col.minutes")}><input className={inputClass} inputMode="numeric" value={visitForm.durationMinutes} onChange={(event) => setVisitForm({ ...visitForm, durationMinutes: event.target.value })} /></Field>
          <Field label={t("trial.col.modality")}>
            <select className={inputClass} value={visitForm.modality} onChange={(event) => setVisitForm({ ...visitForm, modality: event.target.value })}>
              {["video", "audio", "in_app"].map((option) => <option key={option} value={option}>{t(`trial.modality.${option}`)}</option>)}
            </select>
          </Field>
        </div>
        <Button
          className="mt-4"
          loading={action.isPending}
          onClick={() => {
            if (!visitTarget) return;
            const completed = visitForm.status === "completed";
            action.mutate(
              { op: "recordVisit", visitId: visitTarget.id, patch: { status: visitForm.status as StudyVisit["status"], ...(completed ? { durationMinutes: visitForm.durationMinutes ? Number(visitForm.durationMinutes) : null, modality: visitForm.modality as StudyVisit["modality"] } : {}) } },
              { onSuccess: () => setVisitTarget(null) },
            );
          }}
        >
          {t("trial.save")}
        </Button>
      </Modal>

      <Modal open={Boolean(taskTarget)} onClose={() => setTaskTarget(null)} title={taskTarget ? `${taskTarget.instrumentCode} · ${t(`trial.timepoint.${taskTarget.timepointCode}`)}` : ""} description={t("trial.detail.enterPaperHint")} width="max-w-2xl">
        {taskTarget && <AssessmentForm key={taskTarget.id} instrumentCode={taskTarget.instrumentCode} submitting={action.isPending} onSubmit={(items) => action.mutate({ op: "submitAssessmentResponse", response: { taskId: taskTarget.id, items } }, { onSuccess: () => setTaskTarget(null) })} />}
      </Modal>
    </AppShell>
  );
}
