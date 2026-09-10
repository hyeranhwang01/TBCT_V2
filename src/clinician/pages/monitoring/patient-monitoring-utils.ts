import { CANONICAL_SESSION_DEFINITIONS, CANONICAL_STAGE_NODES } from "@/lib/protocol/source-fidelity-catalog";
import type { RuntimeSession, RuntimeSessionStatus } from "@/types/runtime-session";
import type { SafetyEvent } from "@/types/safety-operations";

export type MonitoringStatus = "inProgress" | "paused" | "completed" | "notStarted" | "needsReview";

const CLOSED_SAFETY_STATUSES = new Set(["resolved", "closed", "false_positive", "cancelled"]);

/** True when a safety event is a real, still-open review signal for the participant. */
export function isOpenSafetyEvent(event: SafetyEvent): boolean {
  return !CLOSED_SAFETY_STATUSES.has(event.status);
}

/** Maps a runtime session's lifecycle status onto the clinician-facing monitoring status,
 * elevating to "needsReview" only when there is a real open safety signal. */
export function deriveMonitoringStatus(sessionStatus: RuntimeSessionStatus | undefined, hasOpenSafetyEvent: boolean): MonitoringStatus {
  if (hasOpenSafetyEvent) return "needsReview";
  if (!sessionStatus) return "notStarted";
  if (sessionStatus === "safety_paused" || sessionStatus === "escalated" || sessionStatus === "failed") return "needsReview";
  if (sessionStatus === "completed" || sessionStatus === "terminated") return "completed";
  if (sessionStatus === "paused") return "paused";
  if (sessionStatus === "created") return "notStarted";
  return "inProgress";
}

const NODE_BY_ID = new Map(CANONICAL_STAGE_NODES.map((node) => [node.id, node] as const));
const SESSION_DEFINITION_BY_ID = new Map(CANONICAL_SESSION_DEFINITIONS.map((def) => [def.id, def] as const));

/** Clinician-facing step name for a runtime node ID (never the raw node/prompt
 * ID), e.g. "Q1 - Situation" (or "Q1 - 상황" under locale "ko", falling back
 * to the English title for any node that doesn't have a titleKo yet). */
export function findStepTitle(nodeId?: string, locale?: string): string | undefined {
  if (!nodeId) return undefined;
  const node = NODE_BY_ID.get(nodeId);
  if (!node) return undefined;
  return locale === "ko" ? (node.titleKo ?? node.title) : node.title;
}

/** Clinician-facing session label, e.g. "S03 · Intrapersonal Thought Record
 * (Intra-TR)" (or "S03 · 개인 내적 사고 기록 (Intra-TR)" under locale "ko",
 * falling back to the English title for any session that doesn't have a
 * titleKo yet). */
export function findSessionTitle(sessionDefinitionId?: string, locale?: string): string | undefined {
  if (!sessionDefinitionId) return undefined;
  const definition = SESSION_DEFINITION_BY_ID.get(sessionDefinitionId);
  if (!definition) return sessionDefinitionId;
  const title = locale === "ko" ? (definition.titleKo ?? definition.title) : definition.title;
  return `S${String(definition.number).padStart(2, "0")} · ${title}`;
}

export interface ParticipantMonitoringSummary {
  participantId: string;
  currentSession?: RuntimeSession;
  sessions: RuntimeSession[];
  completedSessionCount: number;
  monitoringStatus: MonitoringStatus;
  hasOpenSafetyEvent: boolean;
  lastActivity?: string;
}

/** Picks the most relevant "current" session for a participant: the most recently
 * updated non-terminal session if one exists, otherwise the most recently updated session overall. */
export function pickCurrentSession(sessions: RuntimeSession[]): RuntimeSession | undefined {
  if (!sessions.length) return undefined;
  const sorted = [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const active = sorted.find((session) => !["completed", "terminated", "failed"].includes(session.status));
  return active ?? sorted[0];
}

/** Days between `value` and now -- no relative-time utility existed anywhere
 * in this codebase before this (confirmed by search), so this is deliberately
 * minimal (no dayjs/date-fns dependency for one calculation). Used by the
 * "needs attention" dashboard section to flag participants who've gone
 * quiet, not to render any user-facing calendar math. */
export function daysSince(value?: string): number | undefined {
  if (!value) return undefined;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return undefined;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

const SEVERITY_RANK: Record<SafetyEvent["severity"], number> = { low: 1, medium: 2, high: 3 };

/** The highest severity among a participant's still-open safety events, or
 * undefined if they have none -- `hasOpenSafetyEvent` (below) collapses this
 * to a boolean, which is enough for the plain monitoring-status badge but
 * loses exactly what a "needs attention, most urgent first" sort needs. */
export function maxOpenSeverity(safetyEvents: SafetyEvent[], participantId: string): SafetyEvent["severity"] | undefined {
  const open = safetyEvents.filter((event) => event.participantId === participantId && isOpenSafetyEvent(event));
  if (!open.length) return undefined;
  return open.reduce<SafetyEvent["severity"]>((worst, event) => (SEVERITY_RANK[event.severity] > SEVERITY_RANK[worst] ? event.severity : worst), open[0].severity);
}

export function summarizeParticipant(participantId: string, sessions: RuntimeSession[], safetyEvents: SafetyEvent[], participantUpdatedAt?: string): ParticipantMonitoringSummary {
  const ownSessions = sessions.filter((session) => session.participantId === participantId);
  const currentSession = pickCurrentSession(ownSessions);
  const completedSessionCount = ownSessions.filter((session) => session.status === "completed").length;
  const hasOpenSafetyEvent = safetyEvents.some((event) => event.participantId === participantId && isOpenSafetyEvent(event));
  const lastActivityCandidates = [participantUpdatedAt, ...ownSessions.map((session) => session.updatedAt)].filter(Boolean) as string[];
  const lastActivity = lastActivityCandidates.length ? lastActivityCandidates.sort().at(-1) : undefined;
  return {
    participantId,
    currentSession,
    sessions: ownSessions,
    completedSessionCount,
    monitoringStatus: deriveMonitoringStatus(currentSession?.status, hasOpenSafetyEvent),
    hasOpenSafetyEvent,
    lastActivity,
  };
}
