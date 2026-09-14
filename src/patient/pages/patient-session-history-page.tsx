"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { EmptyState, Card, PageSkeleton } from "@/shared/components/ui/primitives";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { useAuth } from "@/shared/auth/auth-context";
import { useT } from "@/shared/i18n/context";
import { SessionGroup, type ListedSession } from "@/patient/pages/patient-list-page";

// Screenshot-only records. They are used exclusively by ?preview=1 in local
// development and never read from or written to a participant's database.
const LOCAL_PREVIEW_HISTORY_SESSIONS = [
  { id: "local-history-s01-latest", sessionDefinitionId: "tbct-s01", status: "completed", updatedAt: "2026-09-14T09:30:00.000Z" },
  { id: "local-history-s01-earlier-1", sessionDefinitionId: "tbct-s01", status: "terminated", updatedAt: "2026-09-13T15:10:00.000Z" },
  { id: "local-history-s01-earlier-2", sessionDefinitionId: "tbct-s01", status: "terminated", updatedAt: "2026-09-12T11:40:00.000Z" },
  { id: "local-history-s02", sessionDefinitionId: "tbct-s02", status: "completed", updatedAt: "2026-09-14T10:15:00.000Z" },
] as ListedSession[];

export function PatientSessionHistoryPage() {
  const { t, locale } = useT();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const localPreview = process.env.NODE_ENV === "development" && searchParams.get("preview") === "1";
  const participantQuery = useQuery({
    queryKey: ["runtime-participant", user?.id ?? ""],
    queryFn: () => getOrCreateParticipantForUiLocale(user!.id, locale),
    enabled: Boolean(user?.id),
  });
  const participant = participantQuery.data;
  const sessionsQuery = useQuery({
    queryKey: ["runtime-sessions", participant?.id],
    queryFn: () => listRuntimeSessionsForParticipant(participant!.id),
    enabled: Boolean(participant),
  });
  const sessions = localPreview ? LOCAL_PREVIEW_HISTORY_SESSIONS : sessionsQuery.data ?? [];
  const groups = useMemo(() => Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    const definitionId = `tbct-s${String(number).padStart(2, "0")}`;
    return { number, definitionId, items: sessions.filter((session) => session.sessionDefinitionId === definitionId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) };
  }), [sessions]);
  const otherSessions = sessions.filter((session) => !/^tbct-s0[1-8]$/.test(session.sessionDefinitionId)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (participantQuery.isLoading || sessionsQuery.isLoading) return <PatientShell title={t("patientShell.history")}><PageSkeleton /></PatientShell>;

  return (
    <PatientShell title={t("patientShell.history")}>
      <div className="space-y-5">
        {!sessions.length ? <Card><EmptyState title={t("patientPortal.noSessions.title")} description={t("patientPortal.noSessions.description")} /></Card> : (
          <div className="space-y-5">
            {groups.filter((group) => group.items.length > 0).map((group) => <SessionGroup key={group.definitionId} title={t("patientPortal.group.session", { number: group.number })} sessions={group.items as ListedSession[]} />)}
            {otherSessions.length > 0 && <SessionGroup title={t("patientPortal.group.other")} sessions={otherSessions as ListedSession[]} />}
          </div>
        )}
      </div>
    </PatientShell>
  );
}
