"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, PageHeader, PageSkeleton } from "@/components/ui/primitives";
import { acceptDemoConsent, enrollPilotParticipant, getPilotParticipantRegistry } from "@/lib/api/pilot-study-api";

export function RuntimePilotEnrollmentPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pilot-enrollment"], queryFn: getPilotParticipantRegistry });
  const mutation = useMutation({
    mutationFn: async ({ type, participantId }: { type: "consent" | "enroll"; participantId: string }) => type === "consent" ? acceptDemoConsent(participantId) : enrollPilotParticipant(participantId),
    onSuccess: async () => {
      toast.success("Enrollment workflow updated");
      await queryClient.invalidateQueries({ queryKey: ["pilot-enrollment"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-participants"] });
    },
  });
  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  const items = query.data?.filter((row) => ["eligible", "consent_pending", "consented"].includes(row.participant.status));
  return <AppShell><PageHeader title="Enrollment" description="Consent and enrollment gating for the demo pilot workflow." eyebrow="Stage 5" /><div className="space-y-3 p-4 lg:p-6">{items?.map((row) => <Card key={row.participant.id} className="p-4"><div className="flex items-center justify-between gap-2"><div><div className="text-sm font-semibold text-text-primary">{row.participant.studyParticipantCode}</div><div className="mt-1 text-xs text-text-secondary">{row.participant.status}</div></div><div className="flex gap-2">{!row.participant.currentConsentRecordId && <Button variant="secondary" onClick={() => mutation.mutate({ type: "consent", participantId: row.participant.id })}>Consent</Button>}{row.participant.currentConsentRecordId && row.participant.status !== "enrolled" && <Button onClick={() => mutation.mutate({ type: "enroll", participantId: row.participant.id })}>Enroll</Button>}</div></div></Card>)}</div></AppShell>;
}
