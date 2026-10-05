"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientShell } from "@/patient/components/patient-shell";
import { PtButton, PtSkeleton, SessionNumber } from "@/patient/components/ui/kit";
import { createCanonicalTestRuntimeSession, listCanonicalTestSessions } from "@/shared/api/runtime-session-api";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { sessionLocaleForStart } from "@/patient/lib/api/patient-locale-sync";
import { useT } from "@/shared/i18n/context";
import { useAuth } from "@/shared/auth/auth-context";
import { sessionMetaFor, sessionUnit } from "@/patient/lib/session-meta";

// The product runs a single TBCT flow; this page only lets the patient pick
// which of the program's fixed session numbers (S01-S08) to begin.
export function PatientNewSessionPage() {
  const { t, locale } = useT();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const sessionsQuery = useQuery({ queryKey: ["canonical-test-runtime-sessions"], queryFn: listCanonicalTestSessions });
  const participantQuery = useQuery({ queryKey: ["runtime-participant", userId], queryFn: () => getOrCreateParticipantForUiLocale(userId, locale), enabled: Boolean(userId) });
  const sessions = sessionsQuery.data ?? [];
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null);

  const handleStartSession = async (sessionDefinitionId: string) => {
    setStartingSessionId(sessionDefinitionId);
    try {
      // Navigate as soon as the session row exists (fast, no model call);
      // patient-session-page.tsx starts it on arrival.
      // In the language on screen (patient-locale-sync.ts).
      const sessionLocale = await sessionLocaleForStart(participantQuery.data, locale);
      const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId, locale: sessionLocale, participantId: participantQuery.data?.id, patientAlias: participantQuery.data?.alias });
      router.push(`/projects/demo/patient/sessions/${session.id}`);
    } catch (error) {
      console.error("Session start failed:", error);
      toast.error(error instanceof Error ? error.message : t("patientNewSession.startFailed"));
    } finally {
      setStartingSessionId(null);
    }
  };

  return (
    <PatientShell title={t("patientNewSession.heading")} description={t("patientNewSession.subheading")}>
      {sessionsQuery.isLoading || participantQuery.isLoading ? (
        <PtSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => {
            const meta = sessionMetaFor(session.number);
            return (
              <section key={session.id} className="flex h-full flex-col rounded-card bg-surface p-5 shadow-[var(--pt-shadow-sm)]">
                <div className="flex items-center gap-3">
                  <SessionNumber number={session.number} caption={sessionUnit(locale)} tone="soft" />
                  <div className="min-w-0">
                    <h2 className="truncate text-[16px] font-bold text-text-primary">{meta?.title[locale] ?? (locale === "ko" ? session.titleKo ?? session.title : session.title)}</h2>
                  </div>
                </div>
                {meta && <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">{meta.purpose[locale]}</p>}
                <PtButton className="mt-5" block onClick={() => void handleStartSession(session.id)} disabled={startingSessionId !== null} loading={startingSessionId === session.id}>
                  {startingSessionId === session.id ? t("patientNewSession.starting") : t("patientNewSession.start")}
                </PtButton>
              </section>
            );
          })}
        </div>
      )}
    </PatientShell>
  );
}
