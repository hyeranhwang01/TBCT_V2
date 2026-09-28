"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, NotebookTabs } from "lucide-react";
import { PatientShell } from "@/patient/components/patient-shell";
import { homeworkTitle, isOpenSession } from "@/patient/components/session-record-card";
import { EmptyBlock, PtCard, PtLinkButton, PtSkeleton, SectionHeading, SessionNumber } from "@/patient/components/ui/kit";
import { listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { hasHomeworkActivity } from "@/types/homework";
import { useT } from "@/shared/i18n/context";
import { useAuth } from "@/shared/auth/auth-context";
import { sessionMetaFor, sessionNumberOf, sessionUnit } from "@/patient/lib/session-meta";
import { cn } from "@/shared/utils";

// One place that lists every session's homework. In-progress sessions are
// listed too: the detail screen (homework-page.tsx) never required a finished
// session -- it ensures the record when it opens.
//
// Repeating a session creates a second RuntimeSession with the same
// sessionDefinitionId, so sessions are grouped by definition, numbered in
// creation order (1st, 2nd, ...), and everything but the newest round sits
// behind a toggle. Display only: no record is hidden from the clinician side.
type HomeworkListSession = {
  id: string;
  sessionDefinitionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export function groupSessionsByDefinition<T extends HomeworkListSession>(sessions: T[]): { sessionDefinitionId: string; rounds: (T & { round: number })[] }[] {
  const order: string[] = [];
  const bySessionDefinition = new Map<string, T[]>();
  for (const session of sessions) {
    const key = session.sessionDefinitionId;
    if (!bySessionDefinition.has(key)) {
      bySessionDefinition.set(key, []);
      order.push(key);
    }
    bySessionDefinition.get(key)!.push(session);
  }
  return order.map((sessionDefinitionId) => {
    const chronological = [...bySessionDefinition.get(sessionDefinitionId)!].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const roundBySessionId = new Map(chronological.map((session, index) => [session.id, index + 1]));
    // Keep the caller's newest-first order within the group.
    const rounds = bySessionDefinition
      .get(sessionDefinitionId)!
      .map((session) => ({ ...session, round: roundBySessionId.get(session.id)! }));
    return { sessionDefinitionId, rounds };
  });
}

export function HomeworkListPage() {
  const { t, locale } = useT();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });
  const participant = participantQuery.data;
  const sessionsQuery = useQuery({
    queryKey: ["runtime-sessions", participant?.id],
    queryFn: () => listRuntimeSessionsForParticipant(participant!.id),
    enabled: Boolean(participant),
  });

  const sessions = (sessionsQuery.data ?? [])
    .filter((session) => hasHomeworkActivity(session.sessionDefinitionId) && session.status !== "preparing")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const groups = groupSessionsByDefinition(sessions);
  // Homework of a session still in progress comes first; the rest follows in
  // session order (1, 2, 3, ...). Within a session, rounds stay newest-first.
  const bySessionNumber = (left: { sessionDefinitionId: string }, right: { sessionDefinitionId: string }) => sessionNumberOf(left.sessionDefinitionId) - sessionNumberOf(right.sessionDefinitionId);
  const activeGroups = groups.filter((group) => isOpenSession(group.rounds[0].status)).sort(bySessionNumber);
  const pastGroups = groups.filter((group) => !isOpenSession(group.rounds[0].status)).sort(bySessionNumber);

  if (participantQuery.isLoading || sessionsQuery.isLoading) {
    return <PatientShell title={t("patientUi.nav.homework")}><PtSkeleton /></PatientShell>;
  }

  return (
    <PatientShell
      title={t("patientUi.nav.homework")}
    >
      {sessions.length === 0 ? (
        <PtCard><EmptyBlock icon={<NotebookTabs />} title={t("homeworkList.empty")} description={t("homeworkList.emptyHint")} /></PtCard>
      ) : (
        <div className="max-w-3xl space-y-10">
          {activeGroups.length > 0 && (
            <section>
              <SectionHeading title={t("patientUi.records.active")} />
              <div className="space-y-3">{activeGroups.map((group) => <HomeworkGroup key={group.sessionDefinitionId} group={group} defaultOpen />)}</div>
            </section>
          )}
          {pastGroups.length > 0 && (
            <section>
              <SectionHeading title={t("patientUi.records.past")} />
              <div className="space-y-3">{pastGroups.map((group) => <HomeworkGroup key={group.sessionDefinitionId} group={group} />)}</div>
            </section>
          )}
        </div>
      )}
    </PatientShell>
  );
}

type HomeworkRound = HomeworkListSession & { round: number };

/** One session's homework, laid out like a row on the session history page:
 * number, homework title, and the newest round's session status and date.
 * Opening it shows the way into the homework and, folded one level further,
 * the earlier rounds. */
function HomeworkGroup({ group, defaultOpen = false }: { group: { sessionDefinitionId: string; rounds: HomeworkRound[] }; defaultOpen?: boolean }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [showEarlier, setShowEarlier] = useState(false);
  const { sessionDefinitionId, rounds } = group;
  const [latest, ...earlier] = rounds; // already newest-first
  const meta = sessionMetaFor(sessionDefinitionId);
  const done = latest.status === "completed";
  const formatDate = (value: string) => new Date(value).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
  const statusText = (status: string) => (status === "completed" ? t("homeworkList.sessionDone") : t("homeworkList.sessionOngoing"));
  return (
    <section className="overflow-hidden rounded-card bg-surface">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="transition-ui flex w-full items-center gap-4 px-5 py-5 text-left hover:bg-surface-hover sm:px-6">
        <SessionNumber number={sessionNumberOf(sessionDefinitionId)} caption={sessionUnit(locale)} size="sm" tone={done ? "soft" : "gold"} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold tracking-[-0.02em] text-text-primary">{homeworkTitle(t, sessionDefinitionId)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-text-muted">
            <span className={cn("inline-flex items-center gap-1.5 font-semibold", done ? "text-success" : "text-gold-strong")}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {statusText(latest.status)}
            </span>
            {meta && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{meta.title[locale]}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{formatDate(latest.updatedAt)}</span>
            {rounds.length > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("homeworkList.roundLabel", { n: latest.round })}</span>
              </>
            )}
          </span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-text-muted transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-4 px-5 pb-6 sm:pl-[84px] sm:pr-6">
          <PtLinkButton href={`/projects/demo/patient/homework/${latest.id}`} variant={done ? "primary" : "secondary"} size="sm">
            <NotebookTabs className="h-4 w-4" />
            {t("homeworkList.open")}
          </PtLinkButton>
          {earlier.length > 0 && (
            <div className="rounded-2xl bg-surface-subtle">
              <button type="button" onClick={() => setShowEarlier((value) => !value)} aria-expanded={showEarlier} className="transition-ui flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-[13px] font-semibold text-text-secondary hover:bg-surface-hover">
                {showEarlier ? t("homeworkList.hidePreviousRounds") : t("homeworkList.showPreviousRounds", { count: earlier.length })}
                <ChevronDown className={cn("h-4 w-4 transition-transform", showEarlier && "rotate-180")} aria-hidden="true" />
              </button>
              {showEarlier && (
                <div className="divide-y divide-border px-4 pb-1">
                  {earlier.map((session) => (
                    <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-text-muted">
                        <span className="font-semibold text-text-secondary">{t("homeworkList.roundLabel", { n: session.round })}</span>
                        <span className="font-semibold">{statusText(session.status)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDate(session.updatedAt)}</span>
                      </div>
                      <PtLinkButton href={`/projects/demo/patient/homework/${session.id}`} variant="ghost" size="sm">{t("homeworkList.open")}</PtLinkButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

