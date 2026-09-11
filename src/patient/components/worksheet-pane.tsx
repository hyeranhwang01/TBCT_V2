"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Circle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, SectionHeader } from "@/shared/components/ui/primitives";
import { confirmWorksheetField, editWorksheetField, getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import { PATIENT_COMPOSED_WORKSHEET_SESSIONS, getComposedWorksheet } from "@/shared/worksheet/composed-worksheet-registry";
import { QuestCompleteBadge, WorksheetSourceProvider, useJustFilled } from "@/patient/components/worksheet-renderers/shared";
import { useRealtimeInvalidate } from "@/shared/supabase/use-realtime-invalidate";
import { fadeUp } from "@/shared/motion/motion-variants";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";
import type { WorksheetFieldStatus, WorksheetFieldView } from "@/types/worksheet";
import type { RuntimeMessage } from "@/types/runtime-session";

// The interactive visual worksheet -- a typed projection of
// RuntimeContext.fields (see src/shared/worksheet/worksheet-projection.ts for
// the write-path contract).
//
// variant="clinician" (Patient Monitoring's Worksheet tab): the full
// composed component that rebuilds that session's own source TBCT figure in
// real HTML/CSS (see composed-worksheet-registry.ts, one per session
// s01-s08), values and all, plus the flat field-status/"Advanced" list.
//
// variant="patient" (the participant's own chat page): by default NEVER
// shows a field's actual value -- the participant already said it, in the
// chat transcript right next to this panel; this side only confirms "this is
// recorded" as each field fills, as a lightweight progress feed
// (PatientProgressFeed below). Exception: sessions in
// PATIENT_COMPOSED_WORKSHEET_SESSIONS (S01) show their own worksheets,
// read-only, because the real first session filled two paper worksheets
// together with the participant (.claude/TASK_SCOPE.json
// note2026_09_12_s01_redesign).

const STATUS_TONE: Record<WorksheetFieldStatus, "success" | "primary" | "neutral" | "warning" | "critical"> = {
  empty: "neutral",
  active: "primary",
  draft_extracted: "warning",
  shown_to_participant: "warning",
  participant_confirmed: "success",
  participant_edited: "primary",
  not_applicable: "neutral",
  clinician_review_required: "critical",
  locked: "neutral",
};

const STATUS_LABEL: Record<WorksheetFieldStatus, string> = {
  empty: "Not yet reached",
  active: "In progress",
  draft_extracted: "Draft — needs your confirmation",
  shown_to_participant: "Shown to you",
  participant_confirmed: "Confirmed",
  participant_edited: "Edited by you",
  not_applicable: "Not applicable",
  clinician_review_required: "Needs clinician review",
  locked: "Locked",
};

export function WorksheetPane({
  runtimeSessionId,
  sessionDefinitionId,
  activeCanonicalFieldKey,
  variant,
  locale = "en-US",
  messages,
  sessionMeta,
  isConversationUpdating = false,
}: {
  runtimeSessionId: string;
  sessionDefinitionId: string;
  activeCanonicalFieldKey?: string;
  variant: "clinician" | "patient";
  /** Only read by variant="patient" (picks labelKo vs label, and the
   * checklist's own header/status copy). The clinician composed worksheets
   * are English-only regardless of session locale, unchanged. */
  locale?: string;
  /** Clinician-only. This session's own chat messages, already fetched by
   * the caller (Patient Monitoring already loads them for the Audit Log
   * tab) -- lets every WorksheetCell offer a real "View source" link back
   * to the message that produced its value (see shared.tsx's
   * WorksheetSourceProvider). Omit to render without source links. */
  messages?: RuntimeMessage[];
  /** Clinician-only. A compact "which session, whose, when" line shown
   * above the figure -- purely presentational strings the caller already
   * has (session number/technique, run status, date, patient identifier);
   * WorksheetPane doesn't fetch or derive any of it itself. */
  sessionMeta?: { sessionLabel: string; statusLabel: string; dateLabel: string; patientLabel: string; incomplete: boolean };
  /** Patient chat only. While a turn is resolving, keep the progress read
   * model close behind the conversation even when a realtime event is late. */
  isConversationUpdating?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["worksheet-view", runtimeSessionId];
  const worksheetQuery = useQuery({
    queryKey,
    queryFn: () => getWorksheetView(runtimeSessionId, sessionDefinitionId),
    refetchInterval: isConversationUpdating ? 750 : false,
  });
  const wasConversationUpdatingRef = useRef(isConversationUpdating);
  useEffect(() => {
    const justFinishedTurn = wasConversationUpdatingRef.current && !isConversationUpdating;
    wasConversationUpdatingRef.current = isConversationUpdating;
    if (!justFinishedTurn) return undefined;
    // The projection write and realtime notification can land just after the
    // main turn response. A short bounded burst closes that race without
    // restoring permanent polling or adding latency to the reply itself.
    void worksheetQuery.refetch();
    const retryOne = window.setTimeout(() => void worksheetQuery.refetch(), 350);
    const retryTwo = window.setTimeout(() => void worksheetQuery.refetch(), 1200);
    return () => {
      window.clearTimeout(retryOne);
      window.clearTimeout(retryTwo);
    };
  }, [isConversationUpdating, worksheetQuery.refetch]);
  // Was refetchInterval: 4000 -- this pane is mounted on every active
  // session screen (both patient chat and clinician Worksheet tab) app-wide,
  // making it the single most-instantiated polling site by total tick count.
  // Realtime replaces the timer: a change to this session's worksheet
  // instance/field-values still triggers the exact same authorized refetch,
  // just on a websocket event instead of every 4 seconds regardless of
  // whether anything changed.
  useRealtimeInvalidate(
    [
      { table: "worksheet_instances", filter: `runtime_session_id=eq.${runtimeSessionId}` },
      { table: "worksheet_field_values" },
    ],
    queryKey,
  );

  const confirmMutation = useMutation({
    mutationFn: (worksheetFieldKey: string) => confirmWorksheetField(runtimeSessionId, sessionDefinitionId, worksheetFieldKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const editMutation = useMutation({
    mutationFn: ({ worksheetFieldKey, value }: { worksheetFieldKey: string; value: unknown }) => editWorksheetField(runtimeSessionId, sessionDefinitionId, worksheetFieldKey, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const view = worksheetQuery.data;
  if (!view) return null;

  if (variant === "patient") {
    const isKorean = locale.toLowerCase().startsWith("ko");
    // S01 only (PATIENT_COMPOSED_WORKSHEET_SESSIONS): the participant sees
    // the session's own worksheets filling in beside the chat, read-only.
    const PatientWorksheet = PATIENT_COMPOSED_WORKSHEET_SESSIONS.has(sessionDefinitionId) ? getComposedWorksheet(sessionDefinitionId) : undefined;
    if (PatientWorksheet) {
      return (
        <Card className="overflow-hidden">
          <SectionHeader
            title={isKorean ? "워크시트" : "Worksheet"}
            description={isKorean ? "대화하면서 자동으로 채워져요 — 평가하는 게 아니고, 채팅에서 말씀하신 내용이에요." : "Fills in automatically as we talk — nothing here is graded; it is what you said in the chat."}
          />
          <div className="max-h-[calc(100vh-260px)] overflow-auto p-4">
            <PatientWorksheet view={view} activeCanonicalFieldKey={activeCanonicalFieldKey} onConfirm={() => undefined} onEdit={() => undefined} busy={false} runtimeSessionId={runtimeSessionId} locale={locale} readOnly />
          </div>
        </Card>
      );
    }
    return (
      <Card className="overflow-hidden">
        <SectionHeader
          title={isKorean ? "진행 상황" : "Your Progress"}
          description={isKorean ? "대화하면서 채워져요 — 평가하는 게 아니고, 이미 채팅에서 말씀하신 내용이에요." : "Fills in as we talk — nothing here is graded, and you already said all of it in the chat."}
        />
        <div className="max-h-[calc(100vh-260px)] overflow-auto p-4">
          <PatientProgressFeed fields={view.fields} isKorean={isKorean} activeCanonicalFieldKey={activeCanonicalFieldKey} />
        </div>
      </Card>
    );
  }

  const busy = confirmMutation.isPending || editMutation.isPending;
  const onConfirm = (worksheetFieldKey: string) => confirmMutation.mutate(worksheetFieldKey);
  const onEdit = (worksheetFieldKey: string, value: unknown) => editMutation.mutate({ worksheetFieldKey, value });
  const ComposedWorksheet = getComposedWorksheet(sessionDefinitionId);
  const hasPrimaryView = Boolean(ComposedWorksheet);

  return (
    <Card className="overflow-hidden">
      <SectionHeader title="Session Worksheet" description="Fills in as you answer -- confirm a box once it looks right, or edit it." />
      {sessionMeta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-subtle/60 px-4 py-2 text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">{sessionMeta.sessionLabel}</span>
          <span>{sessionMeta.statusLabel}</span>
          {sessionMeta.incomplete && <Badge tone="warning">Incomplete session</Badge>}
          <span>{sessionMeta.dateLabel}</span>
          <span>{sessionMeta.patientLabel}</span>
        </div>
      )}
      <div className="max-h-[calc(100vh-260px)] space-y-4 overflow-auto p-4">
        <WorksheetSourceProvider messages={messages ?? []}>
          {ComposedWorksheet ? (
            <ComposedWorksheet view={view} activeCanonicalFieldKey={activeCanonicalFieldKey} onConfirm={onConfirm} onEdit={onEdit} busy={busy} runtimeSessionId={runtimeSessionId} />
          ) : (
            <div className="space-y-2">
              {view.fields.map((field) => (
                <WorksheetFieldRow
                  key={field.definition.id}
                  field={field}
                  isActive={field.binding.canonicalFieldKey === activeCanonicalFieldKey}
                  onConfirm={() => onConfirm(field.definition.worksheetFieldKey)}
                  onEdit={(value) => onEdit(field.definition.worksheetFieldKey, value)}
                  busy={busy}
                />
              ))}
            </div>
          )}

          {hasPrimaryView && (
            <details className="rounded-panel border border-border bg-surface-subtle p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">Advanced: field status (clinician view)</summary>
              <div className="mt-3 space-y-2">
                {view.fields.map((field) => (
                  <WorksheetFieldRow
                    key={field.definition.id}
                    field={field}
                    isActive={field.binding.canonicalFieldKey === activeCanonicalFieldKey}
                    onConfirm={() => onConfirm(field.definition.worksheetFieldKey)}
                    onEdit={(value) => onEdit(field.definition.worksheetFieldKey, value)}
                    busy={busy}
                  />
                ))}
              </div>
            </details>
          )}
        </WorksheetSourceProvider>
      </div>
    </Card>
  );
}

/** variant="patient" only -- a full checklist of everything this session
 * expects (every bound field, in the same displayOrder the clinician's own
 * composed worksheet uses), never a field's actual value -- the participant
 * already has that, it's what they just typed in the chat transcript right
 * next to this panel. Unfilled items show an outline circle; a filled item
 * gets a checkmark immediately to the right of its own label, in place,
 * rather than a growing feed of only-completed items appended elsewhere. */
function PatientProgressFeed({ fields, isKorean, activeCanonicalFieldKey }: { fields: WorksheetFieldView[]; isKorean: boolean; activeCanonicalFieldKey?: string }) {
  const reducedMotion = Boolean(useReducedMotionPreference());
  const orderedFields = [...fields].sort((left, right) => left.binding.displayOrder - right.binding.displayOrder);

  if (!orderedFields.length) {
    return (
      <div className="rounded-panel border border-dashed border-border bg-surface-subtle/60 p-4 text-center text-sm text-text-muted">
        {isKorean ? "이 세션에는 기록할 항목이 없어요." : "Nothing to record for this session."}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {orderedFields.map((field) => (
        <ProgressChecklistRow key={field.definition.id} field={field} isKorean={isKorean} reducedMotion={reducedMotion} isActive={field.binding.canonicalFieldKey === activeCanonicalFieldKey} />
      ))}
    </div>
  );
}

function ProgressChecklistRow({ field, isKorean, reducedMotion, isActive }: { field: WorksheetFieldView; isKorean: boolean; reducedMotion: boolean; isActive: boolean }) {
  const filled = field.value !== null && field.value.value !== undefined && field.value.value !== "";
  const justFilled = useJustFilled(filled, reducedMotion);
  const confirmed = field.value?.status === "participant_confirmed";
  const timestamp = field.value?.updatedAt;
  const label = isKorean ? (field.binding.labelKo ?? field.binding.label) : field.binding.label;
  const rowRef = useRef<HTMLDivElement>(null);

  // Keep the checklist scrolled to wherever the conversation actually is --
  // the two panels have no shared scroll position (independent transcripts
  // of very different heights), so the practical way to keep "the item that
  // just got filled" visible alongside "the message that just filled it" is
  // to bring THIS row into view the moment it completes, rather than trying
  // to compute a matching pixel offset between two unrelated layouts.
  useEffect(() => {
    if (justFilled) rowRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }, [justFilled, reducedMotion]);

  // Follow the conversation, not only completed writes. The active prompt
  // can move to a later worksheet field before that field has a value, so a
  // justFilled-only scroll leaves the right pane pinned near the top while
  // the chat continues several steps below it.
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
  }, [isActive, reducedMotion]);

  return (
    <motion.div
      ref={rowRef}
      className={`relative scroll-my-6 flex items-center justify-between gap-3 rounded-panel border px-3 py-2 transition ${filled ? "border-success/40 bg-success-light/20" : isActive ? "border-clinical-blue bg-clinical-blue-light/40 ring-1 ring-clinical-blue" : "border-dashed border-border bg-surface-subtle/50"}`}
      variants={reducedMotion ? undefined : fadeUp}
      initial={reducedMotion ? false : "initial"}
      animate={reducedMotion ? undefined : "animate"}
    >
      {justFilled && <QuestCompleteBadge />}
      <div className="min-w-0 flex-1 truncate text-sm text-text-primary">{label}</div>
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-secondary">
        {filled ? (
          <>
            <span className="whitespace-nowrap">
              {confirmed ? (isKorean ? "확인됨" : "Confirmed") : (isKorean ? "기록됨" : "Recorded")}
              {timestamp && ` · ${new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            </span>
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          </>
        ) : isActive ? (
          <><span className="whitespace-nowrap text-clinical-blue">{isKorean ? "진행 중" : "In progress"}</span><Circle className="h-4 w-4 text-clinical-blue" aria-hidden /></>
        ) : (
          <Circle className="h-4 w-4 text-border-strong" aria-hidden />
        )}
      </div>
    </motion.div>
  );
}

function WorksheetFieldRow({ field, isActive, onConfirm, onEdit, busy }: { field: WorksheetFieldView; isActive: boolean; onConfirm: () => void; onEdit: (value: unknown) => void; busy: boolean }) {
  const reducedMotion = Boolean(useReducedMotionPreference());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value?.displayValue ?? "");
  const status = field.value?.status ?? "empty";
  const filled = field.value !== null && field.value.value !== undefined && field.value.value !== "";
  const justFilled = useJustFilled(filled, reducedMotion);

  return (
    <motion.div
      className={`relative rounded-panel border p-3 transition ${isActive ? "border-clinical-blue bg-clinical-blue-light/40 ring-1 ring-clinical-blue" : justFilled ? "border-success ring-1 ring-success" : filled ? "border-border bg-surface" : "border-dashed border-border bg-surface-subtle/60"}`}
      variants={reducedMotion ? undefined : fadeUp}
      initial={reducedMotion ? false : "initial"}
      animate={reducedMotion ? undefined : "animate"}
    >
      {justFilled && <QuestCompleteBadge />}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">{field.binding.label}</div>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </div>
      {field.binding.sourceSection && <div className="mt-0.5 text-[10px] text-text-muted">{field.binding.sourceSection}</div>}

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea className="w-full rounded-panel border border-border bg-surface px-2 py-1.5 text-sm" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => { onEdit(field.binding.valueType === "percentage" || field.binding.valueType === "integer" ? Number(draft) : draft); setEditing(false); }}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : filled ? (
        <>
          {field.binding.valueType === "percentage" ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                <div className="h-full rounded-full bg-clinical-blue transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(field.value?.value) || 0))}%` }} />
              </div>
              <span className="text-sm font-semibold text-text-primary">{field.value?.displayValue}%</span>
            </div>
          ) : field.binding.valueType === "text_list" ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(Array.isArray(field.value?.value) ? (field.value?.value as unknown[]) : []).map((item, index) => (
                <span key={index} className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs text-text-primary">{String(item)}</span>
              ))}
            </div>
          ) : (
            <div className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">{field.value?.displayValue}</div>
          )}
          <div className="mt-2 flex gap-2">
            {status === "draft_extracted" && (
              <Button size="sm" onClick={onConfirm} disabled={busy}>Confirm</Button>
            )}
            {field.binding.participantOwned && (
              <Button size="sm" variant="secondary" onClick={() => { setDraft(field.value?.displayValue ?? ""); setEditing(true); }} disabled={busy}>Edit</Button>
            )}
          </div>
        </>
      ) : (
        <div className="mt-1 text-sm text-text-muted">—</div>
      )}
    </motion.div>
  );
}
