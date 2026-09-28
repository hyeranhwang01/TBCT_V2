"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { PatientShell } from "@/patient/components/patient-shell";
import { EmptyBlock, PtCard, PtSkeleton } from "@/patient/components/ui/kit";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { ClinicianMessageThread } from "@/shared/components/clinician-message-thread";
import { useT } from "@/shared/i18n/context";
import { useAuth } from "@/shared/auth/auth-context";

export function PatientMessagesPage() {
  const { t, locale } = useT();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });

  if (participantQuery.isLoading) return <PatientShell title={t("patientUi.nav.messages")}><PtSkeleton /></PatientShell>;
  const participant = participantQuery.data;
  if (!participant) return <PatientShell title={t("patientUi.nav.messages")}><PtCard><EmptyBlock icon={<UserRound />} title={t("patientProfile.notFound")} /></PtCard></PatientShell>;

  return (
    <PatientShell title={t("patientUi.nav.messages")} description={t("patientUi.home.messagesBody")}>
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-brand-tint px-4 py-3.5 text-[13px] leading-relaxed text-brand-ink">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            {t("messages.notice")}{" "}
            <Link href="/crisis" target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-4">{t("patientUi.profile.crisis")}</Link>
          </p>
        </div>
        <PtCard className="p-4 sm:p-5">
          <ClinicianMessageThread participantId={participant.id} />
        </PtCard>
      </div>
    </PatientShell>
  );
}
