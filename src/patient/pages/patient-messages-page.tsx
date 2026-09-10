"use client";

import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { Card, EmptyState, PageSkeleton } from "@/shared/components/ui/primitives";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { ClinicianMessageThread } from "@/shared/components/clinician-message-thread";
import { useT } from "@/shared/i18n/context";
import { useAuth } from "@/shared/auth/auth-context";

export function PatientMessagesPage() {
  const { t, locale } = useT();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });

  if (participantQuery.isLoading) return <PatientShell title={t("messages.title")}><PageSkeleton /></PatientShell>;
  const participant = participantQuery.data;
  if (!participant) return <PatientShell title={t("messages.title")}><Card><EmptyState title={t("patientProfile.notFound")} /></Card></PatientShell>;

  return (
    <PatientShell title={t("messages.title")} sessionLabel={participant.alias}>
      <Card className="p-4">
        <p className="mb-3 rounded-panel border border-border bg-surface-subtle px-3 py-2 text-xs text-text-secondary">{t("messages.notice")}</p>
        <ClinicianMessageThread participantId={participant.id} />
      </Card>
    </PatientShell>
  );
}
