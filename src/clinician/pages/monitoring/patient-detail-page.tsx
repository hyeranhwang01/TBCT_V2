"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList } from "lucide-react";
import { AppShell } from "@/clinician/components/app-shell";
import { StreamingText } from "@/patient/components/streaming-text";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import {
  Badge,
  Button,
  Card,
  ConfirmActionDialog,
  EmptyState,
  Field,
  IllustratedEmptyState,
  Modal,
  PageHeader,
  PageSkeleton,
  SectionHeader,
  inputClass,
  textareaClass,
} from "@/shared/components/ui/primitives";
import { useT } from "@/lib/i18n/context";
import { assignClinicianToParticipant, getRuntimeParticipant, resolveClinicianEmail } from "@/lib/api/participant-api";
import { useAuth } from "@/lib/auth/auth-context";
import { getRuntimeSession, listCanonicalTestSessions, listRuntimeSessions } from "@/lib/api/runtime-session-api";
import { pauseRuntimeSession, resumeRuntimeSession, terminateRuntimeSession } from "@/lib/api/runtime-execution-api";
import { addClinicianNote, deleteClinicianNote, getClinicianNotes } from "@/lib/api/longitudinal-memory-api";
import { getSafetyEvents } from "@/lib/api/safety-operations-api";
import { listStandardizedAssessments } from "@/lib/api/standardized-assessment-api";
import { ClinicianMessageThread } from "@/shared/components/clinician-message-thread";
import { RuntimeInspectorView } from "@/clinician/pages/monitoring/inspector-view";
import { AppointmentPanel } from "@/clinician/pages/monitoring/appointment-panel";
import { useRealtimeInvalidate } from "@/lib/supabase/use-realtime-invalidate";
import {
  deriveMonitoringStatus,
  findSessionTitle,
  findStepTitle,
  isOpenSafetyEvent,
  summarizeParticipant,
  type MonitoringStatus,
} from "@/clinician/pages/monitoring/patient-monitoring-utils";
import { HomeworkPanel } from "@/clinician/pages/monitoring/homework-panel";
import { ClinicianCheckinModal } from "@/clinician/pages/monitoring/clinician-checkin-modal";
import { SessionProgressPanel, sessionSupportsProgressTab } from "@/clinician/pages/monitoring/session-progress-panel";
import { WorksheetPane } from "@/patient/components/worksheet-pane";
import { hasWorksheetBindings } from "@/lib/worksheet/worksheet-binding-registry";
import type { RuntimeMessageRole, RuntimeSession } from "@/types/runtime-session";
import type { SeverityBand } from "@/types/standardized-assessment";

type AuditFilter = "all" | "program" | "patient" | "notes";

const STATUS_TONE: Record<MonitoringStatus, "primary" | "warning" | "critical" | "success" | "neutral"> = {
  inProgress: "primary",
  paused: "warning",
  needsReview: "critical",
  completed: "success",
  notStarted: "neutral",
};

const ASSESSMENT_SEVERITY_TONE: Record<SeverityBand, "success" | "neutral" | "warning" | "critical"> = {
  minimal: "success",
  mild: "neutral",
  moderate: "warning",
  moderately_severe: "critical",
  severe: "critical",
};

function formatTimestamp(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

/** Same locale fallback findStepTitle (patient-monitoring-utils.ts) applies,
 * for the two spots here that already have the node object in hand (a
 * fallback when a message's nodeId isn't in the canonical catalog, and the
 * "Current Step" summary row) rather than just its id. */
function localizedNodeTitle(node?: { title: string; titleKo?: string }, locale?: string): string | undefined {
  if (!node) return undefined;
  return locale === "ko" ? (node.titleKo ?? node.title) : node.title;
}

interface TimelineEntry {
  id: string;
  kind: "message" | "note" | "lifecycle";
  speaker: "program" | "patient" | "clinician";
  content: string;
  stepTitle?: string;
  createdAt: string;
  sessionDefinitionId?: string;
  nodeId?: string;
  promptItemId?: string;
}

export function PatientMonitoringDetailPage() {
  const { t, locale } = useT();
  const params = useParams<{ participantId?: string | string[] }>();
  const pathname = usePathname();
  const participantId =
    (Array.isArray(params?.participantId) ? params.participantId[0] : params?.participantId) ??
    pathname.split("/").filter(Boolean).at(-1) ??
    "";

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const reducedMotion = useReducedMotionPreference();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
  const [activeTab, setActiveTab] = useState<"audit" | "worksheet" | "profile" | "progress" | "messages" | "appointments" | "inspector">("audit");
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteToDelete, setNoteToDelete] = useState<{ id: string; content: string } | null>(null);
  const [checkinModalOpen, setCheckinModalOpen] = useState(false);
  // Purely visual: a hairline shadow appears under the "기록 로그" header
  // once its list has actually been scrolled, so the (now always-visible,
  // never-sticky-in-the-old-sense) header reads as "docked above scrolling
  // content" rather than looking like a flat divider that happens to sit
  // there. Off at scrollTop 0 -- there's nothing to separate from yet.
  const [logScrolled, setLogScrolled] = useState(false);

  const participantQuery = useQuery({
    queryKey: ["patient-monitoring-participant", participantId],
    queryFn: () => getRuntimeParticipant(participantId),
    enabled: Boolean(participantId),
  });
  const assignedClinicianId = participantQuery.data?.assignedClinician;
  const assignedClinicianEmailQuery = useQuery({
    queryKey: ["clinician-email", assignedClinicianId],
    queryFn: () => resolveClinicianEmail(assignedClinicianId!),
    enabled: Boolean(assignedClinicianId),
  });

  const assessmentsQuery = useQuery({
    queryKey: ["standardized-assessments", participantId],
    queryFn: () => listStandardizedAssessments(participantId),
    enabled: Boolean(participantId),
  });

  const participant = participantQuery.data;
  const sessionIds = participant?.runtimeSessionIds ?? [];

  const safetyQuery = useQuery({
    queryKey: ["patient-monitoring-safety-events", participantId],
    queryFn: getSafetyEvents,
    enabled: Boolean(participantId),
  });
  // Was refetchInterval: 5000 -- getSafetyEvents() is unscoped (every
  // participant's events), matching this unfiltered subscription.
  useRealtimeInvalidate([{ table: "safety_events" }], ["patient-monitoring-safety-events", participantId], Boolean(participantId));

  const canonicalSessionsQuery = useQuery({ queryKey: ["patient-monitoring-canonical-sessions"], queryFn: listCanonicalTestSessions });

  const allRuntimeSessionsQuery = useQuery({ queryKey: ["patient-monitoring-sessions"], queryFn: listRuntimeSessions });
  // Was refetchInterval: 5000 -- listRuntimeSessions() is unscoped (the
  // clinician-facing full roster), so this stays an unfiltered subscription
  // to the whole table too, same scope as before.
  useRealtimeInvalidate([{ table: "runtime_sessions" }], ["patient-monitoring-sessions"]);

  const summary = useMemo(
    () => summarizeParticipant(participantId, allRuntimeSessionsQuery.data ?? [], safetyQuery.data ?? [], participant?.updatedAt),
    [participantId, allRuntimeSessionsQuery.data, safetyQuery.data, participant?.updatedAt],
  );

  // Prefers the smartest "current" pick (skips terminal sessions when a
  // live one exists); falls back to the participant record's own session
  // list only while summary.sessions hasn't loaded yet.
  const effectiveSessionId = selectedSessionId ?? summary.currentSession?.id ?? sessionIds.at(-1) ?? "";

  const sessionViewQuery = useQuery({
    queryKey: ["patient-monitoring-session-view-detail", effectiveSessionId],
    queryFn: () => getRuntimeSession(effectiveSessionId),
    enabled: Boolean(effectiveSessionId),
  });
  // Was refetchInterval: 5000 -- this was the heaviest polling site in the
  // app (getRuntimeSession touches 9 tables per tick: sessions/messages/
  // logs/checkpoints/escalations/provider+validation events/participant/
  // memory). Subscribing to just the two tables that actually change during
  // a live turn (the session row itself, and new messages) is enough to
  // trigger a full authorized refetch of everything else in the same shape
  // as before.
  useRealtimeInvalidate(
    [
      { table: "runtime_sessions", filter: `id=eq.${effectiveSessionId}` },
      { table: "runtime_messages", filter: `runtime_session_id=eq.${effectiveSessionId}` },
    ],
    ["patient-monitoring-session-view-detail", effectiveSessionId],
    Boolean(effectiveSessionId),
  );

  // Messages already on screen the first time a session loads (or is switched to)
  // are shown statically; only ones that arrive afterwards stream in.
  const historicalMessageIdsRef = useRef<{ sessionId: string; ids: Set<string> } | null>(null);

  const memoriesQuery = useQuery({
    queryKey: ["patient-monitoring-memories", participantId],
    queryFn: () => getClinicianNotes(participantId),
    enabled: Boolean(participantId),
  });

  // Every individual session run for this participant, grouped by session
  // definition and newest-first -- the "Sessions" list used to show only
  // one aggregated status per definition, which hid every earlier attempt
  // at the same session (e.g. repeated test runs of S01).
  const sessionsByDefinition = useMemo(() => {
    const map = new Map<string, RuntimeSession[]>();
    for (const item of summary.sessions) {
      const list = map.get(item.sessionDefinitionId) ?? [];
      list.push(item);
      map.set(item.sessionDefinitionId, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return map;
  }, [summary.sessions]);

  const runStatus = (item: RuntimeSession): MonitoringStatus =>
    deriveMonitoringStatus(item.status, (safetyQuery.data ?? []).some((event) => event.runtimeSessionId === item.id && isOpenSafetyEvent(event)));

  const sessionLabel = (item: RuntimeSession) =>
    `${findSessionTitle(item.sessionDefinitionId, locale) ?? item.sessionDefinitionId} · ${t(`patientMonitoring.status.${runStatus(item)}`)} · ${formatTimestamp(item.updatedAt)}`;

  const openSession = (sessionId: string, tab: "audit" | "worksheet" | "profile" | "progress" = "audit") => {
    setSelectedSessionId(sessionId);
    setActiveTab(tab);
  };

  const invalidateSession = async () => {
    await queryClient.invalidateQueries({ queryKey: ["patient-monitoring-session-view-detail", effectiveSessionId] });
    await queryClient.invalidateQueries({ queryKey: ["patient-monitoring-sessions"] });
  };

  const pauseMutation = useMutation({
    mutationFn: () => pauseRuntimeSession(effectiveSessionId, t("patientDetail.reasons.pause")),
    onSuccess: async () => {
      toast.success(t("patientDetail.actions.pause"));
      await invalidateSession();
    },
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeRuntimeSession(effectiveSessionId),
    onSuccess: async () => {
      toast.success(t("patientDetail.actions.resume"));
      await invalidateSession();
    },
  });
  const endMutation = useMutation({
    mutationFn: () => terminateRuntimeSession(effectiveSessionId, t("patientDetail.reasons.end")),
    onSuccess: async () => {
      toast.success(t("patientDetail.actions.end"));
      await invalidateSession();
    },
  });
  const addNoteMutation = useMutation({
    mutationFn: (content: string) =>
      addClinicianNote({
        participantId,
        projectId: participant?.projectId ?? "",
        sourceSessionId: effectiveSessionId,
        content,
      }),
    onSuccess: async () => {
      toast.success(t("patientDetail.note.success"));
      setNoteDraft("");
      setNoteModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["patient-monitoring-memories", participantId] });
    },
  });
  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => deleteClinicianNote(noteId),
    onSuccess: async () => {
      toast.success(t("patientDetail.note.deleteSuccess"));
      setNoteToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["patient-monitoring-memories", participantId] });
    },
  });
  const assignMutation = useMutation({
    mutationFn: (clinicianUserId: string | null) => assignClinicianToParticipant(participantId, clinicianUserId),
    onSuccess: async () => {
      toast.success(t("patientDetail.assign.success"));
      await queryClient.invalidateQueries({ queryKey: ["patient-monitoring-participant", participantId] });
    },
  });

  const session = sessionViewQuery.data?.session;
  const nodes = useMemo(() => sessionViewQuery.data?.nodes ?? [], [sessionViewQuery.data?.nodes]);
  const status = summary.monitoringStatus;
  const currentNode = nodes.find((node) => node.id === session?.currentNodeId);

  const clinicianNotes = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];
    const speakerFor = (role: RuntimeMessageRole): TimelineEntry["speaker"] =>
      role === "patient" ? "patient" : role === "clinician" ? "clinician" : "program";

    for (const message of sessionViewQuery.data?.messages ?? []) {
      entries.push({
        id: `message-${message.id}`,
        kind: "message",
        speaker: speakerFor(message.role),
        content: message.content,
        stepTitle: findStepTitle(message.nodeId, locale) ?? localizedNodeTitle(nodes.find((node) => node.id === message.nodeId), locale),
        createdAt: message.createdAt,
        sessionDefinitionId: session?.sessionDefinitionId,
        nodeId: message.nodeId,
        promptItemId: message.promptItemId,
      });
    }

    for (const note of clinicianNotes.filter((memory) => memory.sourceSessionId === effectiveSessionId)) {
      entries.push({
        id: `note-${note.id}`,
        kind: "note",
        speaker: "clinician",
        content: note.content,
        createdAt: note.createdAt,
      });
    }

    if (session?.startedAt) {
      entries.push({ id: "lifecycle-started", kind: "lifecycle", speaker: "program", content: t("patientDetail.audit.lifecycle.started"), createdAt: session.startedAt });
    }
    if (session?.pausedAt) {
      entries.push({ id: "lifecycle-paused", kind: "lifecycle", speaker: "program", content: t("patientDetail.audit.lifecycle.paused"), createdAt: session.pausedAt });
    }
    if (session?.resumedAt) {
      entries.push({ id: "lifecycle-resumed", kind: "lifecycle", speaker: "program", content: t("patientDetail.audit.lifecycle.resumed"), createdAt: session.resumedAt });
    }
    if (session?.completedAt || session?.terminatedAt) {
      entries.push({
        id: "lifecycle-ended",
        kind: "lifecycle",
        speaker: "program",
        content: t("patientDetail.audit.lifecycle.ended"),
        createdAt: session.completedAt ?? session.terminatedAt ?? "",
      });
    }

    return entries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [sessionViewQuery.data?.messages, clinicianNotes, effectiveSessionId, nodes, session, t, locale]);

  useEffect(() => {
    const messageIds = timeline.filter((entry) => entry.kind === "message").map((entry) => entry.id);
    if (!messageIds.length) return;
    if (historicalMessageIdsRef.current?.sessionId !== effectiveSessionId) {
      historicalMessageIdsRef.current = { sessionId: effectiveSessionId, ids: new Set(messageIds) };
    }
  }, [effectiveSessionId, timeline]);

  const filteredTimeline = useMemo(() => {
    if (auditFilter === "all") return timeline;
    if (auditFilter === "notes") return timeline.filter((entry) => entry.kind === "note" || entry.kind === "lifecycle");
    if (auditFilter === "program") return timeline.filter((entry) => entry.speaker === "program" || entry.kind === "lifecycle");
    return timeline.filter((entry) => entry.speaker === "patient");
  }, [timeline, auditFilter]);

  const sessionProgress = useMemo(() => {
    const canonical = canonicalSessionsQuery.data ?? [];
    return canonical.map((definition) => {
      const matched = summary.sessions.find((candidate) => candidate.sessionDefinitionId === definition.id);
      const matchedSummary = summarizeParticipant(participantId, matched ? [matched] : [], safetyQuery.data ?? []);
      return {
        id: definition.id,
        number: definition.number,
        title: locale === "ko" ? (definition.titleKo ?? definition.title) : definition.title,
        status: matched ? matchedSummary.monitoringStatus : "notStarted",
      } satisfies { id: string; number: number; title: string; status: MonitoringStatus };
    });
  }, [canonicalSessionsQuery.data, summary.sessions, safetyQuery.data, participantId, locale]);

  if (participantQuery.isLoading) {
    return (
      <AppShell>
        <PageSkeleton />
      </AppShell>
    );
  }

  if (!participant) {
    return (
      <AppShell>
        <Card className="m-4 lg:m-6">
          <EmptyState title={t("patientDetail.notFound")} />
        </Card>
      </AppShell>
    );
  }

  const speakerLabel = (speaker: TimelineEntry["speaker"]) =>
    speaker === "program" ? t("patientDetail.audit.speaker.program") : speaker === "patient" ? t("patientDetail.audit.speaker.patient") : t("patientDetail.audit.speaker.clinician");

  const canPause = session?.status === "active" || session?.status === "waiting_for_input";
  const canResume = session?.status === "paused";
  const canEnd = Boolean(session) && session?.status !== "completed" && session?.status !== "terminated";

  // "Progress" (longitudinal ratings across repeated runs) only makes sense
  // for the handful of sessions with a real item-matched history read-model
  // -- see session-progress-panel.tsx. Hidden entirely for every other
  // session rather than shown with a permanent "not available" tab.
  const progressSupported = Boolean(session && sessionSupportsProgressTab(session.sessionDefinitionId));
  // Its own tab (not folded into 기록 로그 as an inline "실행 세부정보"
  // section like before) so the full protocol-path/conversation-log/safety/
  // provider/memory view -- see runtime-inspector-view.tsx, shared with the
  // standalone /runtime/sessions/:id route -- gets its own dedicated space
  // instead of being squeezed under the audit log. Only shown once a
  // session actually exists (nothing to inspect before that).
  const inspectorSupported = Boolean(session);
  const tabLabel = (tab: "audit" | "worksheet" | "profile" | "progress" | "messages" | "appointments" | "inspector") =>
    tab === "audit"
      ? t("patientDetail.tabs.auditLog")
      : tab === "worksheet"
        ? t("patientDetail.tabs.worksheet")
        : tab === "progress"
          ? t("patientDetail.tabs.progress")
          : tab === "messages"
            ? t("patientDetail.tabs.messages")
            : tab === "appointments"
              ? t("patientDetail.tabs.appointments")
              : tab === "inspector"
                ? t("patientDetail.tabs.inspector")
                : t("patientDetail.tabs.profile");
  const mobileTabOrder: Array<"profile" | "audit" | "worksheet" | "progress" | "messages" | "appointments" | "inspector"> = [
    "profile",
    "audit",
    "worksheet",
    ...(progressSupported ? (["progress"] as const) : []),
    "messages",
    "appointments",
    ...(inspectorSupported ? (["inspector"] as const) : []),
  ];
  const desktopTabOrder: Array<"audit" | "worksheet" | "progress" | "profile" | "messages" | "appointments" | "inspector"> = [
    "audit",
    "worksheet",
    ...(progressSupported ? (["progress"] as const) : []),
    "profile",
    "messages",
    "appointments",
    ...(inspectorSupported ? (["inspector"] as const) : []),
  ];

  // Compact "which session, whose, when" line WorksheetPane shows above the
  // figure (clinician variant only) -- built from data this page already
  // has, not fetched again inside WorksheetPane itself.
  const activeSessionDefinition = sessionProgress.find((item) => item.id === session?.sessionDefinitionId);
  const worksheetMeta =
    session && activeSessionDefinition
      ? {
          sessionLabel: `S${String(activeSessionDefinition.number).padStart(2, "0")} · ${activeSessionDefinition.title}`,
          statusLabel: t(`patientMonitoring.status.${runStatus(session)}`),
          dateLabel: formatTimestamp(session.completedAt ?? session.updatedAt),
          patientLabel: participant.alias,
          incomplete: session.status !== "completed" && session.status !== "terminated",
        }
      : undefined;

  return (
    <AppShell>
      <PageHeader
        title={participant.alias}
        description={t("patientDetail.description")}
        eyebrow={t("nav.patientMonitoring")}
        meta={
          <>
            <Badge dot tone={STATUS_TONE[status]}>{t(`patientMonitoring.status.${status}`)}</Badge>
            <Badge tone="neutral">
              {t("patientDetail.summary.lastActivity")}: {formatTimestamp(session?.updatedAt ?? participant.updatedAt)}
            </Badge>
          </>
        }
        actions={
          session ? (
            <>
              <Link href={`/patients/${participantId}/report/${session.id}`} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary">{t("patientDetail.actions.printReport")}</Button>
              </Link>
            </>
          ) : undefined
        }
      />

      {/* Mobile (<640px): compact "who/what" context line so it's never lost
          while scrolling a long tab (brief §13), then a tap-strip covering
          the same three tabs/state as the desktop buttons below -- so the
          clinician sees Profile/Sessions/Worksheet exist immediately. */}
      <div className="border-b border-border bg-surface px-4 py-2 sm:hidden">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-semibold text-text-primary">{participant.alias}</span>
          <span className="shrink-0 text-text-muted">{formatTimestamp(session?.updatedAt ?? participant.updatedAt)}</span>
        </div>
      </div>
      <div className="border-b border-border bg-surface px-4 lg:px-6">
        <div className="flex gap-1 py-2 sm:hidden">
          {mobileTabOrder.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`min-h-[44px] flex-1 rounded-panel border text-xs font-semibold transition ${
                activeTab === tab ? "border-clinical-blue bg-clinical-blue-light text-clinical-blue" : "border-border text-text-secondary"
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
        <div className="hidden gap-1 pt-2 sm:flex">
          {desktopTabOrder.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-t-panel border-b-2 px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab ? "border-clinical-blue text-clinical-blue" : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 p-4 lg:p-6">
        {summary.sessions.length > 1 && (
          <Field label={t("patientDetail.sessionSelector")}>
            <select className={inputClass} value={effectiveSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
              {[...summary.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => (
                <option key={item.id} value={item.id}>
                  {sessionLabel(item)}
                </option>
              ))}
            </select>
          </Field>
        )}

        {activeTab === "audit" ? (
          <div className="space-y-4">
            {/* Fixed second column (420px, not a fraction) so the status
                panel's width never shifts with the left column's content --
                see .patient-monitoring-panel in globals.css for the matching
                height-stability half of this fix. */}
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            {/* flex flex-col + a height on the CARD itself (not just its
                scroll area) is the structural piece the earlier fix was
                still missing: the header and scroll body were two plain
                stacked block children with no shared flex parent to
                actually divide the card's height between them, so nothing
                stopped the scroll body's own `height` from making the
                *card* taller than intended -- overflow-hidden on the card
                only clips what doesn't fit its own (unconstrained) height,
                it doesn't cap that height. With the card itself height-
                capped and flex-col, the header (SectionHeader) keeps its
                natural content height as a shrink-0 flex item and the
                scroll body's flex-1 + min-h-0 gets exactly whatever's left
                -- min-h-0 specifically because a flex item's default
                min-height is `auto` (its content size), which silently
                defeats overflow-y-auto by refusing to shrink below the
                content it's supposed to be scrolling. */}
            <Card className="patient-monitoring-panel flex h-[calc(100vh-430px)] min-w-0 flex-col overflow-hidden">
              <SectionHeader
                title={t("patientDetail.tabs.auditLog")}
                className={logScrolled ? "border-b-border-strong shadow-[0_1px_0_0_rgba(15,23,42,0.06)]" : undefined}
                action={
                  <select className={inputClass} value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as AuditFilter)}>
                    <option value="all">{t("patientDetail.audit.filters.all")}</option>
                    <option value="program">{t("patientDetail.audit.filters.program")}</option>
                    <option value="patient">{t("patientDetail.audit.filters.patient")}</option>
                    <option value="notes">{t("patientDetail.audit.filters.notes")}</option>
                  </select>
                }
              />
              <div
                className="audit-log-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
                onScroll={(event) => setLogScrolled(event.currentTarget.scrollTop > 4)}
              >
                {sessionViewQuery.isLoading ? (
                  <PageSkeleton />
                ) : filteredTimeline.length === 0 ? (
                  <EmptyState title={t("patientDetail.audit.noEntries")} />
                ) : (
                  filteredTimeline.map((entry) => {
                    const isNewMessage = entry.kind === "message"
                      && historicalMessageIdsRef.current?.sessionId === effectiveSessionId
                      && !historicalMessageIdsRef.current.ids.has(entry.id);
                    // Restores the pre-de69ab7 "click a message to inspect
                    // it" affordance, just switching to the 인스펙터 tab
                    // (setActiveTab) instead of navigating to the old
                    // /runtime/sessions/:id route -- same entry point, now
                    // in-page.
                    const canInspect = inspectorSupported && entry.kind === "message";
                    return (
                      <div
                        key={entry.id}
                        role={canInspect ? "button" : undefined}
                        tabIndex={canInspect ? 0 : undefined}
                        onClick={canInspect ? () => setActiveTab("inspector") : undefined}
                        onKeyDown={canInspect ? (event) => { if (event.key === "Enter") setActiveTab("inspector"); } : undefined}
                        className={`transition-ui rounded-panel border px-4 py-3 ${canInspect ? "cursor-pointer hover:border-clinical-blue" : ""} ${
                          entry.kind === "lifecycle"
                            ? "border-border bg-surface-subtle"
                            : entry.speaker === "patient"
                              ? "border-clinical-blue-light bg-clinical-blue-light/50"
                              : entry.speaker === "clinician"
                                ? "border-success bg-success-light/40"
                                : "border-border bg-surface"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                          <span>{speakerLabel(entry.speaker)}</span>
                          <span>{formatTimestamp(entry.createdAt)}</span>
                        </div>
                        {entry.stepTitle && <div className="mt-1 text-[11px] text-text-muted">{entry.stepTitle}</div>}
                        <StreamingText
                          streamKey={entry.id}
                          text={entry.content}
                          active={!reducedMotion && isNewMessage}
                          className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary"
                        />
                        {canInspect && <div className="mt-1 text-[11px] text-clinical-blue">{t("patientDetail.audit.viewInspector")}</div>}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>

            <Card className="patient-monitoring-panel flex h-[calc(100vh-430px)] min-w-0 flex-col overflow-hidden">
              <SectionHeader title={t("patientDetail.summary.status")} />
              {/* Same flex-col/min-h-0 structure as the log panel (see its
                  comment) -- also what keeps the two cards the same height,
                  since both cards use the identical calc(). */}
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <SummaryRow label={t("patientDetail.summary.currentSession")} value={findSessionTitle(session?.sessionDefinitionId, locale) ?? t("common.unknown")} />
                <SummaryRow label={t("patientDetail.summary.currentStep")} value={localizedNodeTitle(currentNode, locale) ?? t("common.unknown")} />
                <SummaryRow label={t("patientDetail.summary.status")} value={t(`patientMonitoring.status.${status}`)} />
                <SummaryRow label={t("patientDetail.summary.progress")} value={String(session?.completedPromptItemIds?.length ?? 0)} />
                <SummaryRow label={t("patientDetail.summary.startedAt")} value={formatTimestamp(session?.startedAt)} />
                <SummaryRow label={t("patientDetail.summary.lastActivity")} value={formatTimestamp(session?.updatedAt ?? participant.updatedAt)} />
                {/* All four actions always render (only `disabled` toggles
                    with status), so this group's height is already constant
                    -- the explicit min-height is just a guarantee against
                    that ever changing, per the layout-stability brief. */}
                <div className="flex min-h-[176px] flex-col gap-2 pt-2">
                  <Button variant="secondary" disabled={!canPause || pauseMutation.isPending} onClick={() => pauseMutation.mutate()}>
                    {t("patientDetail.actions.pause")}
                  </Button>
                  <Button variant="secondary" disabled={!canResume || resumeMutation.isPending} onClick={() => resumeMutation.mutate()}>
                    {t("patientDetail.actions.resume")}
                  </Button>
                  <Button variant="danger" disabled={!canEnd || endMutation.isPending} onClick={() => endMutation.mutate()}>
                    {t("patientDetail.actions.end")}
                  </Button>
                  <Button variant="primary" onClick={() => setNoteModalOpen(true)}>
                    {t("patientDetail.actions.addNote")}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
          </div>
        ) : activeTab === "worksheet" ? (
          <div className="min-w-0">
            {session && hasWorksheetBindings(session.sessionDefinitionId) ? (
              <WorksheetPane
                runtimeSessionId={effectiveSessionId}
                sessionDefinitionId={session.sessionDefinitionId}
                activeCanonicalFieldKey={sessionViewQuery.data?.currentPromptItem?.outputFields?.[0]}
                variant="clinician"
                messages={sessionViewQuery.data?.messages}
                sessionMeta={worksheetMeta}
              />
            ) : (
              <Card>
                <EmptyState title={t("patientDetail.worksheet.unavailable")} description="" />
              </Card>
            )}
          </div>
        ) : activeTab === "progress" ? (
          <div className="min-w-0">
            {session ? (
              <SessionProgressPanel runtimeSessionId={effectiveSessionId} sessionDefinitionId={session.sessionDefinitionId} />
            ) : (
              <Card>
                <EmptyState title={t("patientDetail.worksheet.unavailable")} description="" />
              </Card>
            )}
          </div>
        ) : activeTab === "messages" ? (
          <Card className="min-w-0">
            <SectionHeader title={t("patientDetail.tabs.messages")} />
            <div className="p-4">
              <ClinicianMessageThread participantId={participantId} />
            </div>
          </Card>
        ) : activeTab === "appointments" ? (
          <div className="min-w-0">
            <AppointmentPanel participantId={participantId} />
          </div>
        ) : activeTab === "inspector" ? (
          <div className="min-w-0">
            {sessionViewQuery.isLoading ? (
              <PageSkeleton />
            ) : sessionViewQuery.data ? (
              <RuntimeInspectorView view={sessionViewQuery.data} />
            ) : (
              <Card><EmptyState title={t("runtimeInspector.notFound")} /></Card>
            )}
          </div>
        ) : (
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,.85fr)]">
            <Card className="min-w-0">
              <SectionHeader title={t("patientDetail.tabs.profile")} />
              <div className="space-y-3 p-4">
                <SummaryRow label={t("patientDetail.profile.participantId")} value={participant.id} />
                <SummaryRow label={t("patientDetail.profile.displayName")} value={participant.alias} />
                <SummaryRow label={t("patientDetail.profile.status")} value={participant.status} />
                <SummaryRow label={t("patientDetail.profile.enrollmentDate")} value={participant.enrollmentDate ? formatTimestamp(participant.enrollmentDate) : t("common.unknown")} />
                <div className="flex items-center justify-between gap-3">
                  <SummaryRow
                    label={t("patientDetail.profile.assignedClinician")}
                    value={participant.assignedClinician ? (assignedClinicianEmailQuery.data ?? t("common.loading")) : t("common.unknown")}
                  />
                  {participant.assignedClinician === user?.id ? (
                    <Button variant="secondary" size="sm" loading={assignMutation.isPending} onClick={() => assignMutation.mutate(null)}>
                      {t("patientDetail.assign.unassign")}
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" loading={assignMutation.isPending} onClick={() => assignMutation.mutate(user?.id ?? null)} disabled={!user?.id}>
                      {t("patientDetail.assign.assignToMe")}
                    </Button>
                  )}
                </div>
                <SummaryRow label={t("patientDetail.profile.preferredLanguage")} value={participant.locale} />
                <SummaryRow label={t("patientDetail.profile.currentSession")} value={findSessionTitle(session?.sessionDefinitionId, locale) ?? t("common.unknown")} />
                <SummaryRow label={t("patientDetail.profile.completedSessions")} value={String(summary.completedSessionCount)} />
              </div>
              <SectionHeader title={t("patientDetail.profile.sessionsHeading")} />
              <div className="space-y-2 p-4">
                {sessionProgress.map((item) => {
                  const runs = sessionsByDefinition.get(item.id) ?? [];
                  const header = (
                    <div className="flex items-center justify-between gap-2 rounded-panel border border-border px-3 py-2">
                      <div>
                        <div className="text-xs font-semibold text-text-muted">S{String(item.number).padStart(2, "0")}</div>
                        <div className="text-sm text-text-primary">{item.title}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {runs.length > 0 && (
                          <span className="text-[11px] text-text-muted">{t("patientDetail.profile.runsLabel", { count: runs.length })}</span>
                        )}
                        <Badge tone={STATUS_TONE[item.status]}>{t(`patientMonitoring.status.${item.status}`)}</Badge>
                      </div>
                    </div>
                  );
                  if (runs.length === 0) return <div key={item.id}>{header}</div>;
                  return (
                    <details key={item.id} className="group rounded-panel">
                      <summary className="cursor-pointer list-none">{header}</summary>
                      <div className="mt-1.5 space-y-1.5 pl-3">
                        {runs.map((run) => (
                          <div key={run.id} className="flex items-center justify-between gap-2 rounded-panel border border-dashed border-border px-3 py-1.5">
                            <div>
                              <div className="text-[11px] font-mono text-text-muted">{run.id}</div>
                              <div className="text-xs text-text-secondary">{formatTimestamp(run.updatedAt)}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge tone={STATUS_TONE[runStatus(run)]}>{t(`patientMonitoring.status.${runStatus(run)}`)}</Badge>
                              {hasWorksheetBindings(run.sessionDefinitionId) && (
                                <Button size="sm" variant="secondary" onClick={() => openSession(run.id, "worksheet")}>
                                  {t("patientDetail.profile.viewWorksheet")}
                                </Button>
                              )}
                              <Button size="sm" variant="secondary" onClick={() => openSession(run.id, "audit")}>
                                {t("patientDetail.profile.openSession")}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </Card>

            <div className="min-w-0 space-y-4">
              <HomeworkPanel participantId={participantId} />

              <Card className="min-w-0">
                <SectionHeader
                  title={t("patientDetail.assessments.title")}
                  action={
                    assessmentsQuery.data && assessmentsQuery.data.length > 0 ? (
                      <Button size="sm" onClick={() => setCheckinModalOpen(true)}>{t("patientDetail.assessments.addCheckin")}</Button>
                    ) : undefined
                  }
                />
                <div className="space-y-2 p-4">
                  {assessmentsQuery.data && assessmentsQuery.data.length > 0 ? (
                    assessmentsQuery.data.slice(0, 6).map((response) => (
                      <div key={response.id} className="flex items-center justify-between gap-2 rounded-panel border border-border px-3 py-2 text-sm">
                        <span className="text-text-secondary">{formatTimestamp(response.submittedAt)} · {response.instrument === "phq9" ? "PHQ-9" : "GAD-7"}</span>
                        <span className="flex items-center gap-2">
                          {response.selfHarmFlag && <Badge tone="critical">{t("patientDetail.assessments.selfHarmFlag")}</Badge>}
                          <span className="font-semibold text-text-primary">{response.totalScore}</span>
                          <Badge tone={ASSESSMENT_SEVERITY_TONE[response.severity]}>{t(`patientCheckin.severity.${response.severity}`)}</Badge>
                        </span>
                      </div>
                    ))
                  ) : (
                    <IllustratedEmptyState
                      icon={<ClipboardList className="h-8 w-8" />}
                      title={t("patientDetail.assessments.noneYet")}
                      description={t("patientDetail.assessments.emptyDescription")}
                      action={<Button size="sm" onClick={() => setCheckinModalOpen(true)}>{t("patientDetail.assessments.addCheckin")}</Button>}
                    />
                  )}
                </div>
              </Card>

              <Card className="min-w-0">
                <SectionHeader
                  title={t("patientDetail.profile.notesHeading")}
                  action={
                    <Button size="sm" onClick={() => setNoteModalOpen(true)}>
                      {t("patientDetail.actions.addNote")}
                    </Button>
                  }
                />
                <div className="space-y-3 p-4">
                  <p className="rounded-panel border border-border bg-surface-subtle px-3 py-2 text-xs text-text-secondary">{t("patientDetail.profile.notesNotice")}</p>
                  {clinicianNotes.length === 0 ? (
                    <EmptyState title={t("patientDetail.audit.noEntries")} />
                  ) : (
                    clinicianNotes.map((note) => (
                      <div key={note.id} className="rounded-panel border border-border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[11px] text-text-muted">{formatTimestamp(note.createdAt)}</div>
                          <button
                            type="button"
                            onClick={() => setNoteToDelete({ id: note.id, content: note.content })}
                            className="shrink-0 text-[11px] font-semibold text-critical hover:underline"
                          >
                            {t("patientDetail.note.delete")}
                          </button>
                        </div>
                        <div className="mt-1 text-sm text-text-primary">{note.content}</div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>

      <Modal open={noteModalOpen} onClose={() => setNoteModalOpen(false)} title={t("patientDetail.actions.addNote")}>
        <div className="space-y-3 p-5">
          <Field label={t("patientDetail.note.label")}>
            <textarea
              className={textareaClass}
              placeholder={t("patientDetail.note.placeholder")}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNoteModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!noteDraft.trim() || addNoteMutation.isPending} onClick={() => addNoteMutation.mutate(noteDraft.trim())}>
              {t("patientDetail.note.submit")}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmActionDialog
        open={Boolean(noteToDelete)}
        onClose={() => setNoteToDelete(null)}
        onConfirm={() => noteToDelete && deleteNoteMutation.mutate(noteToDelete.id)}
        title={t("patientDetail.note.deleteConfirmTitle")}
        description={noteToDelete?.content ?? ""}
        confirmLabel={t("patientDetail.note.delete")}
        confirmDisabled={deleteNoteMutation.isPending}
      />

      <ClinicianCheckinModal
        open={checkinModalOpen}
        onClose={() => setCheckinModalOpen(false)}
        participantId={participantId}
        participantAlias={participant.alias}
        assignedClinicianUserId={participant.assignedClinician}
        participantLocale={participant.locale}
      />
    </AppShell>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  // Below 640px this stacks label above value (brief §12 -- the previous
  // unconditional horizontal row let a long ID/title push the value off the
  // right edge of a narrow viewport). At 640px and up, flex-row/items-center/
  // justify-between/gap-3 are the exact same classes this div always had, so
  // desktop/tablet render identically to before.
  return (
    <div className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="text-text-secondary">{label}</span>
      <span className="min-w-0 break-words font-semibold text-text-primary">{value}</span>
    </div>
  );
}
