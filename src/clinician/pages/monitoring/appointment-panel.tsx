"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, CalendarClock, CalendarPlus, Clock3, Plus } from "lucide-react";
import { Badge, Button, Card, Field, IllustratedEmptyState, SectionHeader, inputClass } from "@/components/ui/primitives";
import { createAppointment, listAppointmentsByParticipant, updateAppointmentStatus } from "@/lib/api/appointment-api";
import { useRealtimeInvalidate } from "@/lib/supabase/use-realtime-invalidate";
import { useT } from "@/lib/i18n/context";
import type { AppointmentStatus } from "@/types/appointment";

const STATUS_TONE: Record<AppointmentStatus, "primary" | "success" | "neutral" | "critical"> = {
  scheduled: "primary",
  completed: "success",
  cancelled: "neutral",
  no_show: "critical",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/** Clinician-facing appointment scheduling for one participant --
 * v1 scope is deliberately a flat, date-sorted list (not a calendar
 * grid), clinician-created only (no patient self-scheduling). See
 * sql/020_appointments.sql's own doc comment. */
export function AppointmentPanel({ participantId }: { participantId: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(50);
  const [notes, setNotes] = useState("");

  const appointmentsQuery = useQuery({
    queryKey: ["appointments", participantId],
    queryFn: () => listAppointmentsByParticipant(participantId),
    enabled: Boolean(participantId),
  });
  useRealtimeInvalidate([{ table: "appointments", filter: `participant_id=eq.${participantId}` }], ["appointments", participantId]);

  const createMutation = useMutation({
    mutationFn: () => createAppointment(participantId, new Date(scheduledAt).toISOString(), durationMinutes, notes.trim() || undefined),
    onSuccess: async () => {
      toast.success(t("appointments.created"));
      setFormOpen(false);
      setScheduledAt("");
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["appointments", participantId] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("appointments.createFailed"));
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "completed" | "cancelled" | "no_show" }) => updateAppointmentStatus(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["appointments", participantId] });
    },
  });

  const appointments = appointmentsQuery.data ?? [];

  // Soonest still-scheduled appointment that hasn't passed yet -- drives the
  // "다음 예약" info tile below (falls back to a plain "none upcoming" string).
  // Depends on appointmentsQuery.data (not the `appointments` local, which is
  // a fresh `?? []` array every render) so this doesn't recompute on every
  // unrelated re-render.
  const nextAppointment = useMemo(() => {
    const now = Date.now();
    return [...(appointmentsQuery.data ?? [])]
      .filter((appointment) => appointment.status === "scheduled" && new Date(appointment.scheduledAt).getTime() >= now)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  }, [appointmentsQuery.data]);

  return (
    <Card>
      <SectionHeader
        title={t("appointments.title")}
        action={appointments.length > 0 ? <Button size="sm" onClick={() => setFormOpen((value) => !value)}>{t("appointments.schedule")}</Button> : undefined}
      />
      <div className="p-4">
        {formOpen && (
          <div className="mb-4 grid gap-3 rounded-panel border border-border bg-surface-subtle p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("appointments.dateTime")}>
                <input type="datetime-local" className={inputClass} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
              </Field>
              <Field label={t("appointments.duration")}>
                <input type="number" min={15} step={5} className={inputClass} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} />
              </Field>
            </div>
            <Field label={t("appointments.notes")}>
              <input className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setFormOpen(false)}>{t("common.cancel")}</Button>
              <Button loading={createMutation.isPending} disabled={!scheduledAt} onClick={() => createMutation.mutate()}>{t("appointments.confirm")}</Button>
            </div>
          </div>
        )}

        {appointments.length === 0 ? (
          <IllustratedEmptyState
            icon={<CalendarClock className="h-8 w-8" />}
            title={t("appointments.empty")}
            description={t("appointments.emptyDescription")}
            action={
              !formOpen && (
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t("appointments.schedule")}
                </Button>
              )
            }
          />
        ) : (
          <div className="space-y-2">
            {appointments.map((appointment) => (
              <div key={appointment.id} className="flex items-center justify-between gap-3 rounded-panel border border-border px-3 py-2 text-sm">
                <div>
                  <div className="text-text-primary">{formatDateTime(appointment.scheduledAt)} · {appointment.durationMinutes}{t("appointments.minutesSuffix")}</div>
                  {appointment.notes && <div className="text-xs text-text-secondary">{appointment.notes}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={STATUS_TONE[appointment.status]}>{t(`appointments.status.${appointment.status}`)}</Badge>
                  {appointment.status === "scheduled" && (
                    <>
                      <Button variant="secondary" size="sm" loading={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: appointment.id, status: "completed" })}>
                        {t("appointments.markCompleted")}
                      </Button>
                      <Button variant="secondary" size="sm" loading={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: appointment.id, status: "cancelled" })}>
                        {t("appointments.cancelAppointment")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <InfoTile icon={<CalendarPlus className="h-4 w-4" />} label={t("appointments.nextAppointment")} value={nextAppointment ? formatDateTime(nextAppointment.scheduledAt) : t("appointments.noneUpcoming")} />
          <InfoTile icon={<Bell className="h-4 w-4" />} label={t("appointments.reminders")} value={t("appointments.reminderInfo")} />
          <InfoTile icon={<Clock3 className="h-4 w-4" />} label={t("appointments.timezone")} value={t("appointments.timezoneInfo")} />
        </div>
      </div>
    </Card>
  );
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-panel border border-border bg-surface-subtle/60 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-clinical-blue">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-text-primary">{label}</div>
        <div className="mt-0.5 break-words text-xs text-text-secondary">{value}</div>
      </div>
    </div>
  );
}
