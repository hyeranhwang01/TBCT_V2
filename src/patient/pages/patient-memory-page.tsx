"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Badge, Button, Card, EmptyState, Field, PageSkeleton, inputClass } from "@/components/ui/primitives";
import { getOrCreateParticipantForUiLocale, getParticipantConsentHistory, updateParticipantConsent } from "@/lib/api/participant-api";
import { getParticipantMemories } from "@/lib/api/longitudinal-memory-api";
import { useT } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/auth-context";

export function PatientMemoryPage() {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });
  const memoryQuery = useQuery({
    queryKey: ["patient-memories", participantQuery.data?.id],
    queryFn: () => getParticipantMemories(participantQuery.data!.id),
    enabled: Boolean(participantQuery.data?.id),
  });
  const consentHistoryQuery = useQuery({
    queryKey: ["patient-consent-history", participantQuery.data?.id],
    queryFn: () => getParticipantConsentHistory(participantQuery.data!.id),
    enabled: Boolean(participantQuery.data?.id),
  });
  const consentMutation = useMutation({
    mutationFn: () =>
      updateParticipantConsent(participantQuery.data!.id, {
        memoryStorageAllowed,
        crossSessionUseAllowed,
        sensitiveMemoryAllowed,
        reason: "Patient updated memory preferences",
      }),
    onSuccess: async () => {
      toast.success(t("patientMemory.saved"));
      await queryClient.invalidateQueries({ queryKey: ["runtime-participant"] });
      await queryClient.invalidateQueries({ queryKey: ["patient-memories"] });
      await queryClient.invalidateQueries({ queryKey: ["patient-consent-history"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("patientMemory.saveFailed"));
    },
  });
  const [memoryStorageAllowed, setMemoryStorageAllowed] = useState(true);
  const [crossSessionUseAllowed, setCrossSessionUseAllowed] = useState(true);
  const [sensitiveMemoryAllowed, setSensitiveMemoryAllowed] = useState(false);

  useEffect(() => {
    if (!participantQuery.data) return;
    setMemoryStorageAllowed(participantQuery.data.consent.memoryStorageAllowed);
    setCrossSessionUseAllowed(participantQuery.data.consent.crossSessionUseAllowed);
    setSensitiveMemoryAllowed(participantQuery.data.consent.sensitiveMemoryAllowed);
  }, [participantQuery.data]);
  if (participantQuery.isLoading || memoryQuery.isLoading || consentHistoryQuery.isLoading) return <PatientShell title={t("patientMemory.title")}><PageSkeleton /></PatientShell>;
  const participant = participantQuery.data;
  const consentHistory = consentHistoryQuery.data ?? [];
  const visible = (memoryQuery.data ?? []).filter((memory) => memory.status === "approved" && !memory.isSystemDerived && memory.sensitivity !== "safety_restricted" && memory.memoryType !== "clinician_note");
  if (!participant) return <PatientShell title={t("patientMemory.title")}><Card><EmptyState title={t("patientMemory.notFound")} /></Card></PatientShell>;
  return (
    <PatientShell title={t("patientMemory.title")} sessionLabel={participant.alias} progressLabel={participant.status} actions={<Button variant="secondary" onClick={() => consentMutation.mutate()}>{t("patientMemory.saveSettings")}</Button>}>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">{t("patientMemory.controls.title")}</div>
          <div className="mt-2 text-xs text-text-secondary">{t("patientMemory.controls.description")}</div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label={t("patientMemory.controls.snapshotName")}><input className={inputClass} value={participant.alias} readOnly /></Field>
            <div className="grid gap-3 rounded-panel border border-border bg-surface-subtle p-3 text-sm text-text-secondary">
              <label className="flex items-center justify-between gap-3"><span>{t("patientMemory.consentOptions.storeMemory")}</span><input type="checkbox" checked={memoryStorageAllowed} onChange={(event) => setMemoryStorageAllowed(event.target.checked)} /></label>
              <label className="flex items-center justify-between gap-3"><span>{t("patientMemory.consentOptions.reuseAcrossSessions")}</span><input type="checkbox" checked={crossSessionUseAllowed} onChange={(event) => setCrossSessionUseAllowed(event.target.checked)} /></label>
              <label className="flex items-center justify-between gap-3"><span>{t("patientMemory.consentOptions.allowSensitiveMemory")}</span><input type="checkbox" checked={sensitiveMemoryAllowed} onChange={(event) => setSensitiveMemoryAllowed(event.target.checked)} /></label>
            </div>
          </div>
        </Card>
        {!visible.length && <Card><EmptyState title={t("patientMemory.noVisibleMemory.title")} description={t("patientMemory.noVisibleMemory.description")} /></Card>}
        <Card className="p-4">
          <div className="text-sm font-semibold text-text-primary">{t("patientMemory.consentHistory.title")}</div>
          <div className="mt-3 space-y-2">
            {!consentHistory.length && <div className="text-sm text-text-secondary">{t("patientMemory.consentHistory.none")}</div>}
            {consentHistory.slice().reverse().map((entry) => (
              <div key={entry.id} className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
                <div className="font-semibold text-text-primary">{entry.reason ?? t("patientMemory.consentHistory.updated")}</div>
                <div className="mt-1 text-xs text-text-secondary">{new Date(entry.effectiveAt).toLocaleString("ko-KR")}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone={entry.crossSessionUseAllowed ? "success" : "warning"}>{t("patientMemory.consentHistory.crossSession")} {entry.crossSessionUseAllowed ? t("patientMemory.consentHistory.on") : t("patientMemory.consentHistory.off")}</Badge>
                  <Badge tone={entry.memoryStorageAllowed ? "success" : "critical"}>{t("patientMemory.consentHistory.memoryStorage")} {entry.memoryStorageAllowed ? t("patientMemory.consentHistory.on") : t("patientMemory.consentHistory.off")}</Badge>
                  <Badge tone={entry.sensitiveMemoryAllowed ? "warning" : "neutral"}>{t("patientMemory.consentHistory.sensitive")} {entry.sensitiveMemoryAllowed ? t("patientMemory.consentHistory.on") : t("patientMemory.consentHistory.off")}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
        {visible.map((memory) => (
          <Card key={memory.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-text-primary">{memory.title}</div>
                <div className="mt-1 text-sm text-text-secondary">{memory.content}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="primary">{memory.memoryType}</Badge>
                <Badge tone="neutral">{memory.status}</Badge>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PatientShell>
  );
}
