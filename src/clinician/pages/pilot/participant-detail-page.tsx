"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, Field, Modal, PageHeader, PageSkeleton, StatusBadge, inputClass, textareaClass } from "@/components/ui/primitives";
import {
  acceptDemoConsent,
  allocatePilotParticipant,
  completeScreening,
  decideEligibility,
  enrollPilotParticipant,
  getPilotParticipantDetail,
  overrideEligibilityDecision,
  overrideParticipantProtocolAssignment,
  overrideStudyArmAllocation,
} from "@/lib/api/pilot-study-api";

type DialogState =
  | { type: "eligibility_override" }
  | { type: "allocation_override" }
  | { type: "protocol_override" }
  | null;

export function RuntimePilotParticipantDetailPage() {
  const params = useParams<{ studyParticipantId: string }>();
  const pathname = usePathname();
  const studyParticipantIdFromParams = Array.isArray(params.studyParticipantId) ? params.studyParticipantId[0] : params.studyParticipantId;
  const studyParticipantIdFromPath = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const studyParticipantId = studyParticipantIdFromParams ?? studyParticipantIdFromPath;
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [reason, setReason] = useState("Supervisor review");
  const [eligibilityDecision, setEligibilityDecision] = useState<"eligible" | "not_eligible" | "pending_review">("pending_review");
  const [targetArmId, setTargetArmId] = useState("ARM-AIO");
  const [targetProtocolReleaseId, setTargetProtocolReleaseId] = useState("REL-DEMO-001");

  const query = useQuery({
    queryKey: ["pilot-participant-detail", studyParticipantId],
    queryFn: () => getPilotParticipantDetail(studyParticipantId),
    enabled: Boolean(studyParticipantId),
  });

  const mutate = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      toast.success("Participant operation updated");
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: ["pilot-participant-detail", studyParticipantId] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-participants"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot-exports"] });
    },
  });

  const activeAssignment = useMemo(
    () => query.data?.assignments.findLast((item) => item.active !== false) ?? null,
    [query.data?.assignments],
  );

  if (query.isLoading) {
    return <AppShell><PageSkeleton /></AppShell>;
  }

  const data = query.data;
  if (!data) {
    return <AppShell><div className="p-6">Pilot participant not found.</div></AppShell>;
  }

  return (
    <AppShell>
      <PageHeader
        title={`${data.participant.studyParticipantCode} · ${data.participant.alias}`}
        description="Screening, consent, enrollment, allocation, override history, and export readiness for the selected study participant."
        eyebrow="Stage 5"
        meta={
          <>
            <StatusBadge status={data.participant.status} />
            <Badge tone={data.availability.allowed ? "success" : "warning"}>{data.availability.allowed ? "Session allowed" : "Session blocked"}</Badge>
          </>
        }
        actions={
          <>
            {data.participant.runtimeParticipantId !== "redacted-runtime-participant" && (
              <Link href={`/runtime/participants/${data.participant.runtimeParticipantId}`}>
                <Button variant="secondary">Runtime Participant</Button>
              </Link>
            )}
            <Link href="/runtime/pilot/participants"><Button variant="secondary">Registry</Button></Link>
          </>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        <Card className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-text-primary">Participant operations</div>
              <div className="mt-1 text-xs text-text-secondary">Operate in this sequence: Screening → Eligibility → Consent → Enrollment → Allocation → Overrides.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!data.participant.screeningRecordId && <Button variant="secondary" onClick={() => mutate.mutate(() => completeScreening(data.participant.id))}>Complete Screening</Button>}
              {!!data.participant.screeningRecordId && !data.participant.eligibilityDecisionId && <Button variant="secondary" onClick={() => mutate.mutate(() => decideEligibility(data.participant.id))}>Decide Eligibility</Button>}
              {!data.participant.currentConsentRecordId && <Button variant="secondary" onClick={() => mutate.mutate(() => acceptDemoConsent(data.participant.id))}>Record Consent</Button>}
              {data.participant.status === "consented" && <Button variant="secondary" onClick={() => mutate.mutate(() => enrollPilotParticipant(data.participant.id))}>Enroll</Button>}
              {data.participant.status === "enrolled" && <Button variant="secondary" onClick={() => mutate.mutate(() => allocatePilotParticipant(data.participant.id))}>Allocate</Button>}
              {data.eligibility.length > 0 && <Button variant="secondary" onClick={() => setDialog({ type: "eligibility_override" })}>Eligibility Override</Button>}
              {data.allocations.length > 0 && <Button variant="secondary" onClick={() => setDialog({ type: "allocation_override" })}>Allocation Override</Button>}
              {activeAssignment && <Button onClick={() => setDialog({ type: "protocol_override" })}>Protocol Override</Button>}
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4"><div className="text-sm font-semibold text-text-primary">Status</div><div className="mt-2 text-xs text-text-secondary">{data.participant.status} · {data.arm?.name ?? "No arm assigned"} · {data.site?.name}</div></Card>
          <Card className="p-4"><div className="text-sm font-semibold text-text-primary">Consent</div><div className="mt-2 text-xs text-text-secondary">{data.consent.at(-1)?.status ?? "No consent"} · Withdrawals {data.withdrawals.length}</div></Card>
          <Card className="p-4"><div className="text-sm font-semibold text-text-primary">Enrollment & allocation</div><div className="mt-2 space-y-1 text-xs text-text-secondary"><div>Enrollment {data.participant.enrollmentId ?? "pending"}</div><div>Allocation {data.participant.allocationId ?? "pending"}</div><div>Assignments {data.assignments.length}</div></div></Card>
          <Card className="p-4"><div className="text-sm font-semibold text-text-primary">Availability gate</div><div className="mt-2 text-xs text-text-secondary">{data.availability.allowed ? "Allowed" : "Blocked"} · Runtime mode {data.availability.runtimeMode ?? "n/a"}</div><div className="mt-2 space-y-1 text-[11px] text-text-secondary">{data.availability.blockers.map((item) => <div key={item.code}>Blocker: {item.message}</div>)}{data.availability.warnings.map((item) => <div key={item.code}>Warning: {item.message}</div>)}</div></Card>
          <Card className="p-4"><div className="text-sm font-semibold text-text-primary">Overrides</div><div className="mt-2 space-y-1 text-xs text-text-secondary"><div>Eligibility {data.eligibilityOverrides.length}</div><div>Allocation {data.allocationOverrides.length}</div><div>Protocol {data.assignmentOverrides.length}</div></div></Card>
          <Card className="p-4"><div className="text-sm font-semibold text-text-primary">Assessments</div><div className="mt-2 space-y-1 text-xs text-text-secondary"><div>Definitions {data.outcomeDefinitions.length}</div><div>Schedules {data.outcomeSchedules.length}</div><div>Instances {data.outcomes.length}</div></div></Card>
          <Card className="p-4"><div className="text-sm font-semibold text-text-primary">Safety</div><div className="mt-2 text-xs text-text-secondary">Safety events {data.safetyEvents.length}</div></Card>
          <Card className="p-4"><div className="text-sm font-semibold text-text-primary">Clinician review</div><div className="mt-2 space-y-1 text-xs text-text-secondary"><div>Clinician sessions {data.clinicianSessions.length}</div><div>Review records {data.clinicianReviews.length}</div></div></Card>
        </div>
      </div>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog?.type === "eligibility_override"
            ? "Eligibility Override"
            : dialog?.type === "allocation_override"
              ? "Allocation Override"
              : "Protocol Assignment Override"
        }
        description="This local prototype records the override with audit history. It does not claim external site execution."
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {dialog?.type === "eligibility_override" && (
            <>
              <Field label="New decision">
                <select className={inputClass} value={eligibilityDecision} onChange={(event) => setEligibilityDecision(event.target.value as typeof eligibilityDecision)}>
                  <option value="eligible">eligible</option>
                  <option value="pending_review">pending_review</option>
                  <option value="not_eligible">not_eligible</option>
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Reason">
                  <textarea className={textareaClass} value={reason} onChange={(event) => setReason(event.target.value)} />
                </Field>
              </div>
            </>
          )}

          {dialog?.type === "allocation_override" && (
            <>
              <Field label="Target arm">
                <select className={inputClass} value={targetArmId} onChange={(event) => setTargetArmId(event.target.value)}>
                  <option value="ARM-CLIN">ARM-CLIN</option>
                  <option value="ARM-AIC">ARM-AIC</option>
                  <option value="ARM-AIO">ARM-AIO</option>
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Reason">
                  <textarea className={textareaClass} value={reason} onChange={(event) => setReason(event.target.value)} />
                </Field>
              </div>
            </>
          )}

          {dialog?.type === "protocol_override" && (
            <>
              <Field label="Protocol release">
                <input className={inputClass} value={targetProtocolReleaseId} onChange={(event) => setTargetProtocolReleaseId(event.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Reason">
                  <textarea className={textareaClass} value={reason} onChange={(event) => setReason(event.target.value)} />
                </Field>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
          <Button
            loading={mutate.isPending}
            onClick={() => {
              if (!dialog) return;
              if (dialog.type === "eligibility_override") {
                const targetDecision = data.eligibility.at(-1);
                if (!targetDecision) return;
                mutate.mutate(() => overrideEligibilityDecision({
                  studyParticipantId: data.participant.id,
                  decisionId: targetDecision.id,
                  newDecision: eligibilityDecision,
                  reason,
                }));
                return;
              }
              if (dialog.type === "allocation_override") {
                const targetAllocation = data.allocations.at(-1);
                if (!targetAllocation) return;
                mutate.mutate(() => overrideStudyArmAllocation({
                  studyParticipantId: data.participant.id,
                  previousAllocationId: targetAllocation.id,
                  newStudyArmId: targetArmId,
                  reason,
                }));
                return;
              }
              if (!activeAssignment) return;
              mutate.mutate(() => overrideParticipantProtocolAssignment({
                studyParticipantId: data.participant.id,
                previousAssignmentId: activeAssignment.id,
                newProtocolReleaseId: targetProtocolReleaseId,
                reason,
              }));
            }}
          >
            Apply Override
          </Button>
        </div>
      </Modal>
    </AppShell>
  );
}
