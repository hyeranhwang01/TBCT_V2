"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientShell } from "@/patient/components/patient-shell";
import { SessionProgressChart } from "@/patient/components/session-progress-chart";
import { MfaSettings } from "@/shared/components/auth/mfa-settings";
import { DataPrivacySection } from "@/patient/components/data-privacy-section";
import { Badge, Button, Card, EmptyState, Field, PageSkeleton, inputClass } from "@/shared/components/ui/primitives";
import { getOrCreateParticipantForUiLocale, getParticipantRecord, updateParticipantProfile, updateParticipantConsent, updateNotificationPreferences } from "@/lib/api/participant-api";
import { getParticipantLongitudinalDashboard } from "@/lib/api/longitudinal-memory-api";
import { getPatientProgressSeries } from "@/lib/worksheet/worksheet-projection";
import { propagateLocaleToOpenSessions } from "@/lib/api/patient-locale-sync";
import { useT } from "@/lib/i18n/context";
import { mapToUiLocale } from "@/lib/i18n/locales";
import { useAuth } from "@/lib/auth/auth-context";

export function PatientProfilePage() {
  // Aliased: this page already has its own local `locale`/`setLocale` state
  // for the pending profile-form edit below -- uiLocale/setUiLocale is the
  // website's own chrome-language state from useT(), a separate thing this
  // now also updates once the locale field is actually saved (see
  // profileMutation), and also what a brand-new participant record's
  // initial content locale is seeded from (see getOrCreateParticipantForUiLocale).
  const { t, locale: uiLocale, setLocale: setUiLocale } = useT();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, uiLocale), enabled: Boolean(userId) });
  const dashboardQuery = useQuery({
    queryKey: ["patient-profile-dashboard", participantQuery.data?.id],
    queryFn: () => getParticipantLongitudinalDashboard(participantQuery.data!.id),
    enabled: Boolean(participantQuery.data?.id),
  });
  const recordQuery = useQuery({
    queryKey: ["patient-record", participantQuery.data?.id],
    queryFn: () => getParticipantRecord(participantQuery.data!.id),
    enabled: Boolean(participantQuery.data?.id),
  });
  const progressQuery = useQuery({
    queryKey: ["patient-progress-series", participantQuery.data?.id],
    queryFn: () => getPatientProgressSeries(participantQuery.data!.id),
    enabled: Boolean(participantQuery.data?.id),
  });
  const [alias, setAlias] = useState("");
  const [locale, setLocale] = useState("ko-KR");
  const [country, setCountry] = useState("KR");
  const [memoryStorageAllowed, setMemoryStorageAllowed] = useState(true);
  const [crossSessionUseAllowed, setCrossSessionUseAllowed] = useState(true);
  const [sensitiveMemoryAllowed, setSensitiveMemoryAllowed] = useState(false);
  const [sessionRemindersEnabled, setSessionRemindersEnabled] = useState(true);
  const [homeworkRemindersEnabled, setHomeworkRemindersEnabled] = useState(true);
  const [newMessagesEnabled, setNewMessagesEnabled] = useState(true);

  useEffect(() => {
    if (!participantQuery.data) return;
    setAlias(participantQuery.data.alias);
    setLocale(participantQuery.data.locale);
    setCountry(participantQuery.data.country ?? "KR");
    setMemoryStorageAllowed(participantQuery.data.consent.memoryStorageAllowed);
    setCrossSessionUseAllowed(participantQuery.data.consent.crossSessionUseAllowed);
    setSensitiveMemoryAllowed(participantQuery.data.consent.sensitiveMemoryAllowed);
    // Absent means enabled -- see RuntimeParticipant.notificationPreferences's doc comment.
    setSessionRemindersEnabled(participantQuery.data.notificationPreferences?.sessionReminders !== false);
    setHomeworkRemindersEnabled(participantQuery.data.notificationPreferences?.homeworkReminders !== false);
    setNewMessagesEnabled(participantQuery.data.notificationPreferences?.newMessages !== false);
  }, [participantQuery.data]);

  const profileMutation = useMutation({
    mutationFn: async () => {
      if (!participantQuery.data) throw new Error("Participant not found");
      const localeChanged = participantQuery.data.locale !== locale;
      await updateParticipantProfile(participantQuery.data.id, { alias, locale, country, status: participantQuery.data.status });
      if (localeChanged) {
        // Previously this only ever affected sessions created AFTER this
        // save -- an already-open session's own locale field was never
        // touched, so a patient switching their language mid-program would
        // keep getting replies in the old one until they started a brand
        // new session. Also flip the website's own UI chrome to match in
        // the same step (mapToUiLocale is a no-op if this ever gets a
        // locale outside ko/en) -- this is the merge the profile "언어"
        // field and the header language toggle now both go through, see
        // patient-locale-sync.ts.
        await propagateLocaleToOpenSessions(participantQuery.data, locale);
        const mappedUiLocale = mapToUiLocale(locale);
        if (mappedUiLocale) setUiLocale(mappedUiLocale);
      }
      await updateParticipantConsent(participantQuery.data.id, {
        memoryStorageAllowed,
        crossSessionUseAllowed,
        sensitiveMemoryAllowed,
        reason: "Patient profile settings updated",
      });
      await updateNotificationPreferences(participantQuery.data.id, {
        sessionReminders: sessionRemindersEnabled,
        homeworkReminders: homeworkRemindersEnabled,
        newMessages: newMessagesEnabled,
      });
    },
    onSuccess: async () => {
      toast.success(t("patientProfile.saved"));
      await queryClient.invalidateQueries({ queryKey: ["runtime-participant"] });
      await queryClient.invalidateQueries({ queryKey: ["patient-profile-dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["patient-record"] });
      await queryClient.invalidateQueries({ queryKey: ["runtime-sessions"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("patientProfile.saveFailed"));
    },
  });
  if (participantQuery.isLoading || dashboardQuery.isLoading || recordQuery.isLoading) return <PatientShell title={t("patientProfile.title")}><PageSkeleton /></PatientShell>;
  const participant = participantQuery.data;
  const dashboard = dashboardQuery.data;
  if (!participant || !dashboard) return <PatientShell title={t("patientProfile.title")}><Card><EmptyState title={t("patientProfile.notFound")} /></Card></PatientShell>;
  return (
    <PatientShell
      title={t("patientProfile.title")}
      sessionLabel={participant.alias}
      progressLabel={participant.status}
      actions={
        <>
          <Link href="/patient/checkin"><Button variant="secondary">{t("patientProfile.openCheckin")}</Button></Link>
          <Link href="/projects/demo/patient/memory"><Button variant="secondary">{t("patientProfile.openMemory")}</Button></Link>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">{t("patientProfile.consent.title")}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={participant.consent.memoryStorageAllowed ? "success" : "critical"}>{t("patientProfile.consent.memoryStorage")}</Badge>
            <Badge tone={participant.consent.crossSessionUseAllowed ? "success" : "warning"}>{t("patientProfile.consent.crossSession")}</Badge>
            <Badge tone={participant.consent.sensitiveMemoryAllowed ? "warning" : "neutral"}>{t("patientProfile.consent.sensitiveMemory")}</Badge>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">{t("patientProfile.continuity.title")}</div>
          <div className="mt-2 text-xs text-text-secondary">{t("patientProfile.continuity.sessions", { count: participant.runtimeSessionIds.length })}</div>
          <div className="mt-2 text-xs text-text-secondary">{t("patientProfile.continuity.activeMemories", { count: recordQuery.data?.activeMemoryIds.length ?? 0 })}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">{t("patientProfile.currentItems.title")}</div>
          <div className="mt-2 text-xs text-text-secondary">{t("patientProfile.currentItems.activeGoals", { count: dashboard.goals.filter((item) => item.status === "active").length })}</div>
          <div className="mt-2 text-xs text-text-secondary">{t("patientProfile.currentItems.unresolvedHomework", { count: dashboard.homework.filter((item) => item.status === "assigned" || item.status === "in_progress").length })}</div>
        </Card>
      </div>
      {progressQuery.data && progressQuery.data.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-semibold text-text-primary">{t("patientProfile.progress.title")}</div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {progressQuery.data.map((card) => (
              <SessionProgressChart key={card.sessionDefinitionId} card={card} />
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">{t("patientProfile.edit.title")}</div>
          <div className="mt-4 grid gap-4">
            <Field label={t("patientProfile.edit.displayName")}><input className={inputClass} value={alias} onChange={(event) => setAlias(event.target.value)} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("patientProfile.edit.locale")} hint={t("patientProfile.edit.localeHint")}>
                <select className={inputClass} value={locale} onChange={(event) => setLocale(event.target.value)}>
                  <option value="ko-KR">ko-KR</option>
                  <option value="en-US">en-US</option>
                  {/* pt-BR/fr-FR intentionally not offered here: only ko has
                      reviewed session-content translations (see
                      runtime-release-normalizer.ts) -- picking pt-BR/fr-FR
                      would mean the actual therapy dialogue renders mostly
                      in English, not a real Portuguese/French experience.
                      If an existing record already has one of those values
                      (set before this fix), keep it shown so the select
                      doesn't silently jump to a different value out from
                      under the participant -- they can still switch away. */}
                  {locale !== "ko-KR" && locale !== "en-US" && <option value={locale}>{locale}</option>}
                </select>
              </Field>
              <Field label={t("patientProfile.edit.country")}><input className={inputClass} value={country} onChange={(event) => setCountry(event.target.value)} /></Field>
            </div>
            <div className="grid gap-3 rounded-panel border border-border bg-surface-subtle p-3 text-sm text-text-secondary">
              <label className="flex items-center justify-between gap-3"><span>{t("patientProfile.edit.storeMemory")}</span><input type="checkbox" checked={memoryStorageAllowed} onChange={(event) => setMemoryStorageAllowed(event.target.checked)} /></label>
              <label className="flex items-center justify-between gap-3"><span>{t("patientProfile.edit.reuseAcrossSessions")}</span><input type="checkbox" checked={crossSessionUseAllowed} onChange={(event) => setCrossSessionUseAllowed(event.target.checked)} /></label>
              <label className="flex items-center justify-between gap-3"><span>{t("patientProfile.edit.allowSensitiveMemory")}</span><input type="checkbox" checked={sensitiveMemoryAllowed} onChange={(event) => setSensitiveMemoryAllowed(event.target.checked)} /></label>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">{t("patientProfile.edit.notifications.title")}</div>
              <div className="grid gap-3 rounded-panel border border-border bg-surface-subtle p-3 text-sm text-text-secondary">
                <label className="flex items-center justify-between gap-3"><span>{t("patientProfile.edit.notifications.sessionReminders")}</span><input type="checkbox" checked={sessionRemindersEnabled} onChange={(event) => setSessionRemindersEnabled(event.target.checked)} /></label>
                <label className="flex items-center justify-between gap-3"><span>{t("patientProfile.edit.notifications.homeworkReminders")}</span><input type="checkbox" checked={homeworkRemindersEnabled} onChange={(event) => setHomeworkRemindersEnabled(event.target.checked)} /></label>
                <label className="flex items-center justify-between gap-3"><span>{t("patientProfile.edit.notifications.newMessages")}</span><input type="checkbox" checked={newMessagesEnabled} onChange={(event) => setNewMessagesEnabled(event.target.checked)} /></label>
              </div>
            </div>
            <Button loading={profileMutation.isPending} onClick={() => profileMutation.mutate()}>{t("patientProfile.edit.save")}</Button>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">{t("patientProfile.snapshot.title")}</div>
          <div className="mt-3 space-y-2 text-sm text-text-secondary">
            <div>{t("patientProfile.snapshot.participantRecord")}: {recordQuery.data?.id ?? t("patientProfile.snapshot.unavailable")}</div>
            <div>{t("patientProfile.snapshot.activeMemoryIds")}: {recordQuery.data?.activeMemoryIds.length ?? 0}</div>
            <div>{t("patientProfile.snapshot.latestSummary")}: {recordQuery.data?.latestSummaryId ?? t("patientProfile.snapshot.none")}</div>
          </div>
        </Card>
        <MfaSettings />
        <DataPrivacySection participantId={participant.id} />
      </div>
    </PatientShell>
  );
}
