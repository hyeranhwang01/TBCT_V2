"use client";

import { useState } from "react";
import { ChevronDown, NotebookTabs, PlayCircle } from "lucide-react";
import { listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { HOMEWORK_LABEL_BY_SESSION, hasHomeworkActivity } from "@/types/homework";
import { useT } from "@/shared/i18n/context";
import { PtLinkButton, SessionNumber } from "@/patient/components/ui/kit";
import { sessionLabel, sessionMetaFor, sessionNumberOf, sessionUnit } from "@/patient/lib/session-meta";
import { cn } from "@/shared/utils";

export type ListedSession = Awaited<ReturnType<typeof listRuntimeSessionsForParticipant>>[number];

type Tone = "brand" | "gold" | "neutral" | "success" | "warning" | "critical";

export function sessionStatusTone(status: ListedSession["status"]): Tone {
  if (status === "completed") return "success";
  if (status === "escalated" || status === "safety_paused") return "critical";
  if (status === "waiting_for_input") return "gold";
  if (status === "terminated" || status === "failed") return "neutral";
  return "brand";
}

export function sessionStatusLabel(status: ListedSession["status"], locale: "ko" | "en") {
  const labels = locale === "ko"
    ? { completed: "완료됨", waiting_for_input: "답변을 기다리고 있어요", active: "진행 중", processing: "준비 중", preparing: "준비 중", created: "시작 전", paused: "잠시 멈춤", terminated: "종료됨", safety_paused: "안전 확인 중", escalated: "검토 중", failed: "다시 시작 필요" }
    : { completed: "Completed", waiting_for_input: "Waiting for your answer", active: "In progress", processing: "Preparing", preparing: "Preparing", created: "Not started", paused: "Paused", terminated: "Ended", safety_paused: "Safety check", escalated: "Under review", failed: "Needs restart" };
  return labels[status as keyof typeof labels] ?? (locale === "ko" ? "진행 상태 확인 중" : "Status checking");
}

export function formatSessionDate(value: string, locale: "ko" | "en") {
  return new Date(value).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
}

/** The localized homework title (homework.s0N.title), falling back to the
 * English label in types/homework.ts. */
export function homeworkTitle(t: (key: string) => string, sessionDefinitionId: string) {
  const key = `homework.s${String(sessionNumberOf(sessionDefinitionId)).padStart(2, "0")}.title`;
  const label = t(key);
  return label === key ? HOMEWORK_LABEL_BY_SESSION[sessionDefinitionId] ?? sessionDefinitionId : label;
}

export function sessionTitle(sessionDefinitionId: string, locale: "ko" | "en") {
  const meta = sessionMetaFor(sessionDefinitionId);
  if (!meta) return locale === "ko" ? "기타 회기" : "Other session";
  return `${sessionLabel(meta.number, locale)} · ${meta.title[locale]}`;
}

/** True while a session can still be continued. */
export function isOpenSession(status: string) {
  return !["completed", "terminated", "failed"].includes(status);
}

const toneText: Record<Tone, string> = {
  brand: "text-brand-ink",
  gold: "text-gold-strong",
  neutral: "text-text-muted",
  success: "text-success",
  warning: "text-warning",
  critical: "text-critical",
};

/** One session number's attempts, as one row: number, title, and the newest
 * attempt's status and date. Opening the row shows what can be done with it
 * (open, homework) and, folded one level further, the earlier attempts --
 * repeats or runs that were ended, never deleted, only tucked away. Attempts
 * are numbered in the order they were started (1차, 2차, ...) when there is
 * more than one. `bare` drops the card so rows can share one list. */
export function SessionGroup({ title, sessions, defaultOpen = false, bare = false }: { title: string; sessions: ListedSession[]; number?: number; defaultOpen?: boolean; bare?: boolean }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [showEarlierAttempts, setShowEarlierAttempts] = useState(false);
  const [latestSession, ...earlierAttempts] = sessions;
  const roundById = new Map([...sessions].sort((left, right) => (left.createdAt ?? left.updatedAt).localeCompare(right.createdAt ?? right.updatedAt)).map((session, index) => [session.id, index + 1]));
  const roundOf = (session: ListedSession) => (sessions.length > 1 ? roundById.get(session.id) : undefined);
  if (!latestSession) {
    return <div className="px-5 py-5 text-sm text-text-muted">{t("patientPortal.group.empty")}</div>;
  }
  const meta = sessionMetaFor(latestSession.sessionDefinitionId);
  const number = sessionNumberOf(latestSession.sessionDefinitionId);
  const round = roundOf(latestSession);
  return (
    <section className={cn(!bare && "overflow-hidden rounded-card bg-surface")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="transition-ui flex w-full items-center gap-4 px-5 py-5 text-left hover:bg-surface-hover sm:px-6"
      >
        {number > 0 && <SessionNumber number={number} caption={sessionUnit(locale)} size="sm" tone={latestSession.status === "completed" ? "soft" : "gold"} />}
        <span className="min-w-0 flex-1">
          {number === 0 && <span className="block text-[13px] font-semibold text-text-muted">{title}</span>}
          <span className="block truncate text-[16px] font-bold tracking-[-0.02em] text-text-primary">{meta ? meta.title[locale] : sessionTitle(latestSession.sessionDefinitionId, locale)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-text-muted">
            <span className={cn("inline-flex items-center gap-1.5 font-semibold", toneText[sessionStatusTone(latestSession.status)])}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {sessionStatusLabel(latestSession.status, locale)}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatSessionDate(latestSession.updatedAt, locale)}</span>
            {round !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("homeworkList.roundLabel", { n: round })}</span>
              </>
            )}
          </span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-text-muted transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-4 px-5 pb-6 sm:pl-[84px] sm:pr-6">
          <SessionActions session={latestSession} />
          {earlierAttempts.length > 0 && (
            <div className="rounded-2xl bg-surface-subtle">
              <button
                type="button"
                className="transition-ui flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-[13px] font-semibold text-text-secondary hover:bg-surface-hover"
                onClick={() => setShowEarlierAttempts((visible) => !visible)}
                aria-expanded={showEarlierAttempts}
              >
                <span>{t(showEarlierAttempts ? "patientPortal.group.hideEarlierAttempts" : "patientPortal.group.earlierAttempts", { count: earlierAttempts.length })}</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", showEarlierAttempts && "rotate-180")} aria-hidden="true" />
              </button>
              {showEarlierAttempts && (
                <div className="divide-y divide-border px-4 pb-1">
                  {earlierAttempts.map((session) => <SessionRow key={session.id} session={session} round={roundOf(session)} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** What a patient can do with one attempt: open the conversation, and its
 * homework once the session has started. (The clinician's session summary is
 * not offered here -- it is a clinician page.) */
function SessionActions({ session }: { session: ListedSession }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap gap-2">
      <PtLinkButton href={`/projects/demo/patient/sessions/${session.id}`} variant="secondary" size="sm"><PlayCircle className="h-4 w-4" />{t("patientPortal.row.open")}</PtLinkButton>
      {/* Also offered while the session is still running: the homework
          screen ensures its own record on open. Only a session that has not
          started yet has nothing to show. */}
      {session.status !== "preparing" && hasHomeworkActivity(session.sessionDefinitionId) && (
        <PtLinkButton href={`/projects/demo/patient/homework/${session.id}`} variant={session.status === "completed" ? "soft" : "secondary"} size="sm">
          <NotebookTabs className="h-4 w-4" />
          {homeworkTitle(t, session.sessionDefinitionId)}
        </PtLinkButton>
      )}
    </div>
  );
}

/** One earlier attempt inside an opened group: round, status and date, and
 * the way back into it. */
export function SessionRow({ session, round }: { session: ListedSession; round?: number }) {
  const { t, locale } = useT();
  const number = sessionNumberOf(session.sessionDefinitionId);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-text-muted">
        {round !== undefined && <span className="font-semibold text-text-secondary">{t("homeworkList.roundLabel", { n: round })}</span>}
        <span className={cn("font-semibold", toneText[sessionStatusTone(session.status)])}>{sessionStatusLabel(session.status, locale)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatSessionDate(session.updatedAt, locale)}</span>
        {number === 0 && <span>· {sessionTitle(session.sessionDefinitionId, locale)}</span>}
      </div>
      <PtLinkButton href={`/projects/demo/patient/sessions/${session.id}`} variant="ghost" size="sm"><PlayCircle className="h-4 w-4" />{t("patientPortal.row.open")}</PtLinkButton>
    </div>
  );
}
