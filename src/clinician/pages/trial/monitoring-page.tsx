"use client";

import { useState } from "react";
import { AppShell } from "@/clinician/components/app-shell";
import { Badge, Button, Card, Field, MetricCard, PageHeader, SectionHeader, inputClass, textareaClass } from "@/shared/components/ui/primitives";
import { RowsTable, useTrialAction, useTrialQuery } from "@/clinician/pages/trial/trial-ui";
import { COUNTRY_SITES, defaultStudyConfig } from "@/shared/trial/default-study-config";
import { useAuth } from "@/shared/auth/auth-context";
import { useT } from "@/shared/i18n/context";
import type { AiRelease, Site, StudyArm, Therapist } from "@/types/trial";

type Summary = Record<"enrollment" | "visitAdherence" | "assessments" | "adverseEvents" | "aiAdherence" | "events" | "randomization", Array<Record<string, unknown>>> & { reviewTasks: { open: number; overdue: number } };
type Context = { study: { id: string; code: string; country: string; status: string; protocolVersion: string } | null; arms: StudyArm[]; sites: Site[]; therapists: Therapist[]; releases: AiRelease[]; locked: boolean };

function Table({ title, rows, empty }: { title: string; rows: Array<Record<string, unknown>>; empty: string }) {
  return (
    <Card>
      <SectionHeader title={title} />
      <RowsTable rows={rows} columns={rows[0] ? Object.keys(rows[0]) : []} empty={empty} />
    </Card>
  );
}

/** Study monitoring (DSMB, monthly AI adherence, enrolment and retention)
 * for the study team, and the admin's study setup: configuration, frozen
 * AI releases, the randomization list, therapists and the database lock. */
export function TrialMonitoringPage() {
  const { t } = useT();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const context = useTrialQuery<Context>(["context"], { op: "getStudyContext" });
  const summary = useTrialQuery<Summary>(["monitoring"], { op: "getMonitoringSummary" });
  const randomization = useTrialQuery<Array<Record<string, unknown>>>(["randomization"], isAdmin ? { op: "randomizationStatus" } : null);
  const action = useTrialAction();
  const [country, setCountry] = useState("KR");
  const [release, setRelease] = useState({ label: "", modelId: "" });
  const [list, setList] = useState({ listVersion: "", csv: "" });
  const [therapist, setTherapist] = useState({ siteId: "", displayName: "" });
  const [lockReason, setLockReason] = useState("");
  const study = context.data?.study;
  const empty = t("trial.monitoring.noRows");

  return (
    <AppShell>
      <PageHeader
        eyebrow={study ? `${study.code} · ${study.protocolVersion}` : t("trial.eyebrow")}
        title={t("trial.monitoring.title")}
        description={t("trial.monitoring.description")}
        meta={study ? <><Badge tone="primary">{study.status}</Badge>{context.data?.locked && <Badge tone="critical">{t("trial.monitoring.locked")}</Badge>}</> : undefined}
      />
      <div className="space-y-4 p-4 lg:p-6">
        {context.data && !study && (
          <Card className="space-y-3 p-4">
            <p className="text-sm text-text-secondary">{t("trial.noStudy")}</p>
            {isAdmin && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t("trial.monitoring.country")}>
                  <select className={inputClass} value={country} onChange={(event) => setCountry(event.target.value)}>
                    {Object.keys(COUNTRY_SITES).map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                </Field>
                <Button loading={action.isPending} onClick={() => action.mutate({ op: "configureStudy", config: defaultStudyConfig(country, "draft") })}>{t("trial.monitoring.configure")}</Button>
              </div>
            )}
          </Card>
        )}

        {summary.data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label={t("trial.monitoring.openReviews")} value={String(summary.data.reviewTasks.open)} helper={t("trial.monitoring.openReviewsHelp")} />
              <MetricCard label={t("trial.monitoring.overdueReviews")} value={String(summary.data.reviewTasks.overdue)} helper={t("trial.monitoring.overdueReviewsHelp")} accent="critical" />
              <MetricCard label={t("trial.monitoring.participants")} value={String(summary.data.enrollment.reduce((sum, row) => sum + Number(row.participants ?? 0), 0))} helper={t("trial.monitoring.participantsHelp")} />
            </div>
            <Table title={t("trial.monitoring.enrollment")} rows={summary.data.enrollment} empty={empty} />
            <Table title={t("trial.monitoring.visitAdherence")} rows={summary.data.visitAdherence} empty={empty} />
            <Table title={t("trial.monitoring.assessments")} rows={summary.data.assessments} empty={empty} />
            <Table title={t("trial.monitoring.adverseEvents")} rows={summary.data.adverseEvents} empty={empty} />
            <Table title={t("trial.monitoring.aiAdherence")} rows={summary.data.aiAdherence} empty={empty} />
            <Table title={t("trial.monitoring.events")} rows={summary.data.events} empty={empty} />
          </>
        )}

        {study && (
          <Card>
            <SectionHeader title={t("trial.monitoring.setup")} />
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("trial.monitoring.arms")}</h3>
                <RowsTable rows={(context.data?.arms ?? []) as unknown as Array<Record<string, unknown>>} columns={["code", "name", "aiEnabled", "therapistRequired"]} empty={empty} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("trial.monitoring.sites")}</h3>
                <RowsTable rows={(context.data?.sites ?? []) as unknown as Array<Record<string, unknown>>} columns={["code", "name", "locale", "timezone"]} empty={empty} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("trial.monitoring.therapists")}</h3>
                <RowsTable rows={(context.data?.therapists ?? []) as unknown as Array<Record<string, unknown>>} columns={["displayName", "siteId", "status"]} empty={empty} />
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field label={t("trial.col.site")}>
                    <select className={inputClass} value={therapist.siteId} onChange={(event) => setTherapist({ ...therapist, siteId: event.target.value })}>
                      <option value="">{t("trial.choose")}</option>
                      {context.data?.sites.map((site) => <option key={site.id} value={site.id}>{site.code}</option>)}
                    </select>
                  </Field>
                  <Field label={t("trial.monitoring.therapistName")}><input className={inputClass} value={therapist.displayName} onChange={(event) => setTherapist({ ...therapist, displayName: event.target.value })} /></Field>
                  <Button size="sm" loading={action.isPending} disabled={!therapist.siteId || !therapist.displayName.trim()} onClick={() => action.mutate({ op: "upsertTherapist", therapist: { siteId: therapist.siteId, displayName: therapist.displayName.trim(), status: "active" } }, { onSuccess: () => setTherapist({ siteId: "", displayName: "" }) })}>{t("trial.monitoring.addTherapist")}</Button>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("trial.monitoring.releases")}</h3>
                <RowsTable
                  rows={(context.data?.releases ?? []) as unknown as Array<Record<string, unknown>>}
                  columns={["label", "modelId", "status", "frozenAt", "memoryAlgorithmVersion", "memoryIndexVersion"]}
                  empty={empty}
                  actions={isAdmin ? (row) => (row.status === "draft"
                    ? <Button size="sm" onClick={() => window.confirm(t("trial.monitoring.freezeConfirm")) && action.mutate({ op: "freezeAiRelease", releaseId: String(row.id) })}>{t("trial.monitoring.freeze")}</Button>
                    : row.status === "frozen"
                      ? <Button size="sm" variant="secondary" onClick={() => { const reason = window.prompt(t("trial.monitoring.retireReason")); if (reason) action.mutate({ op: "retireAiRelease", releaseId: String(row.id), reason }); }}>{t("trial.monitoring.retire")}</Button>
                      : null) : undefined}
                />
                {isAdmin && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Field label={t("trial.monitoring.releaseLabel")}><input className={inputClass} value={release.label} onChange={(event) => setRelease({ ...release, label: event.target.value })} /></Field>
                    <Field label={t("trial.monitoring.modelId")} hint={t("trial.monitoring.modelIdHint")}><input className={inputClass} value={release.modelId} onChange={(event) => setRelease({ ...release, modelId: event.target.value })} /></Field>
                    <Button size="sm" loading={action.isPending} disabled={!release.label.trim() || !release.modelId.trim()} onClick={() => action.mutate({ op: "createAiRelease", release: { label: release.label.trim(), modelId: release.modelId.trim() } }, { onSuccess: () => setRelease({ label: "", modelId: "" }) })}>{t("trial.monitoring.createRelease")}</Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {study && isAdmin && (
          <Card>
            <SectionHeader title={t("trial.monitoring.randomization")} description={t("trial.monitoring.randomizationHint")} />
            <RowsTable rows={randomization.data ?? []} columns={["stratum", "total", "used", "remaining"]} empty={t("trial.monitoring.noList")} />
            <div className="grid gap-3 border-t border-border p-4">
              <Field label={t("trial.monitoring.listVersion")}><input className={`${inputClass} max-w-xs`} value={list.listVersion} onChange={(event) => setList({ ...list, listVersion: event.target.value })} /></Field>
              <Field label="CSV (stratum,sequence,arm)" hint={t("trial.monitoring.csvHint")}><textarea className={`${textareaClass} font-mono text-xs`} value={list.csv} onChange={(event) => setList({ ...list, csv: event.target.value })} /></Field>
              <div><Button loading={action.isPending} disabled={!list.listVersion.trim() || !list.csv.trim()} onClick={() => action.mutate({ op: "uploadRandomizationList", listVersion: list.listVersion.trim(), csv: list.csv }, { onSuccess: () => setList({ listVersion: "", csv: "" }) })}>{t("trial.monitoring.upload")}</Button></div>
            </div>
          </Card>
        )}

        {study && isAdmin && !context.data?.locked && (
          <Card>
            <SectionHeader title={t("trial.monitoring.lock")} description={t("trial.monitoring.lockHint")} />
            <div className="flex flex-wrap items-end gap-3 p-4">
              <Field label={t("trial.detail.reason")}><input className={inputClass} value={lockReason} onChange={(event) => setLockReason(event.target.value)} /></Field>
              <Button variant="danger" loading={action.isPending} disabled={!lockReason.trim()} onClick={() => window.confirm(t("trial.monitoring.lockConfirm")) && action.mutate({ op: "lockStudy", reason: lockReason.trim() })}>{t("trial.monitoring.lockButton")}</Button>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
