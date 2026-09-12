"use client";

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

  if (participantQuery.isLoading || sessionsQuery.isLoading) {
    return <PatientShell title={t("homeworkList.title")}><PageSkeleton /></PatientShell>;
  }

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
            {sessions.map((session) => (
              <Card key={session.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1.5">
                  <div className="text-base font-semibold text-text-primary">{HOMEWORK_LABEL_BY_SESSION[session.sessionDefinitionId]}</div>
                  <div className="text-sm text-text-secondary">
                    {session.sessionDefinitionId} · {new Date(session.updatedAt).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })}
                  </div>
                  <Badge tone={session.status === "completed" ? "success" : "neutral"}>
                    {session.status === "completed" ? t("homeworkList.sessionDone") : t("homeworkList.sessionOngoing")}
                  </Badge>
                </div>
                <Link href={`/projects/demo/patient/homework/${session.id}`}>
                  <Button variant={session.status === "completed" ? "violet" : "secondary"}>{t("homeworkList.open")}</Button>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PatientShell>
  );
}
