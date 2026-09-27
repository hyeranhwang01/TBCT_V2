import type { ProtocolNodeType } from "@/types/protocol-runtime";
import type { RuntimeSessionStatus } from "@/types/runtime-session";

export type MemoryType =
  | "session_goal"
  | "treatment_goal"
  | "patient_preference"
  | "communication_preference"
  | "reported_context"
  | "activity_history"
  | "homework_assignment"
  | "homework_outcome"
  | "barrier"
  | "coping_strategy"
  | "progress_marker"
  | "clinician_note"
  | "safety_relevant"
  | "temporary_session_fact";

export type MemoryStatus =
  | "candidate"
  | "pending_review"
  | "approved"
  | "rejected"
  | "superseded"
  | "expired"
  | "revoked"
  | "deleted";

export type MemorySensitivity = "standard" | "sensitive" | "highly_sensitive" | "safety_restricted";

export type MemorySourceType =
  | "patient_statement"
  | "structured_input"
  | "runtime_context"
  | "session_summary"
  | "clinician_entry"
  | "system_derived";

export interface RuntimeParticipant {
  id: string;
  projectId: string;
  alias: string;
  locale: string;
  country?: string;
  status: "active" | "paused" | "withdrawn" | "completed" | "archived";
  runtimeSessionIds: string[];
  longitudinalRecordId: string;
  /** Supabase Auth user id that owns this participant record (see
   * sql/008_link_participants_to_auth.sql) -- absent for participants
   * created before real patient login existed (e.g. the demo participant). */
  authUserId?: string;
  /** Optional clinician-facing profile fields — not fabricated when absent, render as "—". */
  enrollmentDate?: string;
  assignedClinician?: string;
  /** Patient-controllable reminder-email opt-outs (src/app/api/cron/reminders,
   * .../homework-reminders). Absent/undefined means enabled -- these are
   * transactional-ish nudges the patient asked for by using the app, not a
   * marketing opt-in, so the default is on; this only lets a patient turn
   * a specific one off. Does NOT cover clinician-facing safety alert
   * emails, which aren't patient-controllable (a safety signal isn't the
   * patient's to silence). */
  notificationPreferences?: {
    sessionReminders?: boolean;
    homeworkReminders?: boolean;
    /** New-message-from-clinician emails (src/app/api/clinician-messages/
     * store/route.ts). Absent means enabled -- same convention as the two
     * above. Only covers messages the patient RECEIVES; a patient sending
     * a message always notifies the clinician, that's not theirs to opt
     * out of. */
    newMessages?: boolean;
  };
  consent: {
    memoryStorageAllowed: boolean;
    crossSessionUseAllowed: boolean;
    sensitiveMemoryAllowed: boolean;
    updatedAt: string;
  };
  /** The participant's own answer to the memory-consent popup
   * (src/shared/memory/memory-consent.ts). Absent = not asked yet, which the
   * runtime treats as declined. Written only through the recordMemoryConsent
   * store op, which also appends a MemoryConsentEvent. */
  memoryConsent?: MemoryConsentState;
  createdAt: string;
  updatedAt: string;
}

export type MemoryConsentDecision = "granted" | "declined";

/** Where the decision was made. */
export type MemoryConsentSource = "first_visit_dialog" | "profile" | "clinician";

export interface MemoryConsentState {
  decision: MemoryConsentDecision;
  /** MEMORY_CONSENT_TEXT_VERSION of the wording the participant saw. */
  textVersion: string;
  source: MemoryConsentSource;
  decidedAt: string;
}

/** One row of participant_consent_events (sql/025), append-only. */
export interface MemoryConsentEvent {
  id: string;
  participantId: string;
  consentKind: "memory";
  decision: MemoryConsentDecision;
  textVersion: string;
  source: MemoryConsentSource;
  /** UI locale the wording was shown in. */
  locale: string;
  decidedAt: string;
  /** Set by the store route from the authenticated caller, never by the client. */
  actorUserId?: string;
  actorRole?: "patient" | "clinician" | "admin" | "server";
  previousDecision?: MemoryConsentDecision;
}

export interface LongitudinalRecord {
  id: string;
  participantId: string;
  projectId: string;
  activeMemoryIds: string[];
  latestSummaryId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LongitudinalMemory {
  id: string;
  participantId: string;
  projectId: string;
  memoryType: MemoryType;
  title: string;
  content: string;
  structuredValue?: Record<string, unknown>;
  status: MemoryStatus;
  sensitivity: MemorySensitivity;
  sourceType: MemorySourceType;
  sourceSessionId: string;
  sourceMessageIds: string[];
  sourceNodeIds: string[];
  sourceExecutionLogIds: string[];
  isDirectlyReported: boolean;
  isSystemDerived: boolean;
  confidence?: number;
  validFrom: string;
  validUntil?: string;
  retentionPolicyId: string;
  supersedesMemoryId?: string;
  supersededByMemoryId?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface RuntimeSessionSummary {
  id: string;
  runtimeSessionId: string;
  participantId: string;
  protocolId: string;
  protocolVersion: string;
  sessionDefinitionId: string;
  sessionStatus: RuntimeSessionStatus;
  startedAt?: string;
  completedAt?: string;
  summaryStatus: "draft" | "pending_review" | "approved" | "rejected";
  goalsAddressed: string[];
  activitiesCompleted: string[];
  homeworkAssigned: string[];
  homeworkOutcomes: string[];
  patientReportedBarriers: string[];
  copingStrategies: string[];
  progressMarkers: string[];
  unresolvedItems: string[];
  safetyEvents: string[];
  nextSessionConsiderations: string[];
  memoryCandidateIds: string[];
  sourceMessageIds: string[];
  sourceExecutionLogIds: string[];
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface MemoryCandidate extends LongitudinalMemory {
  reviewNote?: string;
}

export interface MemoryReviewDecision {
  id: string;
  memoryId: string;
  participantId: string;
  action: "approve" | "reject" | "revise" | "revoke" | "delete" | "supersede";
  reason: string;
  previousValue?: string;
  newValue?: string;
  createdAt: string;
  createdBy: string;
}

export interface MemoryRetentionPolicy {
  id: string;
  name: string;
  memoryTypes: MemoryType[];
  defaultDurationDays?: number;
  requiresReview: boolean;
  autoExpire: boolean;
  allowPatientView: boolean;
  allowPatientEdit: boolean;
  allowRuntimeInjection: boolean;
  allowedNodeTypes?: ProtocolNodeType[];
  sensitivityLimit: MemorySensitivity[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRetrievalRequest {
  participantId: string;
  runtimeSessionId: string;
  protocolId: string;
  protocolVersion: string;
  sessionDefinitionId: string;
  currentNodeId: string;
  currentNodeType: ProtocolNodeType;
  currentClinicalIntent?: string;
  requestedMemoryTypes?: MemoryType[];
  maxItems: number;
}

export interface MemoryRetrievalResult {
  id: string;
  participantId: string;
  runtimeSessionId: string;
  currentNodeId: string;
  candidatesEvaluated: number;
  selectedMemoryIds: string[];
  excluded: Array<{ memoryId: string; reason: string }>;
  createdAt: string;
}

export interface MemoryUsageLog {
  id: string;
  memoryId: string;
  participantId: string;
  runtimeSessionId: string;
  nodeId: string;
  usageType: "retrieved" | "injected" | "used_for_prompt" | "used_for_branch" | "used_for_safety" | "displayed_to_clinician";
  reason: string;
  retrievalScore?: number;
  createdAt: string;
}

export interface ParticipantConsentEvent {
  id: string;
  participantId: string;
  memoryStorageAllowed: boolean;
  crossSessionUseAllowed: boolean;
  sensitiveMemoryAllowed: boolean;
  effectiveAt: string;
  reason?: string;
}

export interface GoalTrackingRecord {
  id: string;
  participantId: string;
  sourceSessionId: string;
  sourceNodeId?: string;
  title: string;
  description?: string;
  status: "active" | "paused" | "achieved" | "discontinued";
  progressNote?: string;
  createdAt: string;
  updatedAt: string;
  achievedAt?: string;
  memoryId?: string;
}

export interface HomeworkTrackingRecord {
  id: string;
  participantId: string;
  assignedSessionId: string;
  sourceNodeId: string;
  title: string;
  description: string;
  assignedAt: string;
  dueBeforeSessionDefinitionId?: string;
  status: "assigned" | "in_progress" | "completed" | "not_completed" | "cancelled";
  completedAt?: string;
  patientNote?: string;
  reviewedSessionId?: string;
  memoryId?: string;
}
