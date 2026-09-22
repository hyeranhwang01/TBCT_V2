"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { Badge, Button, Card, EmptyState, PageSkeleton } from "@/shared/components/ui/primitives";
import { listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { HOMEWORK_LABEL_BY_SESSION, hasHomeworkActivity } from "@/types/homework";
import { useT } from "@/shared/i18n/context";
import { useAuth } from "@/shared/auth/auth-context";

// One place that lists every session's homework (2026-09-13). Until now the
// only way in was the session that produced it: the completion screen, or a
// button that appeared on the session list once that session was finished.
//
// In-progress sessions are listed too. The detail screen
// (homework-page.tsx) never required a finished session -- it ensures the
// record when it opens -- so this only exposes what already worked, which
// matters for S01: its homework sheet is the same list of 15 cognitive
// distortions the participant reads during the session.
//
// Scoped to the logged-in patient's own participant, exactly like
// patient-list-page.tsx; never the cross-patient list.
//
// 2026-09-22 (UI overhaul, W2): repeating the same session (e.g. running S01
// twice) creates a second RuntimeSession with the same sessionDefinitionId,
// so the same-titled card used to show up twice with nothing but the date to
// tell them apart. This groups by sessionDefinitionId, numbers each group's
// sessions in the order they were created (1st, 2nd, ...), and collapses
// everything but the newest round behind a toggle. Purely a display change --
// no new API call, no schema change, no session/homework record is deleted
// or hidden from the clinician side (homework-panel, CD-Quest trend still
// read the same underlying per-session records).
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
    // Keep the group's own sessions in the same newest-first order the caller
    // already sorted the flat list into (matches the current UX).
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
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

  if (participantQuery.isLoading || sessionsQuery.isLoading) {
    return <PatientShell title={t("homeworkList.title")}><PageSkeleton /></PatientShell>;
  }

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

  const renderSessionCard = (session: (typeof sessions)[number], round: number, totalRounds: number) => (
    <Card key={session.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-base font-semibold text-text-primary">{HOMEWORK_LABEL_BY_SESSION[session.sessionDefinitionId]}</div>
          {totalRounds > 1 && <Badge tone="neutral">{t("homeworkList.roundLabel", { n: round })}</Badge>}
        </div>
        <div className="text-sm text-text-secondary">
          {session.sessionDefinitionId} · {formatDate(session.updatedAt)}
        </div>
        <Badge tone={session.status === "completed" ? "success" : "neutral"}>
          {session.status === "completed" ? t("homeworkList.sessionDone") : t("homeworkList.sessionOngoing")}
        </Badge>
      </div>
      <Link href={`/projects/demo/patient/homework/${session.id}`}>
        <Button variant={session.status === "completed" ? "violet" : "secondary"}>{t("homeworkList.open")}</Button>
      </Link>
    </Card>
  );

  return (
    <PatientShell title={t("homeworkList.title")} progressLabel={t("homeworkList.eyebrow")}>
      <div className="space-y-4">
        <Card className="p-5">
          <p className="text-sm text-text-secondary">{t("homeworkList.description")}</p>
        </Card>

        {sessions.length === 0 ? (
          <Card><EmptyState title={t("homeworkList.empty")} description={t("homeworkList.emptyHint")} /></Card>
        ) : (
          <div className="space-y-3">
            {groups.map(({ sessionDefinitionId, rounds }) => {
              const totalRounds = rounds.length;
              const [latest, ...earlier] = rounds; // rounds is already newest-first
              const isExpanded = Boolean(expandedGroups[sessionDefinitionId]);
              return (
                <div key={sessionDefinitionId} className="space-y-2">
                  {renderSessionCard(latest, latest.round, totalRounds)}
                  {earlier.length > 0 && (
                    <div className="pl-1">
                      <button
                        type="button"
                        className="text-sm font-medium text-clinical-blue hover:underline"
                        onClick={() => setExpandedGroups((prev) => ({ ...prev, [sessionDefinitionId]: !prev[sessionDefinitionId] }))}
                      >
                        {isExpanded ? t("homeworkList.hidePreviousRounds") : t("homeworkList.showPreviousRounds", { count: earlier.length })}
                      </button>
                      {isExpanded && <div className="mt-2 space-y-2">{earlier.map((session) => renderSessionCard(session, session.round, totalRounds))}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PatientShell>
  );
}
