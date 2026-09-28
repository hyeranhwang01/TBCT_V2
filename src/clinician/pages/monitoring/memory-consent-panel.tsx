"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/shared/components/ui/primitives";
import { getParticipantConsentHistory } from "@/shared/api/participant-api";
import { memoryConsentStatus } from "@/shared/memory/memory-consent";
import { useT } from "@/shared/i18n/context";
import type { RuntimeParticipant } from "@/types/longitudinal-memory";

/** The participant's memory-consent answer and every change to it
 * (participant_consent_events, sql/025), for the clinician. Read-only: the
 * answer is the participant's to give. */
export function MemoryConsentPanel({ participant }: { participant: RuntimeParticipant }) {
  const { t, locale } = useT();
  const historyQuery = useQuery({ queryKey: ["memory-consent-history", participant.id], queryFn: () => getParticipantConsentHistory(participant.id) });
  const status = memoryConsentStatus(participant);
  const format = (value: string) => new Date(value).toLocaleString(locale === "ko" ? "ko-KR" : "en-US");
  const current = participant.memoryConsent;
  return (
    <div className="space-y-2 rounded-panel border border-border p-3 text-sm">
      <div className="font-semibold text-text-primary">{t("memoryConsent.clinician.title")}</div>
      <div className="flex flex-wrap items-center gap-2 text-text-secondary">
        <span>{t("memoryConsent.clinician.current")}</span>
        <Badge tone={status === "granted" ? "success" : status === "declined" ? "warning" : "neutral"}>
          {status === "undecided" ? t("memoryConsent.settings.undecided") : t(`memoryConsent.settings.${status}`, { date: current ? format(current.decidedAt) : "" })}
        </Badge>
      </div>
      <div className="text-xs font-semibold text-text-muted">{t("memoryConsent.clinician.history")}</div>
      {historyQuery.data?.length ? (
        <ul className="space-y-1 text-xs text-text-secondary">
          {[...historyQuery.data].reverse().map((event) => (
            <li key={event.id}>
              {format(event.decidedAt)} · {t(`memoryConsent.clinician.decision.${event.decision}`)} · {t(`memoryConsent.clinician.source.${event.source}`)} · {t(`memoryConsent.clinician.actor.${event.actorRole ?? "server"}`)} · {t("memoryConsent.clinician.wording", { version: event.textVersion })}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-text-muted">{t("memoryConsent.clinician.none")}</div>
      )}
    </div>
  );
}
