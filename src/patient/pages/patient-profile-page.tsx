"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, ClipboardList, HeartPulse, LifeBuoy, Lock, LogOut, MessageCircleMore, Palette, PlayCircle, ShieldCheck, Type, UserRound, Users } from "lucide-react";
import { TEXT_SCALES, setTextScale, useTextScale } from "@/patient/lib/text-scale";
import { cn } from "@/shared/utils";
import { PatientShell, useLogoutConfirm } from "@/patient/components/patient-shell";
import { MfaSettings } from "@/shared/components/auth/mfa-settings";
import { DataPrivacySection } from "@/patient/components/data-privacy-section";
import { ToggleSwitch } from "@/patient/components/toggle-switch";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";
import { BOARD_BACKGROUND, EmptyBlock, ListGroup, ListRow, PtButton, PtCard, PtField, PtSkeleton, ptInputClass } from "@/patient/components/ui/kit";
import { getOrCreateParticipantForUiLocale, updateParticipantProfile, updateParticipantConsent, updateNotificationPreferences } from "@/shared/api/participant-api";
import { propagateLocaleToOpenSessions } from "@/patient/lib/api/patient-locale-sync";
import { useT } from "@/shared/i18n/context";
import { mapToUiLocale } from "@/shared/i18n/locales";
import { useAuth } from "@/shared/auth/auth-context";
import { isPatientMockModeEnabled } from "@/shared/mocks/patient-dev-mock";

export function PatientProfilePage() {
  // Aliased: this page already has its own local `locale`/`setLocale` state
  // for the pending profile-form edit below -- uiLocale/setUiLocale is the
  // website's own chrome-language state from useT(), a separate thing this
  // now also updates once the locale field is actually saved (see
  // profileMutation), and also what a brand-new participant record's
  // initial content locale is seeded from (see getOrCreateParticipantForUiLocale).
  const { t, locale: uiLocale, setLocale: setUiLocale } = useT();
  const textScale = useTextScale();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, uiLocale), enabled: Boolean(userId) });
  const { openLogout, logoutDialog } = useLogoutConfirm();
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
      await queryClient.invalidateQueries({ queryKey: ["runtime-sessions"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("patientProfile.saveFailed"));
    },
  });
  if (participantQuery.isLoading) return <PatientShell title={t("patientProfile.title")} hideHeader><PtSkeleton /></PatientShell>;
  const participant = participantQuery.data;
  if (!participant) return <PatientShell title={t("patientProfile.title")} hideHeader><PtCard><EmptyBlock icon={<UserRound />} title={t("patientProfile.notFound")} /></PtCard></PatientShell>;
  const initial = (participant.alias || "?").trim().charAt(0).toUpperCase();
  return (
    <PatientShell title={t("patientProfile.title")} hideHeader>
      <div className="mx-auto max-w-2xl space-y-7">
        <div className="flex items-center gap-4 pb-4 pt-2 sm:pt-6">
          <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-bold text-white shadow-[0_14px_30px_-12px_rgba(14,40,26,0.6)] sm:h-20 sm:w-20 sm:text-3xl" style={{ background: BOARD_BACKGROUND }} aria-hidden="true">{initial}</span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-brand-ink">{t("patientUi.nav.me")}</div>
            <h1 className="truncate text-[28px] font-extrabold tracking-[-0.035em] text-text-primary sm:text-[32px]">{participant.alias}</h1>
            <div className="text-[13px] text-text-secondary">{participant.locale} · {participant.country ?? "KR"}</div>
          </div>
        </div>

        <section>
          <div className="mb-2 px-1 text-[13px] font-semibold text-text-muted">{t("patientProfile.edit.title")}</div>
          <PtCard className="space-y-5 p-5">
            <PtField label={t("patientProfile.edit.displayName")}><input className={ptInputClass} value={alias} onChange={(event) => setAlias(event.target.value)} /></PtField>
            <div className="grid gap-5 sm:grid-cols-2">
              <PtField label={t("patientProfile.edit.locale")} hint={t("patientProfile.edit.localeHint")}>
                <select className={ptInputClass} value={locale} onChange={(event) => setLocale(event.target.value)}>
                  <option value="ko-KR">한국어 (ko-KR)</option>
                  <option value="en-US">English (en-US)</option>
                  {/* pt-BR/fr-FR deliberately not offered: only ko has reviewed
                      session-content translations (runtime-release-normalizer.ts).
                      A record that already carries another value keeps it shown,
                      so the select never silently jumps. */}
                  {locale !== "ko-KR" && locale !== "en-US" && <option value={locale}>{locale}</option>}
                </select>
              </PtField>
              <PtField label={t("patientProfile.edit.country")}><input className={ptInputClass} value={country} onChange={(event) => setCountry(event.target.value)} /></PtField>
            </div>
          </PtCard>
        </section>

        <ListGroup title={t("patientProfile.edit.memory.title")}>
          <ToggleSwitch icon={<ShieldCheck />} label={t("patientProfile.edit.storeMemory")} checked={memoryStorageAllowed} onChange={setMemoryStorageAllowed} />
          <ToggleSwitch icon={<Users />} label={t("patientProfile.edit.reuseAcrossSessions")} checked={crossSessionUseAllowed} onChange={setCrossSessionUseAllowed} />
          <ToggleSwitch icon={<Lock />} label={t("patientProfile.edit.allowSensitiveMemory")} checked={sensitiveMemoryAllowed} onChange={setSensitiveMemoryAllowed} />
        </ListGroup>

        <ListGroup title={t("patientProfile.edit.notifications.title")}>
          <ToggleSwitch icon={<CalendarClock />} label={t("patientProfile.edit.notifications.sessionReminders")} checked={sessionRemindersEnabled} onChange={setSessionRemindersEnabled} />
          <ToggleSwitch icon={<ClipboardList />} label={t("patientProfile.edit.notifications.homeworkReminders")} checked={homeworkRemindersEnabled} onChange={setHomeworkRemindersEnabled} />
          <ToggleSwitch icon={<MessageCircleMore />} label={t("patientProfile.edit.notifications.newMessages")} checked={newMessagesEnabled} onChange={setNewMessagesEnabled} />
        </ListGroup>

        <PtButton size="lg" block loading={profileMutation.isPending} onClick={() => profileMutation.mutate()}>{t("patientProfile.edit.save")}</PtButton>

        <ListGroup title={t("patientUi.profile.display")}>
          <div className="px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-subtle text-text-secondary [&>svg]:h-[18px] [&>svg]:w-[18px]"><Type /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-text-primary">{t("patientUi.profile.textSize")}</div>
                <div className="text-[13px] text-text-muted">{t("patientUi.profile.textSizeHint")}</div>
              </div>
            </div>
            <div role="radiogroup" aria-label={t("patientUi.profile.textSize")} className="mt-3 grid grid-cols-3 gap-2">
              {TEXT_SCALES.map((scale, index) => (
                <button
                  key={scale}
                  type="button"
                  role="radio"
                  aria-checked={textScale === scale}
                  onClick={() => setTextScale(scale)}
                  className={cn(
                    "transition-ui rounded-xl border px-2 py-2.5 font-semibold",
                    textScale === scale ? "border-brand bg-brand-tint text-brand-ink" : "border-border bg-surface text-text-secondary hover:bg-surface-hover",
                  )}
                  style={{ fontSize: `${14 * scale}px` }}
                >
                  {t(`patientUi.profile.textSize${index + 1}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="hidden sm:block">
            <ListRow icon={<Palette />} tone="neutral" title={t("patientUi.profile.appearance")} description={t("patientUi.profile.appearanceHint")} trailing={<ThemeToggle className="rounded-full" />} />
          </div>
        </ListGroup>

        <ListGroup title={t("patientUi.profile.wellbeing")}>
          <ListRow href="/projects/demo/patient/checkin" icon={<HeartPulse />} tone="critical" title={t("patientUi.profile.checkin")} description={t("patientUi.profile.checkinHint")} />
        </ListGroup>

        {/* Mock mode never touches Supabase (see patient-dev-mock.ts) and MFA is
            a Supabase Auth feature, so it's hidden rather than shown broken. */}
        {!isPatientMockModeEnabled() && (
          <section>
            <div className="mb-2 px-1 text-[13px] font-semibold text-text-muted">{t("patientUi.profile.security")}</div>
            <MfaSettings />
          </section>
        )}

        <DataPrivacySection participantId={participant.id} title={t("patientUi.profile.data")} />

        <ListGroup title={t("patientUi.profile.help")}>
          <ListRow href="/projects/demo/patient?tour=1" icon={<PlayCircle />} title={t("patientUi.profile.tour")} />
          <ListRow href="/crisis" target="_blank" icon={<LifeBuoy />} tone="critical" title={t("patientUi.profile.crisis")} description={t("patientUi.profile.crisisHint")} />
          <ListRow icon={<LogOut />} tone="neutral" title={t("auth.logout")} onClick={openLogout} chevron={false} />
        </ListGroup>
      </div>
      {logoutDialog}
    </PatientShell>
  );
}
