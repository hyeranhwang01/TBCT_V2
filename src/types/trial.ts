// Trial operations (.claude/TASK_SCOPE.json note2026_09_28_rct_backend).
// Row shapes of sql/035-040 as the trial store returns them (camelCase).

export type ArmCode = "CLINICIAN_ONLY" | "AI_CLINICIAN" | "AI_LED";
export type DiagnosisStratum = "MDD" | "ANXIETY";
export type StudyParticipantStatus = "screening" | "ineligible" | "eligible" | "enrolled" | "allocated" | "completed" | "withdrawn";
export type ConsentType = "main" | "ai_interaction_logging" | "extended_retention";
export type VisitType = "therapist_session" | "ai_session" | "between_module" | "orientation" | "coordinator_call";
export type TimepointCode = "baseline" | "mid" | "post" | "fu3m" | "weekly" | "after_first_session";

export type ScheduleTemplateEntry = { visitType: VisitType; number: number; week: number; aiModuleNumber: number | null };

export interface Study {
  id: string;
  code: string;
  title: string;
  country: string;
  protocolVersion: string;
  status: "draft" | "active" | "closed";
  sessionsPerParticipant: number;
  completionWeeks: number;
  retentionYears: number;
  endedAt?: string | null;
  data: { phq2Threshold?: number; seriousReportHours?: number; deteriorationPoints?: number; deteriorationShare?: number };
}

export interface StudyArm { id: string; studyId: string; code: ArmCode; name: string; aiEnabled: boolean; therapistRequired: boolean; scheduleTemplate: ScheduleTemplateEntry[] }
export interface Site { id: string; studyId: string; code: string; name: string; locale: string; timezone: string; status: "active" | "paused" | "closed" }
export interface Therapist { id: string; siteId: string; authUserId?: string | null; displayName: string; status: "active" | "inactive" }

export interface StudyParticipant {
  id: string;
  studyId: string;
  siteId: string;
  runtimeParticipantId: string;
  studyCode: string;
  diagnosisStratum?: DiagnosisStratum | null;
  status: StudyParticipantStatus;
  therapistId?: string | null;
  enrolledAt?: string | null;
  allocatedAt?: string | null;
  completedAt?: string | null;
  withdrawnAt?: string | null;
  createdAt: string;
  updatedAt: string;
  data: { age?: number; gender?: string; medication?: string; previousTherapy?: boolean; [key: string]: unknown };
}

export interface Screening {
  id: string;
  studyParticipantId: string;
  screenedBy: string;
  screenedAt: string;
  criteria: Array<{ code: string; met: boolean | null; note?: string }>;
  phq9Total?: number | null;
  gad7Total?: number | null;
  cssrsRisk?: "none" | "low" | "moderate" | "high" | null;
  result: "pass" | "fail";
}

export interface EligibilityDecision { id: string; studyParticipantId: string; screeningId?: string | null; decision: "eligible" | "ineligible"; reasons: string[]; isOverride: boolean; overrideReason?: string | null; decidedBy: string; decidedAt: string }
export interface StudyConsent { id: string; studyParticipantId: string; consentType: ConsentType; version: string; aiReleaseId?: string | null; status: "granted" | "withdrawn"; method: "written" | "electronic"; documentRef?: string | null; decidedAt: string; recordedBy: string }
export interface Withdrawal { id: string; studyParticipantId: string; withdrawnAt: string; reasonCategory: "participant_choice" | "adverse_event" | "suicidality" | "lost_to_follow_up" | "investigator_decision" | "other"; reasonText?: string | null; initiatedBy: "participant" | "investigator" | "safety"; dataDisposition: "retain_collected" | "exclude_from_analysis" | "erasure_requested"; recordedBy: string }
export interface ProtocolDeviation { id: string; studyId: string; studyParticipantId?: string | null; category: string; severity: "minor" | "major"; description: string; detectedAt: string; detectedBy: string; status: "open" | "resolved"; correctiveAction?: string | null; resolvedAt?: string | null }

export interface AiRelease { id: string; studyId: string; label: string; modelId: string; promptVersions: Record<string, { version: string; sha256: string }>; memoryAlgorithmVersion: string; memoryIndexVersion: string; status: "draft" | "frozen" | "retired"; frozenAt?: string | null; createdBy: string; createdAt: string }
export interface Allocation { id: string; studyParticipantId: string; studyId: string; stratum: string; randomizationEntryId: string; armCode: ArmCode; armId: string; aiReleaseId?: string | null; allocatedBy: string; allocatedAt: string }

export interface StudyVisit {
  id: string;
  studyParticipantId: string;
  visitType: VisitType;
  number: number;
  aiModuleNumber?: number | null;
  windowStart: string;
  windowEnd: string;
  status: "scheduled" | "completed" | "missed" | "cancelled";
  completedAt?: string | null;
  runtimeSessionId?: string | null;
  therapistId?: string | null;
  attended?: boolean | null;
  durationMinutes?: number | null;
  modality?: "video" | "audio" | "in_app" | null;
  recordedBy?: string | null;
}

export interface HomeworkLog { id: string; studyParticipantId: string; week: number; minutes: number; completed: boolean; note?: string | null; loggedBy: string; loggedAt: string }

export interface AssessmentTimepoint { id: string; studyId: string; code: TimepointCode; anchor: "enrollment" | "allocation"; startDay: number; endDay: number; repeatEveryDays?: number | null; repeatCount?: number | null; instruments: Record<string, string[]> }
export interface AssessmentTask { id: string; studyParticipantId: string; timepointCode: TimepointCode; instrumentCode: string; occurrence: number; mode: "self" | "interview"; windowStart: string; windowEnd: string; status: "due" | "completed" | "missed" | "cancelled"; responseId?: string | null }
export interface AssessmentResponse { id: string; studyParticipantId: string; taskId?: string | null; instrumentCode: string; instrumentVersion: string; items: unknown[]; total?: number | null; subscales: Record<string, number>; flags: string[]; mode: "self" | "interview"; administeredBy: string; completedAt: string; inWindow: boolean; supersedesId?: string | null; correctionReason?: string | null }

export interface AdverseEvent {
  id: string;
  studyParticipantId?: string | null;
  runtimeParticipantId?: string | null;
  safetyEventId?: string | null;
  onsetAt?: string | null;
  detectedAt: string;
  description: string;
  serious: boolean;
  seriousnessCriteria: string[];
  severity: "mild" | "moderate" | "severe";
  relatedness: "not_related" | "unlikely" | "possible" | "probable" | "definite" | "not_assessed";
  expected?: boolean | null;
  actionTaken?: string | null;
  outcome: "ongoing" | "recovering" | "recovered" | "recovered_with_sequelae" | "fatal" | "unknown";
  reportDueAt?: string | null;
  reportedAt?: string | null;
  status: "open" | "closed";
  recordedBy: string;
  updatedAt: string;
}

export interface ReviewTask { id: string; studyParticipantId?: string | null; runtimeParticipantId?: string | null; source: "phq2_weekly" | "suicidality_item" | "cssrs" | "deterioration" | "safety_event"; sourceRef?: string | null; reason: string; dueAt: string; status: "open" | "done"; resolvedBy?: string | null; resolvedAt?: string | null; resolutionNote?: string | null; createdAt: string }

export type SessionGate =
  | { allowed: true; enforced: false }
  | { allowed: true; enforced: true; studyParticipantId: string; armCode: ArmCode; aiReleaseId: string; modelId: string; visitId?: string | null; warnings: string[] }
  | { allowed: false; enforced: true; reason: string };

export interface RuntimeEvent {
  id: string;
  participantId?: string | null;
  runtimeSessionId?: string | null;
  sessionNumber?: number | null;
  attemptNumber?: number | null;
  messageId?: string | null;
  turnId?: string | null;
  category: "model_call" | "validation" | "safety" | "memory" | "storage" | "authorship" | "step" | "auth" | "trial";
  severity: "info" | "warn" | "error";
  code: string;
  model?: string | null;
  promptVersion?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface SessionRecordRow { id: string; runtimeSessionId: string; participantId: string; moduleNumber?: number | null; sessionNumber?: number | null; attemptNumber?: number | null; endStatus: "completed" | "terminated"; isOfficialAtWrite: boolean; schemaVersion: string; contentSha256: string; createdAt: string; snapshot: Record<string, unknown> }
