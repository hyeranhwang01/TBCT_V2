"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { completeScreening, getPilotParticipantRegistry } from "@/lib/api/pilot-study-api";

export function RuntimePilotScreeningPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pilot-screening"], queryFn: getPilotParticipantRegistry });
  const mutation = useMutation({
    mutationFn: (participantId: string) => completeScreening(participantId),
    onSuccess: async () => {
      toast.success("Screening completed");
      await queryClient.invalidateQueries({ queryKey: ["pilot-screening"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-participants"] });
    },
  });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  const items = query.data?.filter((row) => ["candidate", "screening"].includes(row.participant.status));
  return <AppShell><PageHeader title="Screening Queue" description="Candidate and screening-in-progress participants for demo operational eligibility review." eyebrow="Stage 5" /><div className="space-y-3 p-4 lg:p-6">{items?.map((row) => <Card key={row.participant.id} className="p-4"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-text-primary">{row.participant.studyParticipantCode}</div><div className="mt-1 text-xs text-text-secondary">{row.participant.status}</div></div><Button onClick={() => mutation.mutate(row.participant.id)}>Complete Screening</Button></div></Card>)}</div></AppShell>;
}
