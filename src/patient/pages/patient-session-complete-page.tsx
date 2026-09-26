"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, PartyPopper, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { SessionProgressChart } from "@/patient/components/session-progress-chart";
import { SESSION_TITLES } from "@/patient/pages/patient-list-page";
import { Button, Card, EmptyState, PageSkeleton } from "@/shared/components/ui/primitives";
import { getRuntimeSession } from "@/shared/api/runtime-session-api";
import { getRuntimeSessionSummary } from "@/shared/api/session-summary-api";
import { getPatientProgressSeries } from "@/shared/worksheet/worksheet-projection";
import { ensureHomeworkForSession } from "@/patient/lib/api/homework-api";
import { HOMEWORK_LABEL_BY_SESSION, hasHomeworkActivity } from "@/types/homework";
import { fadeScale, fadeUp, questComplete } from "@/shared/motion/motion-variants";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";
import { useT } from "@/shared/i18n/context";

/** Counts up from 0 to `value` once on mount (or jumps straight there under
 * prefers-reduced-motion) -- the one animated element in the "aha moment"
 * hero, everything else around it uses the app's ordinary fade/scale
 * variants. Purely presentational: it never re-triggers on its own, so a
 * background refetch that returns the same value doesn't replay it. */
function AnimatedPercent({ value, reducedMotion }: { value: number; reducedMotion: boolean }) {
  const [display, setDisplay] = useState(reducedMotion ? value : 0);
  useEffect(() => {
    if (reducedMotion) {
      setDisplay(value);
      return undefined;
    }
    let frame: number;
    const durationMs = 900;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reducedMotion]);
  return <>{display}</>;
}

export function PatientSessionCompletePage() {
  const { t, locale } = useT();
  const router = useRouter();
  const reducedMotion = useReducedMotionPreference();
  const params = useParams<{ sessionId: string }>();
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const sessionId = (Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId) ?? segments.at(-2) ?? "";
  const sessionQuery = useQuery({ queryKey: ["runtime-session-complete", sessionId], queryFn: () => getRuntimeSession(sessionId), enabled: Boolean(sessionId) });
  const summaryQuery = useQuery({ queryKey: ["runtime-session-summary-short", sessionId], queryFn: () => getRuntimeSessionSummary(sessionId), enabled: Boolean(sessionId) });
  const session = sessionQuery.data?.session;
  // Reuses the same projection the clinician cohort view already calls
  // client-side (see getCohortProgressSummary in monitoring/patient-list-page.tsx)
  // -- getPatientProgressSeries follows the identical pattern, just scoped
  // to one participant.
  const progressQuery = useQuery({
    queryKey: ["patient-progress-series", session?.participantId],
    queryFn: () => getPatientProgressSeries(session!.participantId),
    enabled: Boolean(session?.participantId),
  });
  if (sessionQuery.isLoading || summaryQuery.isLoading) return <PatientShell title={t("patientSessionComplete.title")}><PageSkeleton /></PatientShell>;
  if (!sessionQuery.data || !session) return <PatientShell title={t("patientSessionComplete.title")}><Card><EmptyState title={t("patientSessionComplete.notFound")} /></Card></PatientShell>;
  const { messages } = sessionQuery.data;
  const homeworkLabel = hasHomeworkActivity(session.sessionDefinitionId) ? HOMEWORK_LABEL_BY_SESSION[session.sessionDefinitionId] : undefined;
  const sessionNumber = Number(session.sessionDefinitionId.match(/s(\d+)/i)?.[1] ?? 0);
  const sessionTitle = SESSION_TITLES[locale][sessionNumber] ?? session.sessionDefinitionId;
  const progressCard = progressQuery.data?.find((card) => card.sessionDefinitionId === session.sessionDefinitionId);
  const firstSeries = progressCard?.series[0];
  const beforePoint = firstSeries?.points[0];
  const afterPoint = firstSeries?.points.at(-1);
  const delta = beforePoint && afterPoint ? afterPoint.value - beforePoint.value : undefined;

  return (
    <PatientShell title={t("patientSessionComplete.title")} sessionLabel={session.patientAlias} progressLabel={session.status}>
      <div className="mx-auto max-w-3xl space-y-5">
        <motion.div variants={reducedMotion ? undefined : fadeScale} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
          <Card className="overflow-hidden p-6 text-center sm:p-8">
            <motion.div
              variants={reducedMotion ? undefined : questComplete}
              initial={reducedMotion ? false : "initial"}
              animate={reducedMotion ? undefined : "animate"}
              className="relative mx-auto flex h-16 w-16 items-center justify-center"
            >
              <span className="rainbow-fill absolute inset-0 rounded-full opacity-20 blur-lg" aria-hidden />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-success-light bg-success-light text-success">
                <PartyPopper className="h-7 w-7" />
              </span>
              <Sparkles className="absolute -right-1 -top-1 h-5 w-5 text-warning" aria-hidden />
            </motion.div>
            <h2 className="mt-4 text-2xl font-bold text-text-primary">{t("patientSessionComplete.heroTitle")}</h2>
            <p className="mt-1 text-sm text-text-secondary">{t("patientSessionComplete.heroSubtitle", { title: sessionTitle })}</p>

            {beforePoint && afterPoint && delta !== undefined ? (
              <div className="mt-7">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{t("patientProfile.progress.title")}</div>
                <div className="mt-3 flex items-center justify-center gap-4 sm:gap-8">
                  <div className="text-center">
                    <div className="text-3xl font-black tracking-[-0.03em] text-text-secondary sm:text-4xl">{beforePoint.value}%</div>
                    <div className="mt-1 text-[11px] text-text-muted">{t(`patientProfile.progress.checkpoints.${beforePoint.checkpoint}`)}</div>
                  </div>
                  <ArrowRight className="h-6 w-6 shrink-0 text-text-muted" aria-hidden />
                  <div className="text-center">
                    <div className={`text-3xl font-black tracking-[-0.03em] sm:text-4xl ${delta <= 0 ? "text-success" : "text-warning"}`}>
                      <AnimatedPercent value={afterPoint.value} reducedMotion={Boolean(reducedMotion)} />%
                    </div>
                    <div className="mt-1 text-[11px] text-text-muted">{t(`patientProfile.progress.checkpoints.${afterPoint.checkpoint}`)}</div>
                  </div>
                </div>
                <div className={`mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${delta <= 0 ? "bg-success-light text-success" : "bg-warning-light text-warning"}`}>
                  {delta > 0 ? "+" : ""}{delta}pp · {t(delta <= 0 ? "patientSessionComplete.deltaDown" : "patientSessionComplete.deltaUp")}
                </div>
                {progressCard && (progressCard.series.length > 1 || firstSeries!.points.length > 2) && (
                  <div className="mt-5 text-left">
                    <SessionProgressChart card={progressCard} />
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-6 text-sm text-text-secondary">{t("patientSessionComplete.heroBodyGeneric")}</p>
            )}
          </Card>
        </motion.div>

        <motion.div variants={reducedMotion ? undefined : fadeUp} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
          <Card className="p-6">
            <div className="text-sm font-semibold text-text-primary">{t("patientSessionComplete.saved")}</div>
            <div className="mt-2 text-sm text-text-secondary">{t("patientSessionComplete.stored", { count: messages.length })}</div>
            <div className="mt-2 text-xs text-text-secondary">
              {t("patientSessionComplete.summaryStatus")}: {summaryQuery.data?.summaryStatus ?? t("patientSessionComplete.draftPending")}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/projects/demo/patient"><Button>{t("patientSessionComplete.sessions")}</Button></Link>
              <Link href={`/runtime/sessions/${session.id}/summary`}><Button variant="secondary">{t("patientSessionComplete.summary")}</Button></Link>
            </div>
          </Card>
        </motion.div>

        {homeworkLabel && (
          <motion.div variants={reducedMotion ? undefined : fadeUp} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
            <Card className="p-6">
              <div className="text-base font-semibold text-text-primary">{t("patientSessionComplete.followUpPrompt", { label: homeworkLabel })}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    await ensureHomeworkForSession(session);
                    router.push(`/projects/demo/patient/homework/${session.id}`);
                  }}
                >
                  {t("patientSessionComplete.startNow")}
                </Button>
                <Link href="/projects/demo/patient"><Button variant="secondary">{t("patientSessionComplete.saveForLater")}</Button></Link>
              </div>
            </Card>
          </motion.div>
        )}
      </div>
    </PatientShell>
  );
}
