"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck } from "lucide-react";
import { PatientShell } from "@/patient/components/patient-shell";
import { SessionGroup, isOpenSession, type ListedSession } from "@/patient/components/session-record-card";
import { EmptyBlock, PtCard, PtLinkButton, PtSkeleton, SectionHeading } from "@/patient/components/ui/kit";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { listRuntimeSessionsForParticipant } from "@/shared/api/runtime-session-api";
import { useAuth } from "@/shared/auth/auth-context";
import { useT } from "@/shared/i18n/context";

// Screenshot-only records, used exclusively by ?preview=1 in local
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
  const sessions = useMemo(() => (localPreview ? LOCAL_PREVIEW_HISTORY_SESSIONS : sessionsQuery.data ?? []), [localPreview, sessionsQuery.data]);
  const groups = useMemo(() => Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    const definitionId = `tbct-s${String(number).padStart(2, "0")}`;
    return { number, definitionId, items: sessions.filter((session) => session.sessionDefinitionId === definitionId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) };
  }).filter((group) => group.items.length > 0), [sessions]);
  // A session number belongs to "in progress" while its newest attempt can
  // still be continued; everything else is past, in session order.
  const activeGroups = groups.filter((group) => isOpenSession(group.items[0].status));
  const pastGroups = groups.filter((group) => !isOpenSession(group.items[0].status));
  const otherSessions = sessions.filter((session) => !/^tbct-s0[1-8]$/.test(session.sessionDefinitionId)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (participantQuery.isLoading || sessionsQuery.isLoading) return <PatientShell title={t("patientUi.nav.sessions")}><PtSkeleton /></PatientShell>;

  return (
    <PatientShell
      title={t("patientUi.nav.sessions")}
    >
      {!sessions.length ? (
        <PtCard>
          <EmptyBlock
            icon={<BookOpenCheck />}
            title={t("patientPortal.noSessions.title")}
            description={t("patientPortal.noSessions.description")}
            action={<PtLinkButton href="/projects/demo/patient">{t("patientUi.complete.home")}</PtLinkButton>}
          />
        </PtCard>
      ) : (
        <div className="max-w-3xl space-y-10">
          {activeGroups.length > 0 && (
            <section>
              <SectionHeading title={t("patientUi.records.active")} />
              <div className="space-y-3">
                {activeGroups.map((group) => <SessionGroup key={group.definitionId} defaultOpen title={t("patientPortal.group.session", { number: group.number })} sessions={group.items as ListedSession[]} />)}
              </div>
            </section>
          )}
          {(pastGroups.length > 0 || otherSessions.length > 0) && (
            <section>
              <SectionHeading title={t("patientUi.records.past")} />
              {/* One row per session; a row opens to its actions. */}
              <div className="space-y-3">
                {pastGroups.map((group) => <SessionGroup key={group.definitionId} title={t("patientPortal.group.session", { number: group.number })} sessions={group.items as ListedSession[]} />)}
                {otherSessions.length > 0 && <SessionGroup title={t("patientPortal.group.other")} sessions={otherSessions as ListedSession[]} />}
              </div>
            </section>
          )}
        </div>
      )}
    </PatientShell>
  );
}
