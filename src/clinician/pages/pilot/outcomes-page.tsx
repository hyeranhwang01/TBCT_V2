"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { completeAssessment, getPilotParticipantRegistry } from "@/lib/api/pilot-study-api";

export function RuntimePilotOutcomesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pilot-outcomes"], queryFn: getPilotParticipantRegistry });
  const mutation = useMutation({
    mutationFn: (participantId: string) => completeAssessment(participantId),
    onSuccess: async () => {
      toast.success("Outcome assessment completed");
      await queryClient.invalidateQueries({ queryKey: ["pilot-outcomes"] });
    },
  });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return <AppShell><PageHeader title="Outcome Assessments" description="Demo acceptability, feasibility, and operational assessment tracking." eyebrow="Stage 5" /><div className="space-y-3 p-4 lg:p-6">{query.data?.map((row) => <Card key={row.participant.id} className="p-4"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-text-primary">{row.participant.studyParticipantCode}</div><div className="mt-1 text-xs text-text-secondary">{row.participant.assessmentInstanceIds.length} assessment records</div></div><Button onClick={() => mutation.mutate(row.participant.id)}>Complete Assessment</Button></div></Card>)}</div></AppShell>;
}
