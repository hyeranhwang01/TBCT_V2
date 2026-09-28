"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/clinician/components/app-shell";
import { Button, Card, Field, PageHeader, SectionHeader, inputClass } from "@/shared/components/ui/primitives";
import { RowsTable, useTrialAction, useTrialQuery } from "@/clinician/pages/trial/trial-ui";
import { useT } from "@/shared/i18n/context";
import type { Site } from "@/types/trial";

/** The study roster and registration of app accounts into the study
 * (coordinator, clinician, admin). Arms are shown: this page is for the
 * unblinded team; assessors have their own page. */
export function TrialParticipantsPage() {
  const { t } = useT();
  const router = useRouter();
  const roster = useTrialQuery<Array<Record<string, unknown>>>(["participants"], { op: "listTrialParticipants" });
  const context = useTrialQuery<{ study: { code: string } | null; sites: Site[] }>(["context"], { op: "getStudyContext" });
  const accounts = useTrialQuery<Array<{ id: string; alias: string; createdAt: string }>>(["accounts"], { op: "listUnregisteredAccounts" });
  const [form, setForm] = useState({ runtimeParticipantId: "", siteId: "", studyCode: "", diagnosisStratum: "" });
  const register = useTrialAction(() => setForm({ runtimeParticipantId: "", siteId: "", studyCode: "", diagnosisStratum: "" }));
  const labels = {
    studyCode: t("trial.col.studyCode"), siteCode: t("trial.col.site"), diagnosisStratum: t("trial.col.stratum"), status: t("trial.col.status"), armCode: t("trial.col.arm"),
    visitsCompleted: t("trial.col.visitsDone"), visitsPlanned: t("trial.col.visitsPlanned"), aiModulesCompleted: t("trial.col.aiModules"), assessmentsDue: t("trial.col.assessmentsDue"), openAdverseEvents: t("trial.col.openAes"),
  };

  return (
    <AppShell>
      <PageHeader eyebrow={context.data?.study?.code ?? t("trial.eyebrow")} title={t("trial.participants.title")} description={t("trial.participants.description")} />
      <div className="space-y-4 p-4 lg:p-6">
        {context.data && !context.data.study && <Card className="p-4 text-sm text-text-secondary">{t("trial.noStudy")}</Card>}
        <Card>
          <SectionHeader title={t("trial.participants.roster")} />
          <RowsTable
            rows={roster.data ?? []}
            columns={["studyCode", "siteCode", "diagnosisStratum", "status", "armCode", "visitsCompleted", "visitsPlanned", "aiModulesCompleted", "assessmentsDue", "openAdverseEvents"]}
            labels={labels}
            empty={roster.isLoading ? t("trial.loading") : t("trial.participants.empty")}
            onRowClick={(row) => router.push(`/trial/participants/${row.studyParticipantId}`)}
          />
        </Card>
        <Card>
          <SectionHeader title={t("trial.participants.register")} description={t("trial.participants.registerHint")} />
          <form
            className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              register.mutate({ op: "registerParticipant", participant: { runtimeParticipantId: form.runtimeParticipantId, siteId: form.siteId, studyCode: form.studyCode.trim(), diagnosisStratum: (form.diagnosisStratum || null) as "MDD" | "ANXIETY" | null } });
            }}
          >
            <Field label={t("trial.participants.account")}>
              <select className={inputClass} value={form.runtimeParticipantId} onChange={(event) => setForm({ ...form, runtimeParticipantId: event.target.value })}>
                <option value="">{t("trial.choose")}</option>
                {accounts.data?.map((account) => <option key={account.id} value={account.id}>{account.alias} · {account.id} · {account.createdAt.slice(0, 10)}</option>)}
              </select>
            </Field>
            <Field label={t("trial.col.site")}>
              <select className={inputClass} value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })}>
                <option value="">{t("trial.choose")}</option>
                {context.data?.sites.map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}
              </select>
            </Field>
            <Field label={t("trial.col.studyCode")} hint={t("trial.participants.studyCodeHint")}>
              <input className={inputClass} value={form.studyCode} onChange={(event) => setForm({ ...form, studyCode: event.target.value })} />
            </Field>
            <Field label={t("trial.col.stratum")}>
              <select className={inputClass} value={form.diagnosisStratum} onChange={(event) => setForm({ ...form, diagnosisStratum: event.target.value })}>
                <option value="">{t("trial.later")}</option>
                <option value="MDD">{t("trial.stratum.MDD")}</option>
                <option value="ANXIETY">{t("trial.stratum.ANXIETY")}</option>
              </select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" loading={register.isPending} disabled={!form.runtimeParticipantId || !form.siteId || !form.studyCode.trim()}>{t("trial.participants.registerButton")}</Button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
