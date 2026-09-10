"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Badge, Button, Card, EmptyState, PageSkeleton } from "@/components/ui/primitives";
import { getOrCreateParticipantForUiLocale } from "@/lib/api/participant-api";
import { submitStandardizedAssessment, listStandardizedAssessments } from "@/lib/api/standardized-assessment-api";
import { INSTRUMENTS, responseOptionLabel } from "@/lib/standardized-assessments/instruments";
import { useT } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/auth-context";
import type { SeverityBand, StandardizedInstrumentId } from "@/types/standardized-assessment";

const SEVERITY_TONE: Record<SeverityBand, "success" | "neutral" | "warning" | "critical"> = {
  minimal: "success",
  mild: "neutral",
  moderate: "warning",
  moderately_severe: "critical",
  severe: "critical",
};

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Patient-facing PHQ-9/GAD-7 check-in. Fires the safety-alert route
 * (never sendSafetyAlertEmail directly -- see that route's own doc
 * comment) the same non-blocking way runtime-execution-api.ts does when a
 * response's self-harm item scores > 0. */
export function PatientCheckinPage() {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });
  const participantId = participantQuery.data?.id ?? "";
  const historyQuery = useQuery({
    queryKey: ["standardized-assessments", participantId],
    queryFn: () => listStandardizedAssessments(participantId),
    enabled: Boolean(participantId),
  });

  const [activeInstrumentId, setActiveInstrumentId] = useState<StandardizedInstrumentId | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);

  const startInstrument = (instrumentId: StandardizedInstrumentId) => {
    setActiveInstrumentId(instrumentId);
    setAnswers(new Array(INSTRUMENTS[instrumentId].items.length).fill(-1));
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!activeInstrumentId) throw new Error("No instrument selected");
      const result = await submitStandardizedAssessment(participantId, activeInstrumentId, answers);
      if (result.selfHarmFlag) {
        void fetch("/api/notifications/safety-alert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            participantId,
            participantAlias: participantQuery.data?.alias ?? participantId,
            severity: "high",
            triggerSummary: `PHQ-9 check-in flagged self-harm ideation (item score ${answers[INSTRUMENTS.phq9.selfHarmItemIndex!]})`,
            assignedClinicianUserId: participantQuery.data?.assignedClinician,
            locale: participantQuery.data?.locale,
          }),
        }).catch((error) => console.error("[patient-checkin] failed to dispatch safety alert", error));
      }
      return result;
    },
    onSuccess: async () => {
      toast.success(t("patientCheckin.submitted"));
      setActiveInstrumentId(null);
      setAnswers([]);
      await queryClient.invalidateQueries({ queryKey: ["standardized-assessments", participantId] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("patientCheckin.submitFailed"));
    },
  });

  if (participantQuery.isLoading) return <PatientShell title={t("patientCheckin.title")}><PageSkeleton /></PatientShell>;
  if (!participantQuery.data) return <PatientShell title={t("patientCheckin.title")}><Card><EmptyState title={t("patientProfile.notFound")} /></Card></PatientShell>;

  if (activeInstrumentId) {
    const definition = INSTRUMENTS[activeInstrumentId];
    const allAnswered = answers.every((value) => value >= 0);
    return (
      <PatientShell title={locale === "ko" ? definition.nameKo : definition.nameEn}>
        <Card className="p-4">
          <div className="text-sm text-text-secondary">{locale === "ko" ? definition.instructionKo : definition.instructionEn}</div>
          <div className="mt-4 space-y-4">
            {definition.items.map((item, index) => (
              <div key={index} className="border-b border-border pb-3 last:border-0">
                <div className="text-sm text-text-primary">{index + 1}. {locale === "ko" ? item.textKo : item.textEn}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[0, 1, 2, 3].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAnswers((prev) => prev.map((existing, i) => (i === index ? value : existing)))}
                      className={`rounded-panel border px-2 py-2 text-xs transition ${
                        answers[index] === value ? "border-clinical-blue bg-clinical-blue-light text-clinical-blue" : "border-border text-text-secondary hover:bg-surface-hover"
                      }`}
                    >
                      {responseOptionLabel(value, locale)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => { setActiveInstrumentId(null); setAnswers([]); }}>{t("common.cancel")}</Button>
            <Button loading={submitMutation.isPending} disabled={!allAnswered} onClick={() => submitMutation.mutate()}>{t("patientCheckin.submit")}</Button>
          </div>
        </Card>
      </PatientShell>
    );
  }

  return (
    <PatientShell title={t("patientCheckin.title")}>
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.values(INSTRUMENTS)).map((definition) => (
          <Card key={definition.id} className="p-4">
            <div className="text-sm font-semibold text-text-primary">{locale === "ko" ? definition.nameKo : definition.nameEn}</div>
            <div className="mt-2 text-xs text-text-secondary">{locale === "ko" ? definition.instructionKo : definition.instructionEn}</div>
            <Button className="mt-3" onClick={() => startInstrument(definition.id)}>{t("patientCheckin.start")}</Button>
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-4">
        <div className="text-sm font-semibold text-text-primary">{t("patientCheckin.history")}</div>
        {historyQuery.data && historyQuery.data.length > 0 ? (
          <div className="mt-3 space-y-2">
            {historyQuery.data.map((response) => (
              <div key={response.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0">
                <span className="text-text-secondary">{formatTimestamp(response.submittedAt)} · {INSTRUMENTS[response.instrument].id === "phq9" ? "PHQ-9" : "GAD-7"}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-text-primary">{response.totalScore}</span>
                  <Badge tone={SEVERITY_TONE[response.severity]}>{t(`patientCheckin.severity.${response.severity}`)}</Badge>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs text-text-secondary">{t("patientCheckin.noHistory")}</div>
        )}
      </Card>
    </PatientShell>
  );
}
