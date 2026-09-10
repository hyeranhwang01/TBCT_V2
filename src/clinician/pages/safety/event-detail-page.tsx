"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, PageSkeleton, inputClass, textareaClass } from "@/components/ui/primitives";
import { DEMO_ACTORS } from "@/lib/demo-actor";
import {
  acknowledgeClinicianHandoff,
  acknowledgeSafetyEvent,
  assignSafetyEvent,
  authorizeSessionResume,
  cancelClinicianHandoff,
  cancelHumanIntervention,
  closeSafetyEvent,
  completeHumanIntervention,
  completeSafetyFollowUp,
  createClinicianHandoff,
  createHumanIntervention,
  createSafetyFollowUp,
  createSafetyTriageRecord,
  failHumanIntervention,
  generateSafetyEventReport,
  getSafetyEventDetail,
  markSafetyEventFalsePositive,
  reopenSafetyEvent,
  reopenSafetyFollowUp,
  requestSessionResume,
  resolveSafetyEvent,
  resumeSafetyHeldSession,
  assignSafetyFollowUp,
  cancelSafetyFollowUp,
  startHumanIntervention,
  startSafetyFollowUp,
} from "@/lib/api/safety-operations-api";
import { fadeUp } from "@/lib/motion/motion-variants";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import { useStudioStore } from "@/stores/studio-store";

export function RuntimeSafetyEventDetailPage() {
  const params = useParams<{ eventId: string }>();
  const pathname = usePathname();
  const eventIdFromParams = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  const eventIdFromPath = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const eventId = eventIdFromParams ?? eventIdFromPath;
  const queryClient = useQueryClient();
  const router = useRouter();
  const reducedMotion = useReducedMotionPreference();
  const activeActorId = useStudioStore((state) => state.activeActorId);
  const [modal, setModal] = useState<null | "resolve" | "close" | "falsePositive" | "reopen" | "resumeRequest" | "resumeAuthorize" | "handoff" | "followUp">(null);
  const [note, setNote] = useState("");
  const [selectedClinicianId, setSelectedClinicianId] = useState("CLIN-A");
  const query = useQuery({ queryKey: ["safety-event-detail", eventId], queryFn: () => getSafetyEventDetail(eventId), enabled: Boolean(eventId) });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["safety-event-detail", eventId] });
    await queryClient.invalidateQueries({ queryKey: ["safety-events"] });
    await queryClient.invalidateQueries({ queryKey: ["safety-dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["safety-followups"] });
  };

  const call = <T,>(fn: () => Promise<T>, message: string) => async () => {
    await fn();
    toast.success(message);
    await invalidate();
  };

  const ack = useMutation({ mutationFn: call(() => acknowledgeSafetyEvent(eventId), "Event acknowledged") });
  const triage = useMutation({
    mutationFn: call(
      () =>
        createSafetyTriageRecord({
          safetyEventId: eventId,
          clinicianId: activeActorId,
          previousSeverity: query.data!.event.severity,
          selectedSeverity: query.data!.event.severity,
          previousUrgency: query.data!.event.urgency,
          selectedUrgency: query.data!.event.urgency,
          immediateActionRequired: query.data!.event.urgency === "immediate",
          sessionHoldRequired: true,
          participantContactRecommended: false,
          supervisorReviewRequired: query.data!.event.severity === "high",
          additionalReviewRecommended: true,
          recommendedActions: ["assign_clinician", "review_session"],
          rationale: "Demo triage completed",
        }),
      "Triage saved",
    ),
  });
  const assign = useMutation({ mutationFn: call(() => assignSafetyEvent(eventId, selectedClinicianId, "Assigned in demo queue"), "Assigned") });
  const createIntervention = useMutation({
    mutationFn: call(
      () =>
        createHumanIntervention({
          safetyEventId: eventId,
          participantId: query.data!.event.participantId,
          runtimeSessionId: query.data!.event.runtimeSessionId,
          clinicianId: selectedClinicianId,
          channel: "phone_placeholder",
          actionType: "review_session",
          internalNote: "Demo intervention created",
          patientFacingMessage: "A clinician is reviewing the session.",
        }),
      "Intervention created",
    ),
  });
  const followUp = useMutation({
    mutationFn: call(
      () =>
        createSafetyFollowUp({
          safetyEventId: eventId,
          participantId: query.data!.event.participantId,
          runtimeSessionId: query.data!.event.runtimeSessionId,
          title: "Review follow-up",
          description: "Complete Stage 4 demo follow-up task",
          priority: query.data!.event.urgency,
          linkedMemoryIds: query.data!.event.linkedSafetyMemoryIds,
          linkedGoalIds: [],
          linkedHomeworkIds: [],
        }),
      "Follow-up created",
    ),
  });
  const resolve = useMutation({ mutationFn: call(() => resolveSafetyEvent(eventId, { code: "demo_resolved", summary: "Resolved in demo workflow" }), "Resolved") });
  const close = useMutation({ mutationFn: call(() => closeSafetyEvent(eventId, "Closed after demo resolution"), "Closed") });
  const falsePositive = useMutation({
    mutationFn: call(
      () =>
        markSafetyEventFalsePositive(eventId, {
          reviewerId: activeActorId,
          reason: note || "Reviewed source evidence and marked as false positive",
          evidenceReviewed: true,
          safetyRuleReviewRequired: true,
          sessionResumeRecommended: true,
        }),
      "Marked false positive",
    ),
  });
  const reopen = useMutation({
    mutationFn: call(
      () =>
        reopenSafetyEvent(eventId, {
          actorId: activeActorId,
          reason: note || "Reopened for additional evidence review",
          sessionReviewRequired: true,
          createFollowUp: true,
        }),
      "Reopened",
    ),
  });
  const generateReport = useMutation({
    mutationFn: async () => {
      const report = await generateSafetyEventReport(eventId);
      toast.success("Report generated");
      await invalidate();
      router.push(`/runtime/safety/reports/${report.id}`);
    },
  });

  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;
  if (!query.data) return <AppShell><Card className="m-6"><EmptyState title="Safety event not found" /></Card></AppShell>;
  const { event, transitions, triage: triageHistory, interventions, followUps, safetyMemories, handoffs, resumeRequests, reports } = query.data;
  const clinicianOptions = DEMO_ACTORS.filter((actor) => actor.role === "clinician" || actor.role === "supervisor" || actor.role === "safety_reviewer");

  return (
    <AppShell>
      <PageHeader
        title={event.triggerSummary}
        description="Event evidence, operational workflow, intervention, handoff, resume, report, and linked safety memory."
        eyebrow="Stage 4"
        meta={<><Badge tone={event.severity === "high" ? "critical" : event.severity === "medium" ? "warning" : "success"}>{event.severity}</Badge><Badge tone="warning">{event.urgency}</Badge><Badge tone="primary">{event.status}</Badge></>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => ack.mutate()} disabled={event.status !== "queued"}>Acknowledge</Button>
            <Button variant="secondary" onClick={() => triage.mutate()}>Triage</Button>
            <Button variant="secondary" onClick={() => { setSelectedClinicianId("CLIN-A"); assign.mutate(); }}>Assign</Button>
            <Button variant="secondary" onClick={() => createIntervention.mutate()}>Create Intervention</Button>
            <Button variant="secondary" onClick={() => { setNote(""); setModal("followUp"); }}>Follow-up</Button>
            <Button variant="secondary" onClick={() => { setNote("Reviewed source evidence and marked as false positive"); setModal("falsePositive"); }}>False Positive</Button>
            <Button variant="secondary" onClick={() => { setNote("Reopened for additional evidence review"); setModal("reopen"); }}>Reopen</Button>
            <Button variant="secondary" onClick={() => generateReport.mutate()}>Generate Report</Button>
            <Button onClick={() => { setNote("Resolved in demo workflow"); setModal("resolve"); }}>Resolve</Button>
            <Button variant="ghost" onClick={() => { setNote("Closed after demo resolution"); setModal("close"); }}>Close</Button>
          </div>
        }
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[1.1fr_.9fr] lg:p-6">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-sm font-semibold text-text-primary">Event evidence</div>
            <div className="mt-3 text-sm text-text-secondary">Session {event.runtimeSessionId} · Node {event.sourceNodeId ?? "n/a"} · Rules {event.safetyRuleIds.join(", ") || "none"}</div>
            <div className="mt-2 text-xs text-text-secondary">Patient-facing status: {event.patientFacingStatus}</div>
          </Card>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-text-primary">Timeline</div>
              {!!reports.length && <Link href={`/runtime/safety/reports/${reports[0].id}`}><Button variant="secondary">Latest Report</Button></Link>}
            </div>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {transitions.map((item) => (
                  <motion.div key={item.id} variants={reducedMotion ? undefined : fadeUp} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"} className="rounded-panel border border-border p-3 text-sm text-text-secondary">
                    {item.createdAt} · {item.actorRole} · {item.previousStatus ?? "none"} → {item.nextStatus} · {item.reason}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold text-text-primary">Linked safety memory</div>
            <div className="mt-3 space-y-2">
              {safetyMemories.length ? safetyMemories.map((memory) => <div key={memory!.id} className="rounded-panel border border-border p-3 text-sm text-text-secondary">{memory!.title} · {memory!.content}</div>) : <div className="text-xs text-text-secondary">No linked safety-restricted memory.</div>}
            </div>
          </Card>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-text-primary">Resume requests</div>
              <Button
                variant="secondary"
                onClick={async () => {
                  await requestSessionResume(event.runtimeSessionId, event.id, activeActorId, "Requesting runtime resume after review");
                  await invalidate();
                }}
              >
                Request Resume
              </Button>
            </div>
            <div className="space-y-2">
              {resumeRequests.map((item) => (
                <div key={item.id} className="rounded-panel border border-border p-3 text-sm text-text-secondary">
                  <div>{item.status} · {item.reason}</div>
                  <div className="mt-2 flex gap-2">
                    {item.status === "pending" && <Button variant="secondary" onClick={async () => { await authorizeSessionResume(event.runtimeSessionId, event.id, activeActorId, { reason: "Conditions verified", patientFacingMessage: "The session can continue now." }); await invalidate(); }}>Authorize</Button>}
                    {(item.status === "authorized") && <Button onClick={async () => { await resumeSafetyHeldSession(event.runtimeSessionId, event.id); await invalidate(); }}>Resume Runtime</Button>}
                  </div>
                </div>
              ))}
              {!resumeRequests.length && <div className="text-xs text-text-secondary">No resume request yet.</div>}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-sm font-semibold text-text-primary">Triage history</div>
            <div className="mt-3 space-y-2">
              {triageHistory.map((item) => <div key={item.id} className="rounded-panel border border-border p-3 text-sm text-text-secondary">{item.createdAt} · severity {item.selectedSeverity} · urgency {item.selectedUrgency} · {item.rationale}</div>)}
              {!triageHistory.length && <div className="text-xs text-text-secondary">No triage record yet.</div>}
            </div>
          </Card>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-text-primary">Interventions</div>
            </div>
            <div className="space-y-2">
              {interventions.map((item) => (
                <div key={item.id} className="rounded-panel border border-border p-3 text-sm text-text-secondary">
                  <div>{item.channel} · {item.status} · {item.internalNote}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.status === "planned" && <Button variant="secondary" onClick={async () => { await startHumanIntervention(item.id); await invalidate(); }}>Start</Button>}
                    {["planned", "in_progress"].includes(item.status) && <Button variant="secondary" onClick={async () => { await completeHumanIntervention(item.id, { outcomeCode: "completed", outcomeSummary: "Completed in demo workflow", nextAction: "request_resume" }); await invalidate(); }}>Complete</Button>}
                    {["planned", "in_progress"].includes(item.status) && <Button variant="ghost" onClick={async () => { await cancelHumanIntervention(item.id, "Cancelled in demo"); await invalidate(); }}>Cancel</Button>}
                    {item.status === "in_progress" && <Button variant="ghost" onClick={async () => { await failHumanIntervention(item.id, "Marked failed in demo"); await invalidate(); }}>Fail</Button>}
                  </div>
                  {item.channel !== "in_app" && <div className="mt-2 text-[11px] text-warning">Demo placeholder: no real-world contact will be made</div>}
                </div>
              ))}
              {!interventions.length && <div className="text-xs text-text-secondary">No intervention record yet.</div>}
            </div>
          </Card>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-text-primary">Handoffs</div>
              <Button
                variant="secondary"
                onClick={async () => {
                  await createClinicianHandoff({
                    safetyEventId: event.id,
                    fromClinicianId: activeActorId,
                    toClinicianId: "CLIN-B",
                    summary: "Transfer event review to Clinician B",
                    pendingActions: ["review intervention outcome"],
                    applyAssignmentOnAcknowledge: true,
                  });
                  await invalidate();
                }}
              >
                Create Handoff
              </Button>
            </div>
            <div className="space-y-2">
              {handoffs.map((item) => (
                <div key={item.id} className="rounded-panel border border-border p-3 text-sm text-text-secondary">
                  <div>{item.summary} · {item.status} · {item.toClinicianId}</div>
                  <div className="mt-2 flex gap-2">
                    {item.status === "pending" && <Button variant="secondary" onClick={async () => { await acknowledgeClinicianHandoff(item.id, item.toClinicianId); await invalidate(); }}>Acknowledge</Button>}
                    {item.status === "pending" && <Button variant="ghost" onClick={async () => { await cancelClinicianHandoff(item.id, "Cancelled in demo"); await invalidate(); }}>Cancel</Button>}
                  </div>
                </div>
              ))}
              {!handoffs.length && <div className="text-xs text-text-secondary">No handoff record yet.</div>}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold text-text-primary">Follow-ups</div>
            <div className="mt-3 space-y-2">
              {followUps.map((item) => (
                <div key={item.id} className="rounded-panel border border-border p-3 text-sm text-text-secondary">
                  <div>{item.title} · {item.status} · {item.priority}</div>
                  <div className="mt-1 text-xs text-text-secondary">Due {item.dueAt ?? "not set"} · Assignee {item.assignedClinicianId ?? "unassigned"}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!item.assignedClinicianId && item.status === "open" && <Button variant="secondary" onClick={async () => { await assignSafetyFollowUp(item.id, activeActorId.startsWith("CLIN-") ? activeActorId : "CLIN-A"); await invalidate(); }}>Assign</Button>}
                    {item.status === "assigned" && <Button variant="secondary" onClick={async () => { await startSafetyFollowUp(item.id); await invalidate(); }}>Start</Button>}
                    {["assigned", "in_progress"].includes(item.status) && <Button variant="secondary" onClick={async () => { await completeSafetyFollowUp(item.id, "Completed in Stage 4 event workflow"); await invalidate(); }}>Complete</Button>}
                    {item.status === "completed" && <Button variant="secondary" onClick={async () => { await reopenSafetyFollowUp(item.id, "Reopened from event detail"); await invalidate(); }}>Reopen</Button>}
                    {["open", "assigned", "in_progress"].includes(item.status) && <Button variant="ghost" onClick={async () => { await cancelSafetyFollowUp(item.id, "Cancelled from event detail"); await invalidate(); }}>Cancel</Button>}
                  </div>
                </div>
              ))}
              {!followUps.length && <div className="text-xs text-text-secondary">No follow-up task yet.</div>}
            </div>
          </Card>
        </div>
      </div>
      <Modal open={modal !== null} onClose={() => setModal(null)} title="Safety workflow action" description={event.triggerSummary}>
        <div className="space-y-4 p-5">
          {(modal === "handoff" || modal === "followUp") && (
            <Field label="Clinician">
              <select className={inputClass} value={selectedClinicianId} onChange={(e) => setSelectedClinicianId(e.target.value)}>
                {clinicianOptions.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Reason / note">
            <textarea className={textareaClass} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!modal) return;
                if (!note.trim()) {
                  toast.error("A note is required");
                  return;
                }
                if (modal === "resolve") await resolve.mutateAsync();
                if (modal === "close") await close.mutateAsync();
                if (modal === "falsePositive") await falsePositive.mutateAsync();
                if (modal === "reopen") await reopen.mutateAsync();
                if (modal === "followUp") await followUp.mutateAsync();
                setModal(null);
                setNote("");
              }}
            >
              Submit
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
