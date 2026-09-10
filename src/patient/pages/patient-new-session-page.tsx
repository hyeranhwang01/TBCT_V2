"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Button, Card } from "@/components/ui/primitives";
import { createCanonicalTestRuntimeSession, listCanonicalTestSessions } from "@/lib/api/runtime-session-api";
import { getOrCreateParticipantForUiLocale } from "@/lib/api/participant-api";
import { useT } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/auth-context";

// The product now runs a single TCBT flow (no protocol/manual picker before a
// session can start). This page only lets the patient pick which of the
// program's fixed session numbers (S01-S08) to begin or resume next.
export function PatientNewSessionPage() {
  const { t, locale } = useT();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const sessionsQuery = useQuery({ queryKey: ["canonical-test-runtime-sessions"], queryFn: listCanonicalTestSessions });
  // createCanonicalTestRuntimeSession defaults locale to "ko-KR" when none
  // is passed -- every new session used to start Korean regardless of what
  // the patient's own profile locale was set to (see patient-list-page.tsx,
  // which shows that same participant.locale next to the patient's name),
  // so changing it there had no visible effect on anything actually started
  // afterward. New sessions now inherit the participant's current locale.
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });
  const sessions = sessionsQuery.data ?? [];
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null);

  const handleStartSession = async (sessionDefinitionId: string) => {
    setStartingSessionId(sessionDefinitionId);
    try {
      // Used to also await startRuntimeSession(session.id) here -- the
      // first AI turn's full generation, sometimes chained through
      // several auto-delivered nodes before the first one that actually
      // needs a patient answer -- before ever navigating away. That left
      // this button spinning with no real feedback for however long that
      // took. Navigating as soon as the session row itself exists (fast,
      // no LLM involved) and letting patient-session-page.tsx trigger the
      // actual start once it lands there instead means the patient sees
      // the session's own "처리 중" (processing) state immediately, rather
      // than a spinner glued to a button that hasn't gone anywhere yet.
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId, locale: participantQuery.data?.locale, participantId: participantQuery.data?.id, patientAlias: participantQuery.data?.alias });
      router.push(`/projects/demo/patient/sessions/${session.id}`);
    } catch (error) {
      console.error("Session start failed:", error);
      toast.error(error instanceof Error ? error.message : t("patientNewSession.startFailed"));
    } finally {
      setStartingSessionId(null);
    }
  };

  return (
    <PatientShell title={t("patientNewSession.title")}>
      <div className="space-y-4">
        <div className="border-b border-border pb-4">
          <h2 className="text-lg font-semibold text-text-primary">{t("patientNewSession.heading")}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t("patientNewSession.subheading")}</p>
        </div>
        {sessionsQuery.isLoading || participantQuery.isLoading ? (
          <Card className="p-4 text-sm text-text-secondary">{t("patientNewSession.loading")}</Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sessions.map((session) => (
              <Card key={session.id} className="flex h-full flex-col gap-4 p-4 transition hover:border-clinical-blue hover:shadow-lg">
                <div>
                  <div className="font-semibold text-text-primary">{locale === "ko" ? (session.titleKo ?? session.title) : session.title}</div>
                  <div className="mt-1 text-xs text-text-secondary">{t("patientNewSession.sessionLabel", { number: session.number, technique: session.techniqueName })}</div>
                </div>
                <Button className="mt-auto" onClick={() => void handleStartSession(session.id)} disabled={startingSessionId !== null}>
                  {startingSessionId === session.id ? t("patientNewSession.starting") : t("patientNewSession.start")}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PatientShell>
  );
}
