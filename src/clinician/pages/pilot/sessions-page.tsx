"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { completeClinicianDeliveredSession, createNextSessionSchedule, getPilotSessionsOverview } from "@/lib/api/pilot-study-api";

export function RuntimePilotSessionsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pilot-sessions"], queryFn: getPilotSessionsOverview });
  const mutation = useMutation({
    mutationFn: async ({ type, participantId }: { type: "schedule" | "clinician-complete"; participantId: string }) => type === "schedule" ? createNextSessionSchedule(participantId) : completeClinicianDeliveredSession(participantId),
    onSuccess: async () => {
      toast.success("Session operations updated");
      await queryClient.invalidateQueries({ queryKey: ["pilot-sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-participants"] });
    },
  });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return <AppShell><PageHeader title="Session Operations" description="Scheduling, arm-aware delivery tracking, and clinician-delivered session completion." eyebrow="Stage 5" /><div className="space-y-3 p-4 lg:p-6">{query.data?.map((row) => <Card key={row.schedule.id} className="p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-semibold text-text-primary">{row.schedule.title}</div><div className="mt-1 text-xs text-text-secondary">{row.participant?.studyParticipantCode} · {row.schedule.status} · {row.schedule.sessionDefinitionId}</div></div><div className="flex gap-2">{row.participant && <Button variant="secondary" onClick={() => mutation.mutate({ type: "schedule", participantId: row.participant!.id })}>Schedule Next</Button>}{row.participant?.studyArmId === "ARM-CLIN" && row.schedule.status === "scheduled" && <Button onClick={() => mutation.mutate({ type: "clinician-complete", participantId: row.participant!.id })}>Clinician Complete</Button>}</div></div></Card>)}</div></AppShell>;
}
