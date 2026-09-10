"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Card, EmptyState, Field, Modal, PageHeader, PageSkeleton, inputClass, textareaClass } from "@/components/ui/primitives";
import { assignSafetyFollowUp, cancelSafetyFollowUp, completeSafetyFollowUp, getSafetyFollowUps, reopenSafetyFollowUp, startSafetyFollowUp } from "@/lib/api/safety-operations-api";
import { DEMO_ACTORS } from "@/lib/demo-actor";
import { useStudioStore } from "@/stores/studio-store";
import type { SafetyFollowUpTask } from "@/types/safety-operations";

export function RuntimeSafetyFollowUpsPage() {
  const queryClient = useQueryClient();
  const activeActorId = useStudioStore((state) => state.activeActorId);
  const query = useQuery({ queryKey: ["safety-followups"], queryFn: getSafetyFollowUps });
  const [dialog, setDialog] = useState<
    | { type: "assign"; item: SafetyFollowUpTask }
    | { type: "complete"; item: SafetyFollowUpTask }
    | { type: "reopen"; item: SafetyFollowUpTask }
    | { type: "cancel"; item: SafetyFollowUpTask }
    | null
  >(null);
  const [clinicianId, setClinicianId] = useState("CLIN-A");
  const [note, setNote] = useState("");

  const run = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      toast.success("Follow-up updated");
      await queryClient.invalidateQueries({ queryKey: ["safety-followups"] });
      await queryClient.invalidateQueries({ queryKey: ["safety-event-detail"] });
      await queryClient.invalidateQueries({ queryKey: ["safety-my-queue"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Follow-up action failed"),
  });

  const clinicianOptions = useMemo(() => DEMO_ACTORS.filter((item) => item.role === "clinician"), []);

  if (query.isLoading) return <AppShell><PageSkeleton /></AppShell>;

  return (
    <AppShell>
      <PageHeader title="Safety Follow-ups" description="Assigned, overdue, completed, reopened, and cancelled follow-up work." eyebrow="Stage 4" />
      <div className="space-y-3 p-4 lg:p-6">
        {!query.data?.length && <Card><EmptyState title="No follow-up tasks" /></Card>}
        {query.data?.map((item) => (
          <Card key={item.id} className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-text-primary">{item.title}</div>
                  <span className="rounded border border-border bg-surface-subtle px-2 py-0.5 text-[11px] text-text-secondary">{item.status}</span>
                  <span className="rounded border border-border bg-surface-subtle px-2 py-0.5 text-[11px] text-text-secondary">{item.priority}</span>
                </div>
                <div className="mt-1 text-xs text-text-secondary">{item.description}</div>
                <div className="mt-2 grid gap-1 text-[11px] text-text-secondary md:grid-cols-2">
                  <div>Assigned clinician: {item.assignedClinicianId ?? "Unassigned"}</div>
                  <div>Due: {item.dueAt ?? "Not set"}</div>
                  <div>Participant: {item.participantId}</div>
                  <div>Source event: {item.safetyEventId}</div>
                  {!!item.completionNote && <div className="md:col-span-2">Completion note: {item.completionNote}</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/runtime/safety/events/${item.safetyEventId}`}><Button variant="secondary">Open Source Event</Button></Link>
                {!item.assignedClinicianId && item.status === "open" && (
                  <Button variant="secondary" onClick={() => { setClinicianId(activeActorId.startsWith("CLIN-") ? activeActorId : "CLIN-A"); setDialog({ type: "assign", item }); }}>Assign</Button>
                )}
                {item.status === "assigned" && (
                  <Button variant="secondary" onClick={() => run.mutate(() => startSafetyFollowUp(item.id))}>Start</Button>
                )}
                {["assigned", "in_progress"].includes(item.status) && (
                  <Button onClick={() => { setNote("Completed in Stage 4 workflow"); setDialog({ type: "complete", item }); }}>Complete</Button>
                )}
                {item.status === "completed" && (
                  <Button variant="secondary" onClick={() => { setNote("Additional follow-up required"); setDialog({ type: "reopen", item }); }}>Reopen</Button>
                )}
                {["open", "assigned", "in_progress"].includes(item.status) && (
                  <Button variant="ghost" onClick={() => { setNote("Cancelled in Stage 4 workflow"); setDialog({ type: "cancel", item }); }}>Cancel</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Modal
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={dialog ? `${dialog.type[0].toUpperCase()}${dialog.type.slice(1)} follow-up` : "Follow-up action"}
        description={dialog?.item.title ?? "Follow-up workflow action"}
      >
        <div className="space-y-4 p-5">
          {dialog?.type === "assign" && (
            <Field label="Assigned clinician">
              <select className={inputClass} value={clinicianId} onChange={(event) => setClinicianId(event.target.value)}>
                {clinicianOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          )}
          {dialog && dialog.type !== "assign" && (
            <Field label={dialog.type === "complete" ? "Completion note" : dialog.type === "reopen" ? "Reopen reason" : "Cancellation reason"}>
              <textarea className={textareaClass} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!dialog) return;
                if (dialog.type !== "assign" && !note.trim()) {
                  toast.error("A note is required");
                  return;
                }
                run.mutate(async () => {
                  if (dialog.type === "assign") return assignSafetyFollowUp(dialog.item.id, clinicianId);
                  if (dialog.type === "complete") return completeSafetyFollowUp(dialog.item.id, note.trim());
                  if (dialog.type === "reopen") return reopenSafetyFollowUp(dialog.item.id, note.trim());
                  return cancelSafetyFollowUp(dialog.item.id, note.trim());
                });
                setDialog(null);
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
