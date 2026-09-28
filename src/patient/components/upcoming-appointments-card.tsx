"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { listAppointmentsByParticipant } from "@/shared/api/appointment-api";
import { useRealtimeInvalidate } from "@/shared/supabase/use-realtime-invalidate";
import { useT } from "@/shared/i18n/context";
import { IconTile, StatusPill } from "@/patient/components/ui/kit";

function formatDay(iso: string, locale: "ko" | "en") {
  return new Date(iso).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });
}
function formatTime(iso: string, locale: "ko" | "en") {
  return new Date(iso).toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" });
}

/** Read-only view of the patient's own upcoming appointments -- v1 has no
 * patient self-scheduling (see sql/020_appointments.sql). */
export function UpcomingAppointmentsCard({ participantId }: { participantId: string }) {
  const { t, locale } = useT();
  const appointmentsQuery = useQuery({
    queryKey: ["appointments", participantId],
    queryFn: () => listAppointmentsByParticipant(participantId),
    enabled: Boolean(participantId),
  });
  useRealtimeInvalidate([{ table: "appointments", filter: `participant_id=eq.${participantId}` }], ["appointments", participantId]);

  const upcoming = (appointmentsQuery.data ?? []).filter((appointment) => appointment.status === "scheduled" && new Date(appointment.scheduledAt) > new Date());
  if (!appointmentsQuery.data || upcoming.length === 0) return null;

  return (
    <section className="rounded-card bg-surface p-5 shadow-[var(--pt-shadow-sm)]">
      <h2 className="text-[15px] font-bold text-text-primary">{t("appointments.upcomingTitle")}</h2>
      <ul className="mt-3 space-y-2">
        {upcoming.slice(0, 5).map((appointment) => (
          <li key={appointment.id} className="flex items-center gap-3 rounded-2xl bg-surface-subtle px-3 py-2.5">
            <IconTile icon={<CalendarDays />} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-primary">{formatDay(appointment.scheduledAt, locale)}</div>
              <div className="text-[13px] text-text-secondary">{formatTime(appointment.scheduledAt, locale)}</div>
            </div>
            <StatusPill tone="neutral">{appointment.durationMinutes}{t("appointments.minutesSuffix")}</StatusPill>
          </li>
        ))}
      </ul>
    </section>
  );
}
