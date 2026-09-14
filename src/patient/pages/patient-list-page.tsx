"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDot, ClipboardList, History, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { UpcomingAppointmentsCard } from "@/patient/components/upcoming-appointments-card";
import { OnboardingTour } from "@/shared/components/onboarding/onboarding-tour";
import { Badge, Button, Card, PageSkeleton } from "@/shared/components/ui/primitives";
import { createCanonicalTestRuntimeSession, listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { PATIENT_TOUR_STEPS } from "@/shared/onboarding/tour-steps";
import { useOnboardingTour } from "@/shared/onboarding/use-onboarding-tour";
import { HOMEWORK_LABEL_BY_SESSION, hasHomeworkActivity } from "@/types/homework";
import { UI_LOCALE_STORAGE_KEY, useT } from "@/shared/i18n/context";
import { mapToUiLocale } from "@/shared/i18n/locales";
import { useAuth } from "@/shared/auth/auth-context";

export type ListedSession = Awaited<ReturnType<typeof listRuntimeSessionsForParticipant>>[number];
type JourneyState = "completed" | "in_progress" | "next" | "upcoming";

const SESSION_TITLES = {
  ko: ["", "TBCT 모델 소개", "문제와 목표", "개인 내적 사고 기록", "대인관계 사고 기록", "참여 격자", "색상별 증상 위계", "합의된 역할극", "첫 번째 시도"],
  en: ["", "TBCT model introduction", "Problems and goals", "Intrapersonal thought record", "Interpersonal thought record", "Participation grid", "Color-coded symptoms hierarchy", "Consensual role-play", "Trial one"],
} as const;

// Local-only visual check for the patient home. This bypasses neither the
// session API nor any clinical logic: it is only shown with ?preview=1 while
// running the development server, and lets us review the empty-to-in-progress
// home layout before a development database is connected.
export const LOCAL_PREVIEW_SESSIONS = [
  {
    id: "local-preview-s01",
    sessionDefinitionId: "tbct-s01",
    status: "completed",
    updatedAt: "2026-09-14T09:30:00.000Z",
  },
  {
    id: "local-preview-s02",
    sessionDefinitionId: "tbct-s02",
    status: "completed",
    updatedAt: "2026-09-14T10:15:00.000Z",
  },
  {
    id: "local-preview-s03",
    sessionDefinitionId: "tbct-s03",
    status: "waiting_for_input",
    updatedAt: "2026-09-14T11:00:00.000Z",
  },
] as ListedSession[];

export function PatientListPage() {
  const { t, setLocale, locale } = useT();
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });
  const participant = participantQuery.data;
  // participant.locale drives the actual therapy session content's
  // language (see runtime-execution-api.ts) -- a distinct, clinically-
  // significant setting from this app's own UI chrome text, which
  // defaults to Korean for everyone and (until now) never looked at this
  // field at all. That left a patient whose record clearly says "en-US"
  // landing on a portal that's entirely in Korean with no obvious reason
  // why and no way to fix it themselves. Auto-adopt it once, the very
  // first time this page loads for them -- but only if nothing (this
  // patient, or a clinician sharing this browser) has ever explicitly
  // picked a UI language before, so it never overrides a real choice.
  useEffect(() => {
    if (!participant?.locale || typeof window === "undefined") return;
    if (window.localStorage.getItem(UI_LOCALE_STORAGE_KEY)) return;
    const mapped = mapToUiLocale(participant.locale);
    if (mapped) setLocale(mapped);
  }, [participant?.locale, setLocale]);
  // Scoped to this logged-in patient's own participant -- never the full
  // cross-patient list (that's the clinician-facing Patient Monitoring page).
  const sessionsQuery = useQuery({
    queryKey: ["runtime-sessions", participant?.id],
    queryFn: () => listRuntimeSessionsForParticipant(participant!.id),
    enabled: Boolean(participant),
  });
  const localPreview = process.env.NODE_ENV === "development" && searchParams.get("preview") === "1";
  const sessions = useMemo(
    () => localPreview ? LOCAL_PREVIEW_SESSIONS : sessionsQuery.data ?? [],
    [localPreview, sessionsQuery.data],
  );
  const journey = useMemo(() => buildPatientJourney(sessions, locale), [locale, sessions]);

  const loading = sessionsQuery.isLoading || participantQuery.isLoading;
  // Gate the tour's auto-start on the page's own data having actually
  // loaded -- otherwise it could fire while this is still a skeleton (none
  // of the data-tour-id targets below exist yet), find nothing, and mark
  // itself "seen" without the user ever having seen it.
  const tour = useOnboardingTour("patient", !loading);
  const replayRequested = searchParams.get("tour") === "1";
  const replayHandled = useRef(false);
  useEffect(() => {
    if (loading || !replayRequested || replayHandled.current) return;
    replayHandled.current = true;
    tour.replay();
    router.replace("/projects/demo/patient");
  }, [loading, replayRequested, router, tour]);

  if (loading) return <PatientShell title={t("patientPortal.title")}><PageSkeleton /></PatientShell>;
  return (
    <>
      <PatientShell
        title={locale === "ko" ? `안녕하세요, ${participant?.alias ?? "세션"}님! 👋` : `Hello, ${participant?.alias ?? "there"}! 👋`}
      >
        <div className="space-y-5">
          <PatientJourney journey={journey} participant={participant} localPreview={localPreview} />
          {participant && <div data-tour-id="appointments"><UpcomingAppointmentsCard participantId={participant.id} /></div>}
        </div>
      </PatientShell>
      <OnboardingTour steps={PATIENT_TOUR_STEPS} active={tour.active} onDone={tour.finish} />
    </>
  );
}

function PatientJourney({ journey, participant, localPreview }: { journey: ReturnType<typeof buildPatientJourney>; participant: Awaited<ReturnType<typeof getOrCreateParticipantForUiLocale>> | undefined; localPreview: boolean }) {
  const { t, locale } = useT();
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const completed = journey.filter((item) => item.state === "completed").length;
  const current = journey.find((item) => item.state === "in_progress" || item.state === "next");
  const stateStyles: Record<JourneyState, string> = {
    completed: "border-success bg-success text-white",
    in_progress: "border-clinical-blue bg-clinical-blue text-white ring-4 ring-clinical-blue-light/60",
    next: "border-clinical-blue bg-surface text-clinical-blue ring-4 ring-clinical-blue-light/60",
    upcoming: "border-border bg-surface-subtle text-text-muted",
  };

  const handleContinue = async () => {
    if (!current || isStarting) return;
    if (current.sessionId) {
      router.push(`/projects/demo/patient/sessions/${current.sessionId}`);
      return;
    }
    setIsStarting(true);
    try {
      const session = await createCanonicalTestRuntimeSession({
        sessionDefinitionId: `tbct-s${String(current.number).padStart(2, "0")}`,
        locale: participant?.locale,
        participantId: participant?.id,
        patientAlias: participant?.alias,
      });
      router.push(`/projects/demo/patient/sessions/${session.id}`);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Card className="overflow-hidden p-6 sm:p-7" >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary">{t("patientJourney.heading")}</h2>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-clinical-blue" aria-label={t("patientJourney.progress", { completed })}>
          <Check className="h-4 w-4" aria-hidden="true" />
          <span>{completed} / 8</span>
        </div>
      </div>
      <div className="mt-7 grid grid-cols-4 gap-y-7 md:grid-cols-8">
        {journey.map((item, index) => (
          <div key={item.number} className="relative flex flex-col items-center text-center">
            {index > 0 && <div className={`absolute right-1/2 top-5 z-0 hidden h-0.5 w-full md:block ${item.state === "completed" ? "bg-success" : "bg-border"}`} />}
            <div className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold ${stateStyles[item.state]}`}>
              {item.state === "completed" ? <Check className="h-5 w-5" /> : item.state === "in_progress" ? <CircleDot className="h-5 w-5" /> : item.number}
            </div>
            <span className={`mt-2 text-xs ${item.state === "upcoming" ? "font-medium text-text-muted" : "font-semibold text-text-primary"}`}>{locale === "ko" ? `${item.number}회기` : `Session ${item.number}`}</span>
            <span className="sr-only">{t(`patientJourney.${item.state}`)}</span>
          </div>
        ))}
      </div>
      {current && (
        <div data-tour-id="journey-continue" className="mt-8 rounded-2xl border border-clinical-blue-light bg-gradient-to-r from-clinical-blue-light/55 via-surface to-ai-violet-light/25 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clinical-blue text-white"><Play className="h-4 w-4" /></div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base font-bold text-text-primary">
              <span>{t("patientJourney.currentSession", { number: current.number })}</span>
              <span className="text-sm font-semibold text-text-secondary">({SESSION_TITLES[locale][current.number]})</span>
            </div>
          </div>
          <Button className="mt-4 w-full disabled:opacity-100 sm:mt-0 sm:w-auto" onClick={() => void handleContinue()} disabled={isStarting || localPreview}>
            <Play className="h-4 w-4" />
            {isStarting ? t("patientJourney.starting") : t("patientJourney.continue")}
          </Button>
        </div>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Link href="/projects/demo/patient/history" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-clinical-blue hover:bg-clinical-blue-light/20">
          <History className="h-5 w-5 text-clinical-blue" aria-hidden="true" />
          <div className="text-sm font-bold text-text-primary">{t("patientJourney.records")}</div>
        </Link>
        <Link href="/projects/demo/patient/homework" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-clinical-blue hover:bg-clinical-blue-light/20">
          <ClipboardList className="h-5 w-5 text-clinical-blue" aria-hidden="true" />
          <div className="text-sm font-bold text-text-primary">{t("patientJourney.homework")}</div>
        </Link>
      </div>
    </Card>
  );
}

export function SessionGroup({ title, sessions }: { title: string; sessions: ListedSession[]; number?: number }) {
  const { t } = useT();
  const [showEarlierAttempts, setShowEarlierAttempts] = useState(false);
  const [latestSession, ...earlierAttempts] = sessions;
  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="border-b border-border bg-surface-subtle px-5 py-4">
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      </div>
      {sessions.length === 0 ? (
        <div className="px-5 py-5 text-sm text-text-muted">{t("patientPortal.group.empty")}</div>
      ) : (
        <div className="divide-y divide-border">
          <SessionRow session={latestSession} />
          {earlierAttempts.length > 0 && (
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-semibold text-clinical-blue transition hover:bg-clinical-blue-light/20"
                onClick={() => setShowEarlierAttempts((visible) => !visible)}
                aria-expanded={showEarlierAttempts}
              >
                <span>{t(showEarlierAttempts ? "patientPortal.group.hideEarlierAttempts" : "patientPortal.group.earlierAttempts", { count: earlierAttempts.length })}</span>
                <span aria-hidden="true">{showEarlierAttempts ? "−" : "+"}</span>
              </button>
              {showEarlierAttempts && <div className="divide-y divide-border border-t border-border bg-surface-subtle/50">{earlierAttempts.map((session) => <SessionRow key={session.id} session={session} />)}</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function SessionRow({ session }: { session: ListedSession }) {
  const { t, locale } = useT();
  const tone = session.status === "completed" ? "success" : session.status === "escalated" || session.status === "safety_paused" ? "critical" : session.status === "waiting_for_input" ? "warning" : "primary";
  const number = Number(session.sessionDefinitionId.match(/s(\d+)/i)?.[1] ?? 0);
  const topic = SESSION_TITLES[locale][number];
  return (
    <div className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <div>
            <div className="text-lg font-semibold text-text-primary">{topic ?? sessionTitle(session.sessionDefinitionId, locale)}</div>
            <div className="mt-1 text-sm text-text-secondary">{formatSessionDate(session.updatedAt, locale)}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={tone}>{sessionStatusLabel(session.status, locale)}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {/* Inspector (raw runtime state/logs/provider events) is a clinician-only
              diagnostic view -- see the clinician's Patient Monitoring screen. Patients
              can only manage/continue their own session and view its summary. */}
          <Link href={`/projects/demo/patient/sessions/${session.id}`}><Button variant="secondary">{t("patientPortal.row.open")}</Button></Link>
          <Link href={`/runtime/sessions/${session.id}/summary`}><Button variant="secondary">{t("patientPortal.row.summary")}</Button></Link>
          {/* Also shown while the session is still running (2026-09-13): the
              homework screen ensures its own record on open, and S01's sheet
              is the same 15-distortion list used during the session. Only a
              session that has not started yet has nothing to show. */}
          {session.status !== "preparing" && hasHomeworkActivity(session.sessionDefinitionId) && (
            <Link href={`/projects/demo/patient/homework/${session.id}`}>
              <Button variant={session.status === "completed" ? "violet" : "secondary"}>{HOMEWORK_LABEL_BY_SESSION[session.sessionDefinitionId]}</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function sessionTitle(sessionDefinitionId: string, locale: "ko" | "en") {
  const number = Number(sessionDefinitionId.match(/s(\d+)/i)?.[1] ?? 0);
  const title = SESSION_TITLES[locale][number];
  if (!title) return locale === "ko" ? "기타 회기" : "Other session";
  return `${locale === "ko" ? `${number}회기` : `Session ${number}`} · ${title}`;
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
    // A patient may have older attempts that ended before completion.  The
    // Home "Continue" action must target the most recent unfinished attempt,
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

function formatSessionDate(value: string, locale: "ko" | "en") {
  return new Date(value).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
}

function sessionStatusLabel(status: ListedSession["status"], locale: "ko" | "en") {
  const labels = locale === "ko"
    ? { completed: "완료됨", waiting_for_input: "답변을 기다리고 있어요", active: "진행 중", processing: "준비 중", preparing: "준비 중", created: "시작 전", paused: "잠시 멈춤", terminated: "종료됨", safety_paused: "안전 확인 중", escalated: "검토 중", failed: "다시 시작 필요" }
    : { completed: "Completed", waiting_for_input: "Waiting for your answer", active: "In progress", processing: "Preparing", preparing: "Preparing", created: "Not started", paused: "Paused", terminated: "Ended", safety_paused: "Safety check", escalated: "Under review", failed: "Needs restart" };
  return labels[status] ?? (locale === "ko" ? "진행 상태 확인 중" : "Status checking");
}
