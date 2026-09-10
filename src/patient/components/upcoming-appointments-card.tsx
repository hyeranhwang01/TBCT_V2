"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, Card } from "@/components/ui/primitives";
import { listAppointmentsByParticipant } from "@/lib/api/appointment-api";
import { useRealtimeInvalidate } from "@/lib/supabase/use-realtime-invalidate";
import { useT } from "@/lib/i18n/context";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/** Patient-facing read-only view of their own upcoming appointments --
 * v1 has no patient self-scheduling (see sql/020_appointments.sql's own
 * doc comment), so this is display-only. */
export function UpcomingAppointmentsCard({ participantId }: { participantId: string }) {
  const { t } = useT();
  const appointmentsQuery = useQuery({
    queryKey: ["appointments", participantId],
    queryFn: () => listAppointmentsByParticipant(participantId),
    enabled: Boolean(participantId),
  });
  useRealtimeInvalidate([{ table: "appointments", filter: `participant_id=eq.${participantId}` }], ["appointments", participantId]);

  const upcoming = (appointmentsQuery.data ?? []).filter((appointment) => appointment.status === "scheduled" && new Date(appointment.scheduledAt) > new Date());
  if (!appointmentsQuery.data || upcoming.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="text-sm font-semibold text-text-primary">{t("appointments.upcomingTitle")}</div>
      <div className="mt-2 space-y-2">
        {upcoming.slice(0, 5).map((appointment) => (
          <div key={appointment.id} className="flex items-center justify-between gap-3 rounded-panel border border-border px-3 py-2 text-sm">
            <span className="text-text-primary">{formatDateTime(appointment.scheduledAt)}</span>
            <Badge tone="primary">{appointment.durationMinutes}{t("appointments.minutesSuffix")}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
