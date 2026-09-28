"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, FileText, Home, Lightbulb, NotebookTabs, PartyPopper, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { SessionProgressChart } from "@/patient/components/session-progress-chart";
import { homeworkTitle } from "@/patient/components/session-record-card";
import { EmptyBlock, IconTile, ListGroup, ListRow, ProgressBar, PtButton, PtCard, PtLinkButton, PtSkeleton, SessionNumber } from "@/patient/components/ui/kit";
import { getRuntimeSession, listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { getRuntimeSessionSummary } from "@/shared/api/session-summary-api";
import { getPatientProgressSeries } from "@/shared/worksheet/worksheet-projection";
import { ensureHomeworkForSession } from "@/patient/lib/api/homework-api";
import { hasHomeworkActivity } from "@/types/homework";
import { fadeScale, fadeUp, questComplete } from "@/shared/motion/motion-variants";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";
import { useT } from "@/shared/i18n/context";
import { sessionLabel, sessionMetaFor, sessionNumberOf, sessionUnit } from "@/patient/lib/session-meta";

const BASE = "/projects/demo/patient";

/** Counts up from 0 to `value` once on mount (or jumps straight there under
 * prefers-reduced-motion). Purely presentational. */
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

// The one field per session where the participant sums up, in their own
// words, what the session showed them. Sessions without such a field show no
// insight card.
const INSIGHT_FIELD: Record<string, string> = {
  "tbct-s03": "balancedConclusion",
  "tbct-s06": "circuitTwoSummary",
  "tbct-s07": "consensusLearning",
};

export function PatientSessionCompletePage() {
  const { t, locale } = useT();
  const router = useRouter();
  const reducedMotion = Boolean(useReducedMotionPreference());
  const params = useParams<{ sessionId: string }>();
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const sessionId = (Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId) ?? segments.at(-2) ?? "";
  const sessionQuery = useQuery({ queryKey: ["runtime-session-complete", sessionId], queryFn: () => getRuntimeSession(sessionId), enabled: Boolean(sessionId) });
  // A session with no summary yet resolves to undefined, which React Query
  // rejects as query data; null means the same thing and is allowed.
  const summaryQuery = useQuery({ queryKey: ["runtime-session-summary-short", sessionId], queryFn: async () => (await getRuntimeSessionSummary(sessionId)) ?? null, enabled: Boolean(sessionId) });
  const session = sessionQuery.data?.session;
  // Same projection the clinician cohort view calls client-side, scoped to
  // this one participant.
  const progressQuery = useQuery({
    queryKey: ["patient-progress-series", session?.participantId],
    queryFn: () => getPatientProgressSeries(session!.participantId),
    enabled: Boolean(session?.participantId),
  });
  const journeyQuery = useQuery({
    queryKey: ["runtime-sessions", session?.participantId],
    queryFn: () => listRuntimeSessionsForParticipant(session!.participantId),
    enabled: Boolean(session?.participantId),
  });

  if (sessionQuery.isLoading || summaryQuery.isLoading) return <PatientShell title={t("patientSessionComplete.title")} hideHeader><PtSkeleton /></PatientShell>;
  if (!sessionQuery.data || !session) {
    return (
      <PatientShell title={t("patientSessionComplete.title")} hideHeader>
        <PtCard><EmptyBlock icon={<FileText />} title={t("patientSessionComplete.notFound")} action={<PtLinkButton href={BASE} variant="secondary">{t("patientUi.complete.home")}</PtLinkButton>} /></PtCard>
      </PatientShell>
    );
  }
  const { messages } = sessionQuery.data;
  const hasHomework = hasHomeworkActivity(session.sessionDefinitionId);
  const insightField = INSIGHT_FIELD[session.sessionDefinitionId];
  const insightValue = insightField ? session.runtimeContext.fields[insightField] : undefined;
  const insight = typeof insightValue === "string" ? insightValue.trim() : "";
  const number = sessionNumberOf(session.sessionDefinitionId);
  const meta = sessionMetaFor(session.sessionDefinitionId);
  const nextMeta = sessionMetaFor(number + 1);
  const progressCard = progressQuery.data?.find((card) => card.sessionDefinitionId === session.sessionDefinitionId);
  const firstSeries = progressCard?.series[0];
  const beforePoint = firstSeries?.points[0];
  const afterPoint = firstSeries?.points.at(-1);
  const delta = beforePoint && afterPoint ? afterPoint.value - beforePoint.value : undefined;
  const completedCount = new Set((journeyQuery.data ?? []).filter((item) => item.status === "completed").map((item) => item.sessionDefinitionId)).size;

  return (
    <PatientShell title={t("patientSessionComplete.title")} hideHeader backHref={BASE}>
      <div className="mx-auto max-w-2xl space-y-5">
        <motion.section
          variants={reducedMotion ? undefined : fadeScale}
          initial={reducedMotion ? false : "initial"}
          animate={reducedMotion ? undefined : "animate"}
          className="relative overflow-hidden rounded-card bg-[rgb(var(--color-brand-deep))] px-6 pb-7 pt-8 text-center text-white shadow-[var(--pt-shadow-lg)] sm:px-10"
        >
          <svg className="pointer-events-none absolute -left-20 -top-24 h-72 w-72" viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="80" fill="none" stroke="rgb(var(--color-gold))" strokeOpacity="0.25" strokeWidth="2" />
          </svg>
          <motion.div
            variants={reducedMotion ? undefined : questComplete}
            initial={reducedMotion ? false : "initial"}
            animate={reducedMotion ? undefined : "animate"}
            className="relative mx-auto flex h-16 w-16 items-center justify-center"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gold text-[#2a2208]">
              <PartyPopper className="h-8 w-8" />
            </span>
            <Sparkles className="absolute -right-2 -top-1 h-5 w-5 text-gold" aria-hidden="true" />
          </motion.div>
          <div className="relative mt-5 text-[13px] font-semibold text-white/70">{sessionLabel(number, locale)}{meta ? ` · ${meta.title[locale]}` : ""}</div>
          <h1 className="relative mt-1 text-[28px] font-bold tracking-[-0.03em]">{t("patientUi.complete.title", { number })}</h1>
          <p className="relative mt-1.5 text-[15px] text-white/80">{t("patientSessionComplete.heroTitle")}</p>

          {beforePoint && afterPoint && delta !== undefined ? (
            <div className="relative mx-auto mt-6 max-w-md rounded-2xl bg-white/[0.08] p-5 ring-1 ring-white/10">
              <div className="text-xs font-semibold text-white/60">{t("patientProfile.progress.title")}</div>
              <div className="mt-3 flex items-center justify-center gap-5 sm:gap-8">
                <div>
                  <div className="text-4xl font-extrabold tracking-[-0.03em] text-white/60">{beforePoint.value}%</div>
                  <div className="mt-1 text-xs text-white/50">{t(`patientProfile.progress.checkpoints.${beforePoint.checkpoint}`)}</div>
                </div>
                <ArrowRight className="h-6 w-6 shrink-0 text-white/40" aria-hidden="true" />
                <div>
                  <div className="text-4xl font-extrabold tracking-[-0.03em] text-gold">
                    <AnimatedPercent value={afterPoint.value} reducedMotion={reducedMotion} />%
                  </div>
                  <div className="mt-1 text-xs text-white/50">{t(`patientProfile.progress.checkpoints.${afterPoint.checkpoint}`)}</div>
                </div>
              </div>
              <div className="mt-4 inline-flex items-center rounded-full bg-gold/15 px-3 py-1 text-xs font-bold text-gold">
                {delta === 0 ? t("patientUi.session.momentSame") : t(delta < 0 ? "patientUi.session.momentDown" : "patientUi.session.momentUp", { delta: Math.abs(delta) })}
              </div>
            </div>
          ) : (
            <p className="relative mx-auto mt-5 max-w-sm text-[15px] leading-relaxed text-white/80">{t("patientSessionComplete.heroBodyGeneric")}</p>
          )}

          {journeyQuery.data && (
            <div className="relative mx-auto mt-6 max-w-xs">
              <ProgressBar value={(completedCount / 8) * 100} className="bg-white/15" />
              <div className="mt-2 text-xs font-medium text-white/70">{t("patientUi.complete.journey", { completed: completedCount })}</div>
            </div>
          )}
        </motion.section>

        {progressCard && (progressCard.series.length > 1 || (firstSeries?.points.length ?? 0) > 2) && (
          <motion.div variants={reducedMotion ? undefined : fadeUp} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
            <SessionProgressChart card={progressCard} />
          </motion.div>
        )}

        {insight && (
          <motion.div variants={reducedMotion ? undefined : fadeUp} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
            <PtCard className="border-gold/40 bg-gold-soft p-5 sm:p-6">
              <div className="flex items-center gap-2 text-[13px] font-bold text-gold-strong">
                <Lightbulb className="h-4 w-4" aria-hidden="true" />
                {t("patientUi.complete.insightTitle")}
              </div>
              <blockquote className="mt-3 whitespace-pre-wrap break-words text-[18px] font-semibold leading-relaxed tracking-[-0.01em] text-text-primary">“{insight}”</blockquote>
              <p className="mt-2 text-[13px] text-text-secondary">{t("patientUi.complete.insightHint")}</p>
            </PtCard>
          </motion.div>
        )}

        {hasHomework && (
          <motion.div variants={reducedMotion ? undefined : fadeUp} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
            <PtCard className="p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <IconTile icon={<NotebookTabs />} tone="gold" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-gold-strong">{t("patientUi.complete.homeworkTitle")}</div>
                  <h2 className="mt-0.5 text-[17px] font-bold text-text-primary">{homeworkTitle(t, session.sessionDefinitionId)}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-text-secondary">{t("patientUi.complete.homeworkBody")}</p>
                </div>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <PtButton
                  size="lg"
                  onClick={async () => {
                    await ensureHomeworkForSession(session);
                    router.push(`${BASE}/homework/${session.id}`);
                  }}
                >
                  {t("patientSessionComplete.startNow")}
                </PtButton>
                <PtLinkButton href={BASE} variant="secondary" size="lg">{t("patientSessionComplete.saveForLater")}</PtLinkButton>
              </div>
            </PtCard>
          </motion.div>
        )}

        {nextMeta && (
          <PtCard className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <SessionNumber number={nextMeta.number} caption={sessionUnit(locale)} tone="soft" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-brand-ink">{t("patientUi.complete.nextTitle")}</div>
                <h2 className="mt-0.5 text-[17px] font-bold text-text-primary">{nextMeta.title[locale]}</h2>
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">{nextMeta.purpose[locale]}</p>
              </div>
            </div>
          </PtCard>
        )}

        <ListGroup title={t("patientUi.complete.recordTitle")}>
          <ListRow
            icon={<FileText />}
            tone="neutral"
            title={t("patientSessionComplete.saved")}
            description={t("patientSessionComplete.stored", { count: messages.length })}
          />
          <ListRow href={BASE} icon={<Home />} title={t("patientUi.complete.home")} />
        </ListGroup>
      </div>
    </PatientShell>
  );
}
