"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, CheckCircle2, Clock3, Play, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { MoodCheckinWidget } from "@/patient/components/mood-checkin-widget";
import { UpcomingAppointmentsCard } from "@/patient/components/upcoming-appointments-card";
import { OnboardingTour } from "@/shared/components/onboarding/onboarding-tour";
import { Badge, Button, Card, EmptyState, PageSkeleton } from "@/shared/components/ui/primitives";
import { listRuntimeSessionsForParticipant } from "@/lib/api/runtime-session-api";
import { getOrCreateParticipantForUiLocale } from "@/lib/api/participant-api";
import { PATIENT_TOUR_STEPS } from "@/lib/onboarding/tour-steps";
import { useOnboardingTour } from "@/lib/onboarding/use-onboarding-tour";
import { HOMEWORK_LABEL_BY_SESSION, hasHomeworkActivity } from "@/types/homework";
import { UI_LOCALE_STORAGE_KEY, useT } from "@/lib/i18n/context";
import { mapToUiLocale } from "@/lib/i18n/locales";
import { useAuth } from "@/lib/auth/auth-context";

type ListedSession = Awaited<ReturnType<typeof listRuntimeSessionsForParticipant>>[number];

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
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "waiting" | "completed">("all");
  const visibleSessions = useMemo(() => sessions.filter((session) => {
    const matchesSearch = !search.trim() || `${session.patientAlias} ${session.id} ${session.sessionDefinitionId}`.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStatus = statusFilter === "all"
      || statusFilter === "completed" && session.status === "completed"
      || statusFilter === "waiting" && session.status === "waiting_for_input"
      || statusFilter === "active" && ["active", "processing", "preparing"].includes(session.status);
    return matchesSearch && matchesStatus;
  }), [sessions, search, statusFilter]);
  const stats = {
    total: sessions.length,
    active: sessions.filter((session) => ["active", "processing", "preparing"].includes(session.status)).length,
    waiting: sessions.filter((session) => session.status === "waiting_for_input").length,
    complete: sessions.filter((session) => session.status === "completed").length,
  };
  const sessionGroups = Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    const definitionId = `tbct-s${String(number).padStart(2, "0")}`;
    const items = visibleSessions
      .filter((session) => session.sessionDefinitionId === definitionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return { number, definitionId, items };
  });
  const otherSessions = visibleSessions
    .filter((session) => !/^tbct-s0[1-8]$/.test(session.sessionDefinitionId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

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
        sessionLabel={participant?.alias}
        progressLabel={participant?.locale}
        actions={
          <>
            <span data-tour-id="new-session"><Link href="/projects/demo/patient/sessions/new"><Button>{t("patientPortal.newSession")}</Button></Link></span>
          </>
        }
      >
        <div className="space-y-5">
          {/* Card doesn't forward arbitrary props (only children/className) --
              data-tour-id needs an actual DOM element, so it goes on this
              wrapping div rather than the Card itself. */}
          <div data-tour-id="patient-stats" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <PortalStat icon={<CalendarDays />} tone="blue" label={t("patientPortal.stats.total")} value={stats.total} helper="모든 세션의 합계" />
            <PortalStat icon={<Play />} tone="green" label={t("patientPortal.stats.active")} value={stats.active} helper="현재 진행 중인 세션" />
            <PortalStat icon={<Clock3 />} tone="orange" label={t("patientPortal.stats.waiting")} value={stats.waiting} helper="곧 시작할 세션" />
            <PortalStat icon={<CheckCircle2 />} tone="violet" label={t("patientPortal.stats.complete")} value={stats.complete} helper="완료된 세션" />
          </div>
          {participant && <div data-tour-id="mood-checkin"><MoodCheckinWidget participantId={participant.id} /></div>}
          <Card className="p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div><h2 className="text-xl font-bold">{t("patientShell.sessionList")}</h2><p className="mt-1 text-sm text-text-secondary">그룹별 세션과 진행 상태를 확인하세요.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex min-w-[260px] items-center gap-2 rounded-full border border-border bg-surface px-4"><Search className="h-4 w-4 text-text-muted" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="환자명 또는 ID 검색" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
                <div className="flex gap-1 rounded-full border border-border bg-surface p-1">
                  {(["all", "active", "waiting", "completed"] as const).map((status) => <button key={status} onClick={() => setStatusFilter(status)} className={`rounded-full px-4 py-2 text-xs font-semibold ${statusFilter === status ? "bg-clinical-blue text-white" : "text-text-secondary"}`}>{status === "all" ? "전체" : status === "active" ? "진행 중" : status === "waiting" ? "대기 중" : "완료"}</button>)}
                </div>
              </div>
            </div>
          </Card>
          {!sessions.length && <Card><EmptyState title={t("patientPortal.noSessions.title")} description={t("patientPortal.noSessions.description")} /></Card>}
          <div className="space-y-5">
            {sessionGroups.filter((group) => group.items.length > 0).map((group) => <SessionGroup key={group.definitionId} number={group.number} title={t("patientPortal.group.session", { number: group.number })} definitionId={group.definitionId} sessions={group.items} />)}
            {otherSessions.length > 0 && <SessionGroup title={t("patientPortal.group.other")} definitionId="Other" sessions={otherSessions} />}
          </div>
          {participant && <div data-tour-id="appointments"><UpcomingAppointmentsCard participantId={participant.id} /></div>}
        </div>
      </PatientShell>
      <OnboardingTour steps={PATIENT_TOUR_STEPS} active={tour.active} onDone={tour.finish} />
    </>
  );
}

function SessionGroup({ title, definitionId, sessions }: { title: string; definitionId: string; sessions: ListedSession[]; number?: number }) {
  const { t } = useT();
  const completed = sessions.filter((session) => session.status === "completed").length;
  const open = sessions.length - completed;
  return (
    <section className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-subtle px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          <div className="mt-1 text-xs text-text-muted">{definitionId}</div>
        </div>
        <div className="flex gap-2">
          <Badge tone="neutral">{t("patientPortal.group.total", { count: sessions.length })}</Badge>
          <Badge tone={open ? "warning" : "neutral"}>{t("patientPortal.group.open", { count: open })}</Badge>
          <Badge tone={completed ? "success" : "neutral"}>{t("patientPortal.group.complete", { count: completed })}</Badge>
        </div>
      </div>
      {sessions.length === 0 ? (
        <div className="px-5 py-5 text-sm text-text-muted">{t("patientPortal.group.empty")}</div>
      ) : (
        <div className="divide-y divide-border">
          {sessions.map((session) => <SessionRow key={session.id} session={session} />)}
        </div>
      )}
    </section>
  );
}

function SessionRow({ session }: { session: ListedSession }) {
  const { t } = useT();
  const tone = session.status === "completed" ? "success" : session.status === "escalated" || session.status === "safety_paused" ? "critical" : session.status === "waiting_for_input" ? "warning" : "primary";
  return (
    <div className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div>
            <div className="text-lg font-semibold text-text-primary">{session.patientAlias}</div>
            <div className="mt-1 text-sm text-text-secondary">{session.protocolId} · v{session.protocolVersion} · {session.sessionDefinitionId}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={tone}>{session.status}</Badge>
            <Badge tone="neutral">{session.locale}</Badge>
            <Badge tone="neutral">{t("patientPortal.row.updated")} {new Date(session.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} KST</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Inspector (raw runtime state/logs/provider events) is a clinician-only
              diagnostic view -- see the clinician's Patient Monitoring screen. Patients
              can only manage/continue their own session and view its summary. */}
          <Link href={`/projects/demo/patient/sessions/${session.id}`}><Button variant="secondary">{t("patientPortal.row.open")}</Button></Link>
          <Link href={`/runtime/sessions/${session.id}/summary`}><Button variant="secondary">{t("patientPortal.row.summary")}</Button></Link>
          {session.status === "completed" && hasHomeworkActivity(session.sessionDefinitionId) && (
            <Link href={`/projects/demo/patient/homework/${session.id}`}>
              <Button variant="violet">{HOMEWORK_LABEL_BY_SESSION[session.sessionDefinitionId]}</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function PortalStat({ icon, tone, label, value, helper }: { icon: ReactNode; tone: "blue" | "green" | "orange" | "violet"; label: string; value: number; helper: string }) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-600",
    green: "border-emerald-200 bg-emerald-50 text-emerald-600",
    orange: "border-orange-200 bg-orange-50 text-orange-500",
    violet: "border-violet-200 bg-violet-50 text-violet-600",
  };
  return (
    <Card className="flex min-h-[120px] items-center gap-4 p-5">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border [&>svg]:h-6 [&>svg]:w-6 ${tones[tone]}`}>{icon}</div>
      <div><div className="text-sm font-semibold text-text-secondary">{label}</div><div className="mt-1 text-2xl font-black text-text-primary">{value}</div><div className="mt-1 text-xs text-text-muted">{helper}</div></div>
    </Card>
  );
}
