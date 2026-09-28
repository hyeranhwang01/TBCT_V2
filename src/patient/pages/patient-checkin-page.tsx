"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Brain, CheckCircle2, HeartPulse, LifeBuoy, UserRound } from "lucide-react";
import { PatientShell } from "@/patient/components/patient-shell";
import { EmptyBlock, IconTile, ListGroup, ProgressBar, PtButton, PtCard, PtSkeleton, StatusPill } from "@/patient/components/ui/kit";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { submitStandardizedAssessment, listStandardizedAssessments } from "@/shared/api/standardized-assessment-api";
import { INSTRUMENTS, responseOptionLabel } from "@/shared/standardized-assessments/instruments";
import { useT } from "@/shared/i18n/context";
import { useAuth } from "@/shared/auth/auth-context";
import { cn } from "@/shared/utils";
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

/** Patient-facing PHQ-9/GAD-7 check-in, asked one question at a time. Fires
 * the safety-alert route (never sendSafetyAlertEmail directly -- see that
 * route's doc comment) the same non-blocking way runtime-execution-api.ts
 * does when the self-harm item scores > 0. */
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
  const [questionIndex, setQuestionIndex] = useState(0);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const startInstrument = (instrumentId: StandardizedInstrumentId) => {
    setActiveInstrumentId(instrumentId);
    setAnswers(new Array(INSTRUMENTS[instrumentId].items.length).fill(-1));
    setQuestionIndex(0);
    setJustSubmitted(false);
  };
  const exitInstrument = () => {
    setActiveInstrumentId(null);
    setAnswers([]);
    setQuestionIndex(0);
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
      exitInstrument();
      setJustSubmitted(true);
      await queryClient.invalidateQueries({ queryKey: ["standardized-assessments", participantId] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("patientCheckin.submitFailed"));
    },
  });

  if (participantQuery.isLoading) return <PatientShell title={t("patientCheckin.title")}><PtSkeleton /></PatientShell>;
  if (!participantQuery.data) return <PatientShell title={t("patientCheckin.title")}><PtCard><EmptyBlock icon={<UserRound />} title={t("patientProfile.notFound")} /></PtCard></PatientShell>;

  if (activeInstrumentId) {
    const definition = INSTRUMENTS[activeInstrumentId];
    const total = definition.items.length;
    const item = definition.items[questionIndex];
    const isLast = questionIndex === total - 1;
    const allAnswered = answers.every((value) => value >= 0);
    const choose = (value: number) => {
      setAnswers((prev) => prev.map((existing, i) => (i === questionIndex ? value : existing)));
      if (!isLast) window.setTimeout(() => setQuestionIndex((index) => Math.min(index + 1, total - 1)), 180);
    };
    return (
      <PatientShell title={locale === "ko" ? definition.nameKo : definition.nameEn} hideHeader>
        <div className="mx-auto max-w-xl">
          <div className="mb-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => (questionIndex === 0 ? exitInstrument() : setQuestionIndex(questionIndex - 1))}
              className="transition-ui inline-flex h-10 w-10 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover"
              aria-label={questionIndex === 0 ? t("common.cancel") : t("patientUi.checkin.previous")}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1">
              <div className="mb-1.5 flex justify-between text-xs font-semibold text-text-muted">
                <span>{locale === "ko" ? definition.nameKo : definition.nameEn}</span>
                <span>{t("patientUi.checkin.progress", { current: questionIndex + 1, total })}</span>
              </div>
              <ProgressBar value={((questionIndex + (answers[questionIndex] >= 0 ? 1 : 0)) / total) * 100} />
            </div>
          </div>

          <p className="text-[13px] leading-relaxed text-text-secondary">{locale === "ko" ? definition.instructionKo : definition.instructionEn}</p>
          <h1 key={questionIndex} className="pt-rise mt-3 text-[22px] font-bold leading-snug tracking-[-0.02em] text-text-primary sm:text-[24px]">
            {locale === "ko" ? item.textKo : item.textEn}
          </h1>

          <div className="mt-7 grid gap-2.5" role="radiogroup" aria-label={locale === "ko" ? item.textKo : item.textEn}>
            {[0, 1, 2, 3].map((value) => {
              const selected = answers[questionIndex] === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => choose(value)}
                  className={cn(
                    "transition-ui flex w-full items-center gap-3 rounded-2xl border px-4 py-4 text-left text-[15px] font-semibold active:scale-[0.99]",
                    selected ? "border-brand bg-brand-soft text-brand-ink shadow-[inset_0_0_0_1px_rgb(var(--color-brand))]" : "border-border bg-surface text-text-primary hover:bg-surface-hover",
                  )}
                >
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-brand bg-brand text-white" : "border-border-strong")} aria-hidden="true">
                    {selected && <CheckCircle2 className="h-4 w-4" />}
                  </span>
                  {responseOptionLabel(value, locale)}
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex gap-2">
            {!isLast ? (
              <PtButton size="lg" block variant="secondary" disabled={answers[questionIndex] < 0} onClick={() => setQuestionIndex(questionIndex + 1)}>
                {t("patientUi.checkin.next")}
              </PtButton>
            ) : (
              <PtButton size="lg" block loading={submitMutation.isPending} disabled={!allAnswered} onClick={() => submitMutation.mutate()}>
                {t("patientCheckin.submit")}
              </PtButton>
            )}
          </div>
        </div>
      </PatientShell>
    );
  }

  const topic: Record<StandardizedInstrumentId, string> = { phq9: t("patientUi.checkin.phq9Topic"), gad7: t("patientUi.checkin.gad7Topic") } as Record<StandardizedInstrumentId, string>;

  return (
    <PatientShell title={t("patientCheckin.title")} description={t("patientUi.checkin.description")} backHref="/projects/demo/patient/profile">
      <div className="mx-auto max-w-2xl space-y-6">
        {justSubmitted && (
          <PtCard className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <IconTile icon={<CheckCircle2 />} tone="success" />
              <div>
                <h2 className="text-[17px] font-bold text-text-primary">{t("patientUi.checkin.doneTitle")}</h2>
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">{t("patientUi.checkin.doneBody")}</p>
                <p className="mt-3 text-sm text-text-secondary">
                  {t("patientUi.checkin.doneHelp")}{" "}
                  <Link href="/crisis" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-critical underline-offset-4 hover:underline">
                    <LifeBuoy className="h-4 w-4" aria-hidden="true" />
                    {t("patientUi.profile.crisis")}
                  </Link>
                </p>
              </div>
            </div>
          </PtCard>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {Object.values(INSTRUMENTS).map((definition) => (
            <section key={definition.id} className="flex flex-col rounded-card bg-surface p-5 shadow-[var(--pt-shadow-sm)]">
              <div className="flex items-center gap-3">
                <IconTile icon={definition.id === "phq9" ? <HeartPulse /> : <Brain />} tone={definition.id === "phq9" ? "critical" : "gold"} />
                <div>
                  <div className="text-[13px] font-semibold text-text-muted">{topic[definition.id]} · {t("patientUi.checkin.items", { count: definition.items.length })}</div>
                  <h2 className="text-[16px] font-bold text-text-primary">{locale === "ko" ? definition.nameKo : definition.nameEn}</h2>
                </div>
              </div>
              <p className="mt-3 flex-1 text-[13px] leading-relaxed text-text-secondary">{locale === "ko" ? definition.instructionKo : definition.instructionEn}</p>
              <PtButton className="mt-4" block onClick={() => startInstrument(definition.id)}>{t("patientCheckin.start")}</PtButton>
            </section>
          ))}
        </div>

        <ListGroup title={t("patientCheckin.history")}>
          {historyQuery.data && historyQuery.data.length > 0 ? (
            historyQuery.data.map((response) => (
              <div key={response.id} className="flex items-center justify-between gap-3 px-4 py-3.5 text-sm">
                <span className="text-text-secondary">{formatTimestamp(response.submittedAt)} · {INSTRUMENTS[response.instrument].id === "phq9" ? "PHQ-9" : "GAD-7"}</span>
                <span className="flex items-center gap-2">
                  <span className="font-bold text-text-primary">{response.totalScore}</span>
                  <StatusPill tone={SEVERITY_TONE[response.severity]}>{t(`patientCheckin.severity.${response.severity}`)}</StatusPill>
                </span>
              </div>
            ))
          ) : (
            <div className="px-4 py-5 text-sm text-text-muted">{t("patientCheckin.noHistory")}</div>
          )}
        </ListGroup>
      </div>
    </PatientShell>
  );
}
