"use client";

import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PatientShell } from "@/patient/components/patient-shell";
import { Card, EmptyState, PageSkeleton } from "@/shared/components/ui/primitives";
import { getRuntimeSession } from "@/lib/api/runtime-session-api";
import { ensureHomeworkForSession } from "@/lib/api/homework-api";
import { useRealtimeInvalidate } from "@/lib/supabase/use-realtime-invalidate";
import { HOMEWORK_LABEL_BY_SESSION, hasHomeworkActivity } from "@/types/homework";
import { useT } from "@/lib/i18n/context";
import { WeeklyExamplesHomework } from "@/patient/sessions/s01/homework";
import { CheckInHomework } from "@/patient/sessions/s02/homework";
import { ReviewIntraTrHomework } from "@/patient/sessions/s03/homework";
import { ActionPlanHomework } from "@/patient/sessions/s04/homework";
import { ReviewGridHomework } from "@/patient/sessions/s05/homework";
import { PracticeHomework } from "@/patient/sessions/s06/homework";
import { DecisionPlanHomework } from "@/patient/sessions/s07/homework";
import { AppealRecordHomework } from "@/patient/sessions/s08/homework";
import type { RuntimeSessionView } from "@/types/runtime-session";
import type { HomeworkRecord } from "@/types/homework";

// One shared entry route (/patient/homework/{sessionId}) that loads the
// session + ensures the homework record, then hands off to the
// session-specific component -- each of the eight owns its own layout,
// fields, and interaction rules; nothing here is shared beyond "which one
// to render" and the loading/not-found states.
export function HomeworkPage() {
  const { t } = useT();
  const params = useParams<{ sessionId: string }>();
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const sessionId = (Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId) ?? segments.at(-1) ?? "";

  const sessionQuery = useQuery({ queryKey: ["runtime-session-for-homework", sessionId], queryFn: () => getRuntimeSession(sessionId), enabled: Boolean(sessionId) });
  const session = sessionQuery.data?.session;
  const homeworkQuery = useQuery({
    queryKey: ["homework-record", sessionId],
    queryFn: () => (session ? ensureHomeworkForSession(session) : Promise.resolve(undefined)),
    enabled: Boolean(session),
  });
  // Was refetchInterval: 4000 -- the one polling site that was also a write
  // every tick (ensureHomeworkForSession does INSERT ... ON CONFLICT DO
  // NOTHING plus two SELECTs). ensure is idempotent, so running it once at
  // mount and again only when this session's homework_records row actually
  // changes is equivalent, minus the repeated write attempts every 4s.
  useRealtimeInvalidate([{ table: "homework_records", filter: `runtime_session_id=eq.${sessionId}` }], ["homework-record", sessionId], Boolean(session));

  if (sessionQuery.isLoading || homeworkQuery.isLoading) return <PatientShell title={t("homework.loading")}><PageSkeleton /></PatientShell>;
  if (!session || !hasHomeworkActivity(session.sessionDefinitionId) || !homeworkQuery.data) {
    return <PatientShell title={t("homework.loading")}><Card><EmptyState title={t("homework.notAvailable")} /></Card></PatientShell>;
  }

  return <HomeworkSessionView sessionView={sessionQuery.data!} homework={homeworkQuery.data} label={HOMEWORK_LABEL_BY_SESSION[session.sessionDefinitionId]} />;
}

function HomeworkSessionView({ sessionView, homework, label }: { sessionView: RuntimeSessionView; homework: HomeworkRecord; label: string }) {
  const { session } = sessionView;
  switch (session.sessionDefinitionId) {
    case "tbct-s01": return <WeeklyExamplesHomework session={session} homework={homework} label={label} />;
    case "tbct-s02": return <CheckInHomework session={session} homework={homework} label={label} />;
    case "tbct-s03": return <ReviewIntraTrHomework session={session} homework={homework} label={label} />;
    case "tbct-s04": return <ActionPlanHomework session={session} homework={homework} label={label} />;
    case "tbct-s05": return <ReviewGridHomework session={session} homework={homework} label={label} />;
    case "tbct-s06": return <PracticeHomework session={session} homework={homework} label={label} />;
    case "tbct-s07": return <DecisionPlanHomework session={session} homework={homework} label={label} />;
    case "tbct-s08": return <AppealRecordHomework session={session} homework={homework} label={label} />;
    default: return null;
  }
}
