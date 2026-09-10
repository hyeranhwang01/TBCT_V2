"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { allocatePilotParticipant, getPilotParticipantRegistry } from "@/lib/api/pilot-study-api";

export function RuntimePilotAllocationPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pilot-allocation"], queryFn: getPilotParticipantRegistry });
  const mutation = useMutation({
    mutationFn: (participantId: string) => allocatePilotParticipant(participantId),
    onSuccess: async () => {
      toast.success("Allocation completed");
      await queryClient.invalidateQueries({ queryKey: ["pilot-allocation"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-participants"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-overview"] });
    },
  });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  const items = query.data?.filter((row) => row.participant.status === "enrolled" && !row.participant.studyArmId);
  return <AppShell><PageHeader title="Allocation" description="Blocked demo allocation preview and arm assignment across BR, FR, and KR sites." eyebrow="Stage 5" /><div className="space-y-3 p-4 lg:p-6">{items?.map((row) => <Card key={row.participant.id} className="p-4"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-text-primary">{row.participant.studyParticipantCode}</div><div className="mt-1 text-xs text-text-secondary">{row.site?.countryCode} · {row.site?.name}</div></div><Button onClick={() => mutation.mutate(row.participant.id)}>Allocate</Button></div></Card>)}</div></AppShell>;
}
