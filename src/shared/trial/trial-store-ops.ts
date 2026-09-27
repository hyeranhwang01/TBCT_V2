// Contract of the trial store (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend): sql/032-041 through one endpoint. Safe to import
// from the browser (no server-only imports). Who may run which op is decided
// by src/app/api/trial/store/route.ts; `actor` is always filled in there (or
// by the server for in-process calls), never trusted from the request.

import type { AppRole } from "@/shared/auth/roles";
import type {
  AdverseEvent, ArmCode, ConsentType, DiagnosisStratum, RuntimeEvent, ScheduleTemplateEntry, Screening, StudyParticipant, StudyVisit, Withdrawal,
} from "@/types/trial";

export type TrialActor = { userId: string; role: AppRole | "server" };

export type StudyConfigInput = {
  study: { id: string; code: string; title: string; country: string; protocolVersion: string; status: "draft" | "active" | "closed"; settings?: Record<string, number> };
  arms: Array<{ code: ArmCode; name: string; aiEnabled: boolean; therapistRequired: boolean; scheduleTemplate: ScheduleTemplateEntry[] }>;
  sites: Array<{ code: string; name: string; locale: string; timezone: string }>;
  timepoints: Array<{ code: string; anchor: "enrollment" | "allocation"; startDay: number; endDay: number; repeatEveryDays?: number; repeatCount?: number; instruments: Record<string, string[]> }>;
};

export type TrialStoreOp = { actor?: TrialActor } & (
  // Events and access log
  | { op: "recordEvents"; events: RuntimeEvent[] }
  | { op: "listEvents"; filter: { participantId?: string; runtimeSessionId?: string; code?: string; severity?: string; since?: string; limit?: number } }
  | { op: "logAccess"; entry: { action: string; resource: string; participantId?: string | null; detail?: Record<string, unknown> } }
  // Sealed session records
  | { op: "finalizeSessionRecord"; runtimeSessionId: string }
  | { op: "listSessionRecords"; participantId: string; moduleNumber?: number }
  | { op: "recordRecordDownload"; download: { participantId: string | null; moduleNumber: number | null; attempts: string; format: string; recordHashes: string[] } }
  // Study configuration
  | { op: "configureStudy"; config: StudyConfigInput }
  | { op: "getStudyContext" }
  | { op: "upsertTherapist"; therapist: { id?: string; siteId: string; displayName: string; authUserId?: string | null; status: "active" | "inactive" } }
  // Prompt and memory versions default to what is deployed now.
  | { op: "createAiRelease"; release: { label: string; modelId: string; promptVersions?: Record<string, { version: string; sha256: string }>; memoryAlgorithmVersion?: string; memoryIndexVersion?: string } }
  | { op: "freezeAiRelease"; releaseId: string }
  | { op: "retireAiRelease"; releaseId: string; reason: string }
  | { op: "uploadRandomizationList"; listVersion: string; csv: string }
  | { op: "randomizationStatus" }
  // Participants
  | { op: "listTrialParticipants" }
  | { op: "listBlindedParticipants" }
  | { op: "getTrialParticipant"; studyParticipantId: string }
  | { op: "getMyTrialStatus" }
  | { op: "listUnregisteredAccounts" }
  | { op: "registerParticipant"; participant: { runtimeParticipantId: string; siteId: string; studyCode: string; diagnosisStratum?: DiagnosisStratum | null; data?: StudyParticipant["data"] } }
  | { op: "recordScreening"; screening: Omit<Screening, "id" | "screenedBy" | "screenedAt" | "result"> & { screenedAt?: string } }
  | { op: "decideEligibility"; studyParticipantId: string; decision: "eligible" | "ineligible"; reasons: string[]; overrideReason?: string }
  | { op: "recordConsent"; consent: { studyParticipantId: string; consentType: ConsentType; version: string; status: "granted" | "withdrawn"; method: "written" | "electronic"; documentRef?: string; decidedAt?: string } }
  | { op: "setDiagnosisStratum"; studyParticipantId: string; diagnosisStratum: DiagnosisStratum }
  | { op: "enrollParticipant"; studyParticipantId: string }
  | { op: "allocateParticipant"; studyParticipantId: string }
  | { op: "assignTherapist"; studyParticipantId: string; therapistId: string }
  | { op: "withdrawParticipant"; withdrawal: Omit<Withdrawal, "id" | "recordedBy" | "withdrawnAt"> & { withdrawnAt?: string } }
  | { op: "completeParticipant"; studyParticipantId: string }
  // Sessions and visits
  | { op: "getSessionGate"; runtimeParticipantId: string; sessionDefinitionId: string; currentPromptVersions?: Record<string, { version: string; sha256: string }>; runtimeSessionId?: string; recordEvent?: boolean }
  | { op: "recordVisit"; visitId: string; patch: Pick<StudyVisit, "status"> & Partial<Pick<StudyVisit, "attended" | "durationMinutes" | "modality" | "therapistId">> }
  | { op: "logHomework"; log: { studyParticipantId?: string; week: number; minutes: number; completed: boolean; note?: string } }
  // Assessments
  | { op: "listAssessmentTasks"; studyParticipantId?: string; mine?: boolean; mode?: "self" | "interview"; status?: string }
  | { op: "submitAssessmentResponse"; response: { taskId: string; items: unknown[]; supersedesId?: string; correctionReason?: string } }
  | { op: "listAssessmentResponses"; studyParticipantId: string }
  | { op: "setInstrumentItems"; code: string; version: string; items: Record<string, string[]> }
  // Safety
  | { op: "listReviewTasks"; status?: "open" | "done" }
  | { op: "resolveReviewTask"; taskId: string; note: string }
  | { op: "createAdverseEvent"; event: Omit<AdverseEvent, "id" | "recordedBy" | "updatedAt" | "reportDueAt" | "status"> }
  | { op: "updateAdverseEvent"; id: string; patch: Partial<Omit<AdverseEvent, "id" | "recordedBy" | "detectedAt">> }
  | { op: "listAdverseEvents"; studyParticipantId?: string }
  | { op: "createDeviation"; deviation: { studyParticipantId?: string | null; category: string; severity: "minor" | "major"; description: string } }
  | { op: "resolveDeviation"; id: string; correctiveAction: string }
  | { op: "listDeviations"; studyParticipantId?: string }
  // Monitoring and lock
  | { op: "getMonitoringSummary" }
  | { op: "checkDeterioration" }
  | { op: "lockStudy"; reason: string }
);

export type TrialStoreOpName = TrialStoreOp["op"];

export const TRIAL_STORE_ENDPOINT = "/api/trial/store";
