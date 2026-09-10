"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { acceptDemoConsent, allocatePilotParticipant, createNextSessionSchedule, decideEligibility, enrollPilotParticipant, getPilotParticipantRegistry } from "@/lib/api/pilot-study-api";

export function RuntimePilotParticipantsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pilot-participants"], queryFn: getPilotParticipantRegistry });
  const run = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      toast.success("Pilot participant updated");
      await queryClient.invalidateQueries({ queryKey: ["pilot-participants"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-overview"] });
    },
  });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  return (
    <AppShell>
      <PageHeader title="Participant Registry" description="Screening, consent, enrollment, allocation, session progress, safety status, and data completeness." eyebrow="Stage 5" />
      <div className="space-y-3 p-4 lg:p-6">
        {query.data?.map((row) => (
          <Card key={row.participant.id} className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-text-primary">{row.participant.studyParticipantCode} · {row.participant.alias}</div>
                <div className="mt-1 text-xs text-text-secondary">{row.site?.countryCode} · {row.site?.name} · {row.arm?.shortLabel ?? "Unallocated"} · {row.participant.status}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/runtime/pilot/participants/${row.participant.id}`}><Button variant="secondary">Open Detail</Button></Link>
                {!row.participant.currentConsentRecordId && <Button variant="secondary" onClick={() => run.mutate(() => acceptDemoConsent(row.participant.id))}>Consent</Button>}
                {!row.participant.eligibilityDecisionId && <Button variant="secondary" onClick={() => run.mutate(() => decideEligibility(row.participant.id))}>Eligibility</Button>}
                {row.participant.status === "consented" && <Button variant="secondary" onClick={() => run.mutate(() => enrollPilotParticipant(row.participant.id))}>Enroll</Button>}
                {row.participant.status === "enrolled" && <Button variant="secondary" onClick={() => run.mutate(() => allocatePilotParticipant(row.participant.id))}>Allocate</Button>}
                {row.participant.studyArmId && <Button onClick={() => run.mutate(() => createNextSessionSchedule(row.participant.id))}>Schedule</Button>}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
