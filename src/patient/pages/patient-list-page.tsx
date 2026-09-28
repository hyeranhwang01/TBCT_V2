"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, PartyPopper } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { UpcomingAppointmentsCard } from "@/patient/components/upcoming-appointments-card";
import { BOARD_BACKGROUND, GRAIN, PageBackdrop, PtButton, PtSkeleton } from "@/patient/components/ui/kit";
import { OnboardingTour } from "@/shared/components/onboarding/onboarding-tour";
import { createCanonicalTestRuntimeSession, listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { PATIENT_TOUR_STEPS } from "@/shared/onboarding/tour-steps";
import { useOnboardingTour } from "@/shared/onboarding/use-onboarding-tour";
import { UI_LOCALE_STORAGE_KEY, useT } from "@/shared/i18n/context";
import { useDevMode } from "@/shared/dev-mode/dev-mode";
import { mapToUiLocale } from "@/shared/i18n/locales";
import { useAuth } from "@/shared/auth/auth-context";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";
import { PATIENT_SESSIONS, sessionLabel, sessionMetaFor, sessionUnit } from "@/patient/lib/session-meta";
import { cn } from "@/shared/utils";

// Still exported from here for existing importers (the history page, the
// completion page's older copy); the implementation lives in
// components/session-record-card.tsx.
export { SessionGroup, SessionRow, sessionTitle, type ListedSession } from "@/patient/components/session-record-card";
import type { ListedSession } from "@/patient/components/session-record-card";

type JourneyState = "completed" | "in_progress" | "next" | "upcoming";

/** Patient-facing session titles by number (index 0 unused). Derived from
 * lib/session-meta.ts so there is one list to keep correct. */
export const SESSION_TITLES = {
  ko: ["", ...PATIENT_SESSIONS.map((session) => session.title.ko)],
  en: ["", ...PATIENT_SESSIONS.map((session) => session.title.en)],
} as const;

// Local-only visual check for the patient home. Bypasses neither the session
// API nor any clinical logic: only shown with ?preview=1 on the development
// server, to review the home layout before a development database exists.
export const LOCAL_PREVIEW_SESSIONS = [
  { id: "local-preview-s01", sessionDefinitionId: "tbct-s01", status: "completed", updatedAt: "2026-09-14T09:30:00.000Z" },
  { id: "local-preview-s02", sessionDefinitionId: "tbct-s02", status: "completed", updatedAt: "2026-09-14T10:15:00.000Z" },
  { id: "local-preview-s03", sessionDefinitionId: "tbct-s03", status: "waiting_for_input", updatedAt: "2026-09-14T11:00:00.000Z" },
] as ListedSession[];

const BASE = "/projects/demo/patient";

export function PatientListPage() {
  const { t, setLocale, locale } = useT();
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });
  const participant = participantQuery.data;
  // participant.locale is the therapy content's language. Adopt it for the UI
  // once, the first time -- but never over a language someone on this browser
  // already chose explicitly.
  useEffect(() => {
    if (!participant?.locale || typeof window === "undefined") return;
    if (window.localStorage.getItem(UI_LOCALE_STORAGE_KEY)) return;
    const mapped = mapToUiLocale(participant.locale);
    if (mapped) setLocale(mapped);
  }, [participant?.locale, setLocale]);
  // Scoped to this patient's own participant -- never the cross-patient list.
  const sessionsQuery = useQuery({
    queryKey: ["runtime-sessions", participant?.id],
    queryFn: () => listRuntimeSessionsForParticipant(participant!.id),
    enabled: Boolean(participant),
  });
  // ?preview=N (1-8) shows sessions 1..N-1 finished and N in progress, to
  // check the home with any session as the current one; any other value
  // shows the fixed screenshot records. Development server only; nothing is
  // saved.
  const previewParam = searchParams.get("preview");
  const localPreview = process.env.NODE_ENV === "development" && previewParam !== null;
  const sessions = useMemo(() => {
    if (!localPreview) return sessionsQuery.data ?? [];
    const upTo = Number(previewParam);
    if (!Number.isInteger(upTo) || upTo < 1 || upTo > 8) return LOCAL_PREVIEW_SESSIONS;
    return Array.from({ length: upTo }, (_, index) => ({
      id: `local-preview-n${index + 1}`,
      sessionDefinitionId: `tbct-s${String(index + 1).padStart(2, "0")}`,
      status: index + 1 < upTo ? "completed" : "waiting_for_input",
      updatedAt: "2026-09-14T09:30:00.000Z",
    })) as ListedSession[];
  }, [localPreview, previewParam, sessionsQuery.data]);
  const journey = useMemo(() => buildPatientJourney(sessions, locale), [locale, sessions]);

  const loading = sessionsQuery.isLoading || participantQuery.isLoading;
  // The tour only auto-starts once the page's targets exist.
  const tour = useOnboardingTour("patient", !loading);
  const replayRequested = searchParams.get("tour") === "1";
  const replayHandled = useRef(false);
  useEffect(() => {
    if (loading || !replayRequested || replayHandled.current) return;
    replayHandled.current = true;
    tour.replay();
    router.replace(BASE);
  }, [loading, replayRequested, router, tour]);

  if (loading) return <PatientShell title={t("patientPortal.title")} hideHeader><PtSkeleton /></PatientShell>;

  const alias = participant?.alias ?? (locale === "ko" ? "참여자" : "there");
  const name = locale === "ko" && alias === "Test Patient" ? "참여자" : alias;
  const now = new Date();
  const today = now.toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" });
  // Seoul hour, whatever the device clock's zone.
  const hour = Number(now.toLocaleString("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hour12: false })) % 24;
  const timeGreeting = t(hour >= 5 && hour < 12 ? "patientUi.home.greetMorning" : hour >= 12 && hour < 18 ? "patientUi.home.greetAfternoon" : "patientUi.home.greetEvening");
  // Generated study aliases ("Patient-1a2b3c4d") are not names; greet without one.
  const hasRealName = Boolean(participant?.alias) && !/^patient-[0-9a-f]{6,}$/i.test(alias) && alias !== "Test Patient";
  const heading = hasRealName ? t("patientUi.home.greetNamed", { name, greeting: timeGreeting }) : timeGreeting;

  return (
    <>
      <PatientShell title={t("patientUi.home.greeting", { name })} hideHeader>
        {/* Sized so the whole home -- greeting, spotlight and the journey
            with its names -- fits a 14" laptop browser (~780px tall) without
            scrolling; taller screens get the roomier spacing. */}
        <div className="space-y-8 pt-1 sm:pt-2 [@media(min-height:960px)]:space-y-14 [@media(min-height:960px)]:pt-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[20px] font-bold tracking-[-0.025em] text-text-primary sm:text-[22px]">{heading}</h1>
            <span className="text-[14px] font-medium text-text-muted">{today}</span>
          </div>
          <PatientJourney journey={journey} participant={participant} localPreview={localPreview} />
          {participant && <div data-tour-id="appointments"><UpcomingAppointmentsCard participantId={participant.id} /></div>}
        </div>
      </PatientShell>
      <OnboardingTour steps={PATIENT_TOUR_STEPS} active={tour.active} onDone={tour.finish} />
    </>
  );
}

// Staggers the journey nodes in on mount -- decorative, so skipped outright
// under prefers-reduced-motion.
const journeyList = { animate: { transition: { staggerChildren: 0.045 } } };
const journeyNode = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] } },
};

/** The home's single journey board: the eight-step path and, beneath it, the
 * session that comes next with its one button. The journey is the only thing
 * deciding which session a patient can start -- nothing in the API enforces
 * the order. With developer mode off the steps are a picture and the button is
 * the one way forward; developer mode makes every step its own entry point. */
export function PatientJourney({
  journey,
  participant,
  localPreview,
}: {
  journey: ReturnType<typeof buildPatientJourney>;
  participant: Awaited<ReturnType<typeof getOrCreateParticipantForUiLocale>> | undefined;
  localPreview: boolean;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const { enabled: devMode } = useDevMode();
  const reducedMotion = useReducedMotionPreference();
  const [isStarting, setIsStarting] = useState(false);
  const completed = journey.filter((item) => item.state === "completed").length;
  const current = journey.find((item) => item.state === "in_progress" || item.state === "next");
  const currentIndex = current ? current.number - 1 : 7;
  // The gold line runs from the first node's centre to the current one's.
  const trackFill = completed === 8 ? 1 : currentIndex / 7;

  // Opens one session: resumes the unfinished attempt if there is one,
  // otherwise starts it.
  const handleOpen = async (item: { number: number; sessionId?: string } | undefined) => {
    if (!item || isStarting || localPreview) return;
    if (item.sessionId) {
      router.push(`${BASE}/sessions/${item.sessionId}`);
      return;
    }
    setIsStarting(true);
    try {
      const session = await createCanonicalTestRuntimeSession({
        sessionDefinitionId: `tbct-s${String(item.number).padStart(2, "0")}`,
        locale: participant?.locale,
        participantId: participant?.id,
        patientAlias: participant?.alias,
      });
      router.push(`${BASE}/sessions/${session.id}`);
    } finally {
      setIsStarting(false);
    }
  };

  const currentMeta = current ? sessionMetaFor(current.number) : undefined;
  const headline = current
    ? current.state === "in_progress"
      ? t("patientUi.home.continueSession", { number: current.number })
      : t("patientJourney.currentSession", { number: current.number })
    : t("patientUi.home.allDoneTitle");

  return (
    <section data-tour-id="journey-continue" className="relative isolate">
      <PageBackdrop />
      {/* Spotlight: the session to do now, set as a headline on the page
          itself rather than inside a box. */}
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-16">
        <div className="min-w-0">
          {/* The session number only; the button below already says what to
              do. The full sentence stays for screen readers. */}
          <div className="inline-flex items-center gap-2 text-[15px] font-bold text-brand-ink">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              {!reducedMotion && current && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />}
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            <span aria-hidden="true">{current ? sessionLabel(current.number, locale) : t("patientUi.home.allDoneTitle")}</span>
            <span className="sr-only">{headline}</span>
          </div>
          {current && currentMeta ? (
            <>
              {/* Long (English) titles step down a size so they stay on one
                  line on a desktop; when a narrow screen has to wrap, the two
                  lines are balanced rather than leaving one word behind. */}
              <h2
                className={cn(
                  "mt-5 text-balance font-extrabold leading-[1.1] tracking-[-0.045em] text-text-primary",
                  currentMeta.title[locale].length > 18 ? "text-[30px] sm:text-[40px]" : "text-[38px] sm:text-[52px]",
                )}
              >
                {currentMeta.title[locale]}
              </h2>
              <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-text-secondary">{currentMeta.purpose[locale]}</p>
              <PtButton size="lg" className="group mt-7 h-14 px-9 text-[17px] [@media(min-height:960px)]:mt-8" onClick={() => void handleOpen(current)} disabled={isStarting || localPreview}>
                {isStarting ? t("patientJourney.starting") : current.sessionId ? t("patientJourney.continue") : t("patientUi.home.start")}
                <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
              </PtButton>
            </>
          ) : (
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-text-secondary">{t("patientUi.home.allDoneBody")}</p>
          )}
        </div>
        <SessionOrb number={current?.number} completed={completed} reducedMotion={Boolean(reducedMotion)} />
      </div>

      {/* The eight-step path, laid straight on the page. */}
      <div className="mt-10 [@media(min-height:960px)]:mt-16">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-bold text-text-primary">{t("patientJourney.heading")}</h3>
          <span className="inline-flex items-center gap-1.5 text-[14px] font-bold tabular-nums text-text-secondary" aria-label={t("patientJourney.progress", { completed })}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold text-[#2a2208]" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3.5} /></span>
            <span aria-hidden="true">{completed} <span className="font-semibold text-text-muted">/ 8</span></span>
          </span>
        </div>
        <motion.ol
          className="relative mt-5 grid grid-cols-8"
          variants={reducedMotion ? undefined : journeyList}
          initial={reducedMotion ? false : "initial"}
          animate={reducedMotion ? undefined : "animate"}
        >
          <span className="absolute left-[6.25%] right-[6.25%] top-[22px] h-1 rounded-full bg-border sm:top-[27px]" aria-hidden="true">
            <motion.span
              className="block h-full origin-left rounded-full bg-[linear-gradient(90deg,#E5A51E,#F6C65B)]"
              style={{ width: `${trackFill * 100}%` }}
              initial={reducedMotion ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.9, delay: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            />
          </span>
          {journey.map((item) => {
            const meta = sessionMetaFor(item.number);
            const isCurrent = item.state === "in_progress" || item.state === "next";
            const node = (
              <span className="relative z-10 flex h-10 w-10 items-center justify-center sm:h-[50px] sm:w-[50px]">
                {isCurrent && <span className={cn("absolute inset-[-4px] rounded-full bg-brand/15 sm:inset-[-6px]", !reducedMotion && "animate-pulse")} aria-hidden="true" />}
                <span
                  className={cn(
                    "relative flex items-center justify-center rounded-full font-extrabold tracking-[-0.03em]",
                    item.state === "completed" && "h-7 w-7 bg-[linear-gradient(145deg,#F8CD6A,#E5A51E)] text-[#2a2208] shadow-[0_3px_10px_rgba(229,165,30,0.35)] sm:h-10 sm:w-10",
                    isCurrent && "h-9 w-9 bg-brand text-[15px] text-white shadow-[0_8px_20px_rgb(var(--color-brand)/0.35)] sm:h-[50px] sm:w-[50px] sm:text-[20px]",
                    item.state === "upcoming" && "h-7 w-7 border-2 border-border bg-surface text-[12px] text-text-muted sm:h-10 sm:w-10 sm:text-[15px]",
                  )}
                >
                  {item.state === "completed" ? <Check className="h-3.5 w-3.5 sm:h-[18px] sm:w-[18px]" strokeWidth={3} /> : item.number}
                </span>
              </span>
            );
            const labels = (
              <>
                {/* Names only where a column is wide enough to show them whole
                    (two lines at most, no ellipsis); narrower screens show the
                    numbers alone, and the spotlight names the current session. */}
                <span className="hidden w-full flex-col items-center lg:flex" aria-hidden="true">
                  <span className={cn("mt-3 text-[11px] font-semibold", isCurrent ? "text-brand-ink" : "text-text-muted")}>{isCurrent ? t("patientUi.home.now") : sessionLabel(item.number, locale)}</span>
                  <span className={cn("mt-0.5 w-full text-balance px-1.5 text-[13px] font-semibold leading-snug", item.state === "upcoming" ? "text-text-muted" : "text-text-primary")}>{meta?.title[locale] ?? item.title}</span>
                </span>
                <span className="sr-only">{sessionLabel(item.number, locale)} · {meta?.title[locale] ?? item.title} · {t(`patientJourney.${item.state}`)}</span>
              </>
            );
            return (
              <motion.li key={item.number} variants={reducedMotion ? undefined : journeyNode} className="flex flex-col items-center text-center">
                {devMode ? (
                  <button
                    type="button"
                    onClick={() => void handleOpen(item)}
                    disabled={isStarting || localPreview}
                    aria-label={t("devMode.openSession", { number: item.number, title: meta?.title[locale] ?? item.title })}
                    className="transition-ui flex w-full flex-col items-center rounded-2xl p-1 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    {node}
                    {labels}
                  </button>
                ) : (
                  <div className="flex w-full flex-col items-center p-1">
                    {node}
                    {labels}
                  </div>
                )}
              </motion.li>
            );
          })}
        </motion.ol>
      </div>
    </section>
  );
}

/** The home's one visual: a deep-green orb holding the current session
 * number, circled by eight arcs -- one per session, gold when done, green
 * for the one now. Decorative -- the headline beside it says it in words. */
function SessionOrb({ number, completed, reducedMotion }: { number?: number; completed: number; reducedMotion: boolean }) {
  const { t, locale } = useT();
  const size = 320;
  const stroke = 9;
  const radius = size / 2 - stroke;
  const circumference = 2 * Math.PI * radius;
  const gap = 10;
  const segment = circumference / 8 - gap;
  return (
    <div className="relative mx-auto hidden aspect-square w-full max-w-[270px] lg:block [@media(min-height:960px)]:max-w-[340px]" aria-hidden="true">
      <div className="absolute inset-[6%] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(242,181,68,0.35), rgba(29,74,49,0.25) 60%, transparent 70%)" }} />
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 h-full w-full -rotate-90">
        <defs>
          <linearGradient id="orb-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F8CD6A" />
            <stop offset="100%" stopColor="#E5A51E" />
          </linearGradient>
        </defs>
        {Array.from({ length: 8 }, (_, index) => {
          const done = index < completed;
          const now = number !== undefined && index === number - 1;
          return (
            <motion.circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={done ? "url(#orb-gold)" : now ? "rgb(var(--color-brand))" : "rgb(var(--color-border))"}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${segment} ${circumference - segment}`}
              strokeDashoffset={-(index * (circumference / 8) + gap / 2)}
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.15 + index * 0.07 }}
            />
          );
        })}
      </svg>
      <div
        className="absolute inset-[9%] flex flex-col items-center justify-center overflow-hidden rounded-full text-white shadow-[0_30px_60px_-20px_rgba(14,40,26,0.6),inset_0_1px_0_rgba(255,255,255,0.12)]"
        style={{ background: BOARD_BACKGROUND }}
      >
        <span className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
        {number ? (
          <>
            <span className="relative rounded-full bg-white/10 px-3 py-1 text-[14px] font-bold text-[#F6C65B]">{t("patientUi.home.now")}</span>
            {/* One line in both languages: "4회기" / "Session 4". */}
            {/* Korean sits "회기" on the number's baseline; English centres
                "Session" on the number, which reads as one label. */}
            <span className={cn("relative mt-3 flex gap-1.5", locale === "en" ? "items-center gap-3" : "items-baseline")}>
              {locale === "en" && <span className="pt-1.5 text-[24px] font-bold tracking-[-0.02em] text-white/80 [@media(min-height:960px)]:pt-2 [@media(min-height:960px)]:text-[30px]">{sessionUnit(locale)}</span>}
              <span className="text-[88px] font-extrabold leading-[0.9] tracking-[-0.06em] [@media(min-height:960px)]:text-[112px]">{number}</span>
              {locale === "ko" && <span className="text-[24px] font-bold tracking-[-0.03em] text-white/80 [@media(min-height:960px)]:text-[30px]">{sessionUnit(locale)}</span>}
            </span>
          </>
        ) : (
          <PartyPopper className="relative h-20 w-20 text-[#F6C65B]" />
        )}
      </div>
    </div>
  );
}

export function buildPatientJourney(sessions: ListedSession[], locale: "ko" | "en") {
  const completedNumbers = new Set(
    sessions
      .filter((session) => session.status === "completed")
      .map((session) => Number(session.sessionDefinitionId.match(/s(\d+)$/i)?.[1] ?? 0)),
  );
  const nextNumber = Array.from({ length: 8 }, (_, index) => index + 1).find((number) => !completedNumbers.has(number));

  return Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    const attempts = sessions.filter((session) => session.sessionDefinitionId === `tbct-s${String(number).padStart(2, "0")}`).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    // A patient may have older attempts that ended before completion. The
    // home "Continue" action must target the most recent unfinished attempt,
    // never simply the most recently updated record for this session number.
    const activeAttempt = attempts.find((session) => !["completed", "failed", "terminated"].includes(session.status));
    const hasActiveAttempt = Boolean(activeAttempt);
    const state: JourneyState = completedNumbers.has(number)
      ? "completed"
      : nextNumber === number && hasActiveAttempt
        ? "in_progress"
        : nextNumber === number
          ? "next"
          : "upcoming";
    return { number, state, title: SESSION_TITLES[locale][number], sessionId: activeAttempt?.id };
  });
}
