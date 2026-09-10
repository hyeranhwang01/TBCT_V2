import Dexie, { type Table } from "dexie";
import type {
  AssetRelationship,
  AssetVersion,
  ExtractedDocument,
  ExtractionJob,
  ExtractionReviewDraft,
  LocalClinicalAsset,
  ProtocolDraftCandidate,
  ReviewDecision,
  StoredFileRecord,
  StructuredTbctItem,
  SourceEvidence,
} from "@/types/clinical-assets";
import type {
  ProtocolDefinition,
  ProtocolGraphEdge,
  ProtocolGraphNode,
  ProtocolReleasePackage,
  ProtocolReleaseVersion,
  ProtocolSession,
  ProtocolValidationRun,
  RuntimeExecutionLog,
} from "@/types/protocol-runtime";
import type {
  ClinicianEscalationEvent,
  RuntimeCheckpoint,
  RuntimeMessage,
  RuntimeProviderEvent,
  RuntimeSession,
  RuntimeExecutionTrace,
  RuntimeValidationEvent,
  SessionExecutionLog,
} from "@/types/runtime-session";
import type {
  GoalTrackingRecord,
  HomeworkTrackingRecord,
  LongitudinalMemory,
  LongitudinalRecord,
  MemoryCandidate,
  MemoryRetrievalResult,
  MemoryRetentionPolicy,
  MemoryReviewDecision,
  MemoryUsageLog,
  ParticipantConsentEvent,
  RuntimeParticipant,
  RuntimeSessionSummary,
} from "@/types/longitudinal-memory";
import type { AuditEntry } from "@/types";
import type { ClinicianHandoffRecord, HumanInterventionRecord, RuntimeClinician, SafetyEvent, SafetyFollowUpTask, SafetyNotification, SafetyReport, SafetyStatusTransition, SafetyTriageRecord, SafetyTriggerSuppression, SessionResumeRequest } from "@/types/safety-operations";
import type {
  AllocationOverrideRecord,
  ClinicianSessionReview,
  ClinicianDeliveredSession,
  ConsentWithdrawalRecord,
  EligibilityDecision,
  EligibilityOverrideRecord,
  OutcomeAssessmentDefinition,
  OutcomeAssessmentSchedule,
  OutcomeAssessmentInstance,
  ParticipantAdherenceRecord,
  ParticipantProtocolAssignment,
  ParticipantScreeningRecord,
  PilotReport,
  PilotSite,
  PilotStudy,
  PilotStudyArm,
  PilotStudyParticipant,
  ProtocolDeviation,
  ProtocolAssignmentOverrideRecord,
  ResearchDataQualityIssue,
  ResearchDataSnapshot,
  ResearchExport,
  ResearchExportFile,
  ResearchSnapshotValidationRun,
  StudyArmAllocation,
  StudyConsentRecord,
  StudyEnrollment,
  StudySessionSchedule,
} from "@/types/pilot-operations";
import type { SourceFidelityBackup } from "@/shared/protocol/source-fidelity-types";

export const SOURCE_FIDELITY_BACKUP_ID = "pre-full-source-fidelity-rebuild" as const;
const LEGACY_SESSION_CATALOG_STORAGE_KEY = "tbct.session-catalog.v2";
const LEGACY_SESSION_CATALOG_BACKUP_STORAGE_KEY = `tbct.source-fidelity-backup.${SOURCE_FIDELITY_BACKUP_ID}`;

export type SourceFidelityMigrationBackup = Omit<SourceFidelityBackup, "releases"> & {
  schemaVersion: "source-fidelity-backup/v1";
  protocolDefinitions: ProtocolDefinition[];
  protocolSessions: ProtocolSession[];
  releases: ProtocolReleaseVersion[];
  legacyCatalog: unknown | null;
  runtimeExecutionReferences: Array<Pick<RuntimeExecutionLog, "id" | "protocolId" | "sessionId" | "startedAt" | "steps">>;
};

export class TbctLocalDatabase extends Dexie {
  clinicalAssets!: Table<LocalClinicalAsset, string>;
  storedFiles!: Table<StoredFileRecord, string>;
  extractedDocuments!: Table<ExtractedDocument, string>;
  extractionJobs!: Table<ExtractionJob, string>;
  assetVersions!: Table<AssetVersion, string>;
  auditEntries!: Table<AuditEntry, string>;
  reviewDrafts!: Table<ExtractionReviewDraft, string>;
  relationships!: Table<AssetRelationship, string>;
  structuredTbctItems!: Table<StructuredTbctItem, string>;
  sourceEvidence!: Table<SourceEvidence, string>;
  reviewDecisions!: Table<ReviewDecision, string>;
  protocolDraftCandidates!: Table<ProtocolDraftCandidate, string>;
  protocolDefinitions!: Table<ProtocolDefinition, string>;
  protocolSessions!: Table<ProtocolSession, string>;
  protocolGraphNodes!: Table<ProtocolGraphNode, string>;
  protocolGraphEdges!: Table<ProtocolGraphEdge, string>;
  protocolValidationRuns!: Table<ProtocolValidationRun, string>;
  protocolReleasePackages!: Table<ProtocolReleasePackage, string>;
  protocolReleaseVersions!: Table<ProtocolReleaseVersion, string>;
  runtimeExecutionLogs!: Table<RuntimeExecutionLog, string>;
  // NOTE: runtimeSessions..runtimeExecutionTraces below are no longer written
  // to. The runtime conversation store (patient <-> assistant sessions,
  // messages, logs, checkpoints, escalations, provider/validation events,
  // execution traces) moved to Neon Postgres -- see
  // src/shared/data/repositories/runtime-session-repository.ts and
  // src/shared/data/server/runtime-session-store.ts. The table/index declarations and
  // migration versions below are kept only because captureSourceFidelityBackup()
  // still reads pre-existing rows out of runtimeSessions/runtimeExecutionLogs
  // for its one-time legacy backup snapshot; removing them would break that
  // for any browser profile that hasn't captured the backup yet.
  runtimeSessions!: Table<RuntimeSession, string>;
  runtimeMessages!: Table<RuntimeMessage, string>;
  runtimeSessionLogs!: Table<SessionExecutionLog, string>;
  runtimeEscalations!: Table<ClinicianEscalationEvent, string>;
  runtimeCheckpoints!: Table<RuntimeCheckpoint, string>;
  runtimeProviderEvents!: Table<RuntimeProviderEvent, string>;
  runtimeValidationEvents!: Table<RuntimeValidationEvent, string>;
  runtimeExecutionTraces!: Table<RuntimeExecutionTrace, string>;
  runtimeParticipants!: Table<RuntimeParticipant, string>;
  longitudinalRecords!: Table<LongitudinalRecord, string>;
  longitudinalMemories!: Table<LongitudinalMemory, string>;
  runtimeSessionSummaries!: Table<RuntimeSessionSummary, string>;
  memoryCandidates!: Table<MemoryCandidate, string>;
  memoryReviewDecisions!: Table<MemoryReviewDecision, string>;
  memoryRetrievalRuns!: Table<MemoryRetrievalResult, string>;
  memoryUsageLogs!: Table<MemoryUsageLog, string>;
  memoryRetentionPolicies!: Table<MemoryRetentionPolicy, string>;
  participantConsentEvents!: Table<ParticipantConsentEvent, string>;
  goalTrackingRecords!: Table<GoalTrackingRecord, string>;
  homeworkTrackingRecords!: Table<HomeworkTrackingRecord, string>;
  safetyEvents!: Table<SafetyEvent, string>;
  safetyTriageRecords!: Table<SafetyTriageRecord, string>;
  humanInterventionRecords!: Table<HumanInterventionRecord, string>;
  safetyFollowUpTasks!: Table<SafetyFollowUpTask, string>;
  runtimeClinicians!: Table<RuntimeClinician, string>;
  safetyStatusTransitions!: Table<SafetyStatusTransition, string>;
  safetyNotifications!: Table<SafetyNotification, string>;
  safetyReports!: Table<SafetyReport, string>;
  clinicianHandoffRecords!: Table<ClinicianHandoffRecord, string>;
  sessionResumeRequests!: Table<SessionResumeRequest, string>;
  safetyTriggerSuppressions!: Table<SafetyTriggerSuppression, string>;
  pilotStudies!: Table<PilotStudy, string>;
  pilotStudyArms!: Table<PilotStudyArm, string>;
  pilotSites!: Table<PilotSite, string>;
  pilotStudyParticipants!: Table<PilotStudyParticipant, string>;
  participantScreeningRecords!: Table<ParticipantScreeningRecord, string>;
  eligibilityDecisions!: Table<EligibilityDecision, string>;
  eligibilityOverrideRecords!: Table<EligibilityOverrideRecord, string>;
  studyConsentRecords!: Table<StudyConsentRecord, string>;
  consentWithdrawalRecords!: Table<ConsentWithdrawalRecord, string>;
  studyEnrollments!: Table<StudyEnrollment, string>;
  studyArmAllocations!: Table<StudyArmAllocation, string>;
  allocationOverrideRecords!: Table<AllocationOverrideRecord, string>;
  participantProtocolAssignments!: Table<ParticipantProtocolAssignment, string>;
  protocolAssignmentOverrideRecords!: Table<ProtocolAssignmentOverrideRecord, string>;
  clinicianDeliveredSessions!: Table<ClinicianDeliveredSession, string>;
  clinicianSessionReviews!: Table<ClinicianSessionReview, string>;
  studySessionSchedules!: Table<StudySessionSchedule, string>;
  participantAdherenceRecords!: Table<ParticipantAdherenceRecord, string>;
  protocolDeviations!: Table<ProtocolDeviation, string>;
  outcomeAssessmentDefinitions!: Table<OutcomeAssessmentDefinition, string>;
  outcomeAssessmentSchedules!: Table<OutcomeAssessmentSchedule, string>;
  outcomeAssessmentInstances!: Table<OutcomeAssessmentInstance, string>;
  researchDataQualityIssues!: Table<ResearchDataQualityIssue, string>;
  researchDataSnapshots!: Table<ResearchDataSnapshot, string>;
  researchSnapshotValidationRuns!: Table<ResearchSnapshotValidationRun, string>;
  researchExports!: Table<ResearchExport, string>;
  researchExportFiles!: Table<ResearchExportFile, string>;
  pilotReports!: Table<PilotReport, string>;
  sourceFidelityBackups!: Table<SourceFidelityMigrationBackup, string>;

  constructor() {
    super("tbct-protocol-studio");
    this.version(1).stores({
      clinicalAssets: "id, projectId, title, checksumSha256, assetType, status, extractionStatus, updatedAt, createdAt",
      storedFiles: "assetId",
      extractedDocuments: "id, assetId, extractedAt",
      extractionJobs: "id, assetId, status, createdAt",
      assetVersions: "id, assetId, version, createdAt",
      auditEntries: "id, timestamp, action, resource, version",
      reviewDrafts: "id, assetId, createdAt",
      relationships: "[sourceAssetId+targetAssetId], sourceAssetId, targetAssetId, relation",
    });

    this.version(2)
      .stores({
        clinicalAssets: "id, projectId, title, checksumSha256, assetType, status, extractionStatus, currentVersionId, updatedAt, createdAt",
        storedFiles: "id, assetId, versionId",
        extractedDocuments: "id, assetId, assetVersionId, extractedAt",
        extractionJobs: "id, assetId, assetVersionId, status, createdAt",
        assetVersions: "id, assetId, version, isCurrent, createdAt",
        auditEntries: "id, timestamp, action, resource, version",
        reviewDrafts: "id, projectId, createdAt, status",
        relationships: "id, projectId, sourceAssetId, targetAssetId, relationType, createdAt",
        structuredTbctItems: "id, draftId, mappingType, status, updatedAt",
        sourceEvidence: "id, assetId, extractedDocumentId, blockId",
        reviewDecisions: "id, draftId, structuredItemId, decision, createdAt",
        protocolDraftCandidates: "id, sourceDraftId, sessionId, createdAt",
        protocolDefinitions: "id, projectId, status, currentVersion, updatedAt",
        protocolSessions: "id, protocolId, status, order, updatedAt",
        protocolGraphNodes: "id, protocolId, sessionId, type",
        protocolGraphEdges: "id, protocolId, sessionId, source, target",
        protocolValidationRuns: "id, protocolId, executedAt",
        protocolReleasePackages: "id, protocolId, protocolVersion, generatedAt",
        protocolReleaseVersions: "id, protocolId, version, publishedAt",
        runtimeExecutionLogs: "id, protocolId, sessionId, startedAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table("assetVersions")
          .toCollection()
          .modify((version: Partial<AssetVersion>) => {
            version.mimeType ??= "application/octet-stream";
            version.extractionStatus ??= "not_started";
            version.isCurrent ??= true;
          });

        await tx
          .table("reviewDrafts")
          .toCollection()
          .modify((draft: Partial<ExtractionReviewDraft> & { assetId?: string }) => {
            const assetId = draft.assetIds?.[0] ?? draft.assetId;
            draft.projectId ??= "TBCT-BR-001";
            draft.assetIds ??= assetId ? [assetId] : [];
            draft.title ??= "Extraction review draft";
            draft.status ??= "unstructured";
            draft.sourceEvidence ??= [];
            draft.structuredItems ??= [];
            draft.updatedAt ??= draft.createdAt ?? new Date().toISOString();
            delete draft.assetId;
          });

        const protocolDefinitions = tx.table("protocolDefinitions");
        const existingProtocol = await protocolDefinitions.get("TBCT-BR-001");
        if (!existingProtocol) {
          const now = new Date().toISOString();
          await protocolDefinitions.put({
            id: "TBCT-BR-001",
            projectId: "TBCT-BR-001",
            title: "TBCT Brazil Pilot Protocol",
            locale: "pt-BR",
            country: "BR",
            currentVersion: "0.4.0",
            status: "draft",
            sessionIds: ["SESSION-03"],
            globalSafetyRuleIds: [],
            runtimeSchemaVersion: "1.0",
            createdAt: now,
            updatedAt: now,
          });
          await tx.table("protocolSessions").put({
            id: "SESSION-03",
            protocolId: "TBCT-BR-001",
            title: "Session 03",
            order: 3,
            goals: [],
            completionNodeIds: [],
            nodeIds: [],
            edgeIds: [],
            status: "draft",
            locale: "pt-BR",
            createdAt: now,
            updatedAt: now,
          });
        }
      });

    this.version(3)
      .stores({
        clinicalAssets: "id, projectId, title, checksumSha256, assetType, status, extractionStatus, currentVersionId, updatedAt, createdAt",
        storedFiles: "id, assetId, versionId",
        extractedDocuments: "id, assetId, assetVersionId, extractedAt",
        extractionJobs: "id, assetId, assetVersionId, status, createdAt",
        assetVersions: "id, assetId, version, isCurrent, createdAt",
        auditEntries: "id, timestamp, action, resource, version",
        reviewDrafts: "id, projectId, createdAt, status",
        relationships: "id, projectId, sourceAssetId, targetAssetId, relationType, createdAt",
        structuredTbctItems: "id, draftId, mappingType, status, updatedAt",
        sourceEvidence: "id, assetId, extractedDocumentId, blockId",
        reviewDecisions: "id, draftId, structuredItemId, decision, createdAt",
        protocolDraftCandidates: "id, sourceDraftId, sessionId, createdAt",
        protocolDefinitions: "id, projectId, status, currentVersion, updatedAt",
        protocolSessions: "id, protocolId, status, order, updatedAt",
        protocolGraphNodes: "id, protocolId, sessionId, type",
        protocolGraphEdges: "id, protocolId, sessionId, source, target",
        protocolValidationRuns: "id, protocolId, executedAt",
        protocolReleasePackages: "id, protocolId, protocolVersion, generatedAt",
        protocolReleaseVersions: "id, protocolId, version, publishedAt",
        runtimeExecutionLogs: "id, protocolId, sessionId, startedAt",
        runtimeSessions: "id, protocolId, releaseId, status, updatedAt, createdAt",
        runtimeMessages: "id, runtimeSessionId, role, createdAt, deliveredAt",
        runtimeSessionLogs: "id, runtimeSessionId, stage, status, timestamp",
        runtimeEscalations: "id, runtimeSessionId, protocolId, status, createdAt",
        runtimeCheckpoints: "id, runtimeSessionId, sequence, createdAt",
        runtimeProviderEvents: "id, runtimeSessionId, provider, createdAt",
        runtimeValidationEvents: "id, runtimeSessionId, createdAt",
      })
      .upgrade(async (tx) => {
        const releaseTable = tx.table("protocolReleaseVersions");
        const existingRelease = await releaseTable.where("protocolId").equals("TBCT-BR-001").first();
        if (!existingRelease) {
          const now = new Date().toISOString();
          const demoNodes: ProtocolGraphNode[] = [
            {
              id: "RT-NODE-START",
              protocolId: "TBCT-BR-001",
              sessionId: "SESSION-03",
              type: "session_start",
              position: { x: 100, y: 120 },
              data: {
                protocolNodeId: "S03-START-001",
                protocolId: "TBCT-BR-001",
                sessionId: "SESSION-03",
                nodeType: "session_start",
                title: "Session Start",
                clinicalIntent: "Begin the demo session.",
                content: "Hello. We will run today's session together.",
                required: true,
                status: "published",
                sourceStructuredItemIds: [],
                sourceEvidenceIds: [],
                safetyRuleIds: [],
                completionConditionIds: [],
                runtimeAction: { actionType: "send_message", payload: { text: "Hello. We will run today's session together." } },
                metadata: { createdBy: "System", createdAt: now, updatedBy: "System", updatedAt: now },
              },
            },
            {
              id: "RT-NODE-ORIENTATION",
              protocolId: "TBCT-BR-001",
              sessionId: "SESSION-03",
              type: "orientation",
              position: { x: 340, y: 120 },
              data: {
                protocolNodeId: "S03-ORG-001",
                protocolId: "TBCT-BR-001",
                sessionId: "SESSION-03",
                nodeType: "orientation",
                title: "Orientation",
                clinicalIntent: "Prepare the participant.",
                content: "Take a moment to reflect on your current state, and start when you are ready.",
                required: true,
                status: "published",
                sourceStructuredItemIds: [],
                sourceEvidenceIds: [],
                safetyRuleIds: [],
                completionConditionIds: [],
                runtimeAction: { actionType: "send_message", payload: { text: "Take a moment to reflect on your current state, and start when you are ready." } },
                metadata: { createdBy: "System", createdAt: now, updatedBy: "System", updatedAt: now },
              },
            },
            {
              id: "RT-NODE-QUESTION",
              protocolId: "TBCT-BR-001",
              sessionId: "SESSION-03",
              type: "question",
              position: { x: 580, y: 120 },
              data: {
                protocolNodeId: "S03-Q-001",
                protocolId: "TBCT-BR-001",
                sessionId: "SESSION-03",
                nodeType: "question",
                title: "Basic Question",
                clinicalIntent: "Collect a short patient response.",
                content: "Were there any activities from the previous plan that you actually tried?",
                required: true,
                status: "published",
                sourceStructuredItemIds: [],
                sourceEvidenceIds: [],
                safetyRuleIds: ["GLOBAL-RISK-01"],
                completionConditionIds: [],
                runtimeAction: { actionType: "ask_question", payload: { inputKind: "text", responseField: "activity_report", placeholder: "Please enter a short response." } },
                metadata: { createdBy: "System", createdAt: now, updatedBy: "System", updatedAt: now },
              },
            },
            {
              id: "RT-NODE-ACTIVITY",
              protocolId: "TBCT-BR-001",
              sessionId: "SESSION-03",
              type: "activity",
              position: { x: 820, y: 40 },
              data: {
                protocolNodeId: "S03-ACT-001",
                protocolId: "TBCT-BR-001",
                sessionId: "SESSION-03",
                nodeType: "activity",
                title: "Activity",
                clinicalIntent: "Run a simple reflection activity.",
                content: "This time, let's choose one small action that feels easiest to carry out.",
                required: true,
                status: "published",
                sourceStructuredItemIds: [],
                sourceEvidenceIds: [],
                safetyRuleIds: [],
                completionConditionIds: [],
                runtimeAction: { actionType: "start_activity", payload: { inputKind: "single_choice", choices: ["5-minute walk", "Quick tidy-up", "3 deep breaths"], responseField: "selected_activity" } },
                metadata: { createdBy: "System", createdAt: now, updatedBy: "System", updatedAt: now },
              },
            },
            {
              id: "RT-NODE-HOMEWORK",
              protocolId: "TBCT-BR-001",
              sessionId: "SESSION-03",
              type: "homework",
              position: { x: 1060, y: 40 },
              data: {
                protocolNodeId: "S03-HW-001",
                protocolId: "TBCT-BR-001",
                sessionId: "SESSION-03",
                nodeType: "homework",
                title: "Homework",
                clinicalIntent: "Assign homework.",
                content: "Please try the selected action once before the next session.",
                required: true,
                status: "published",
                sourceStructuredItemIds: [],
                sourceEvidenceIds: [],
                safetyRuleIds: [],
                completionConditionIds: [],
                runtimeAction: { actionType: "assign_homework", payload: { inputKind: "boolean", responseField: "homework_commitment", label: "I confirmed my plan for the next attempt" } },
                metadata: { createdBy: "System", createdAt: now, updatedBy: "System", updatedAt: now },
              },
            },
            {
              id: "RT-NODE-SAFETY",
              protocolId: "TBCT-BR-001",
              sessionId: "SESSION-03",
              type: "safety_check",
              position: { x: 820, y: 220 },
              data: {
                protocolNodeId: "S03-SAFE-001",
                protocolId: "TBCT-BR-001",
                sessionId: "SESSION-03",
                nodeType: "safety_check",
                title: "Safety Check",
                clinicalIntent: "Safety branch",
                content: "We will pause the regular conversation and check your safety status now.",
                required: true,
                status: "published",
                sourceStructuredItemIds: [],
                sourceEvidenceIds: [],
                safetyRuleIds: ["GLOBAL-RISK-01"],
                completionConditionIds: [],
                runtimeAction: { actionType: "run_safety_check", payload: { fixedResponse: "Let's pause for a moment and prioritize checking your safety status first." } },
                metadata: { createdBy: "System", createdAt: now, updatedBy: "System", updatedAt: now },
              },
            },
            {
              id: "RT-NODE-ESC",
              protocolId: "TBCT-BR-001",
              sessionId: "SESSION-03",
              type: "clinician_escalation",
              position: { x: 1060, y: 220 },
              data: {
                protocolNodeId: "S03-ESC-001",
                protocolId: "TBCT-BR-001",
                sessionId: "SESSION-03",
                nodeType: "clinician_escalation",
                title: "Clinician Escalation",
                clinicalIntent: "Pause session and escalate.",
                content: "A review from the assigned clinician is required.",
                required: true,
                status: "published",
                sourceStructuredItemIds: [],
                sourceEvidenceIds: [],
                safetyRuleIds: ["GLOBAL-RISK-01"],
                completionConditionIds: [],
                runtimeAction: { actionType: "escalate_clinician", payload: { fixedResponse: "The session will be paused until the assigned clinician has reviewed it." } },
                metadata: { createdBy: "System", createdAt: now, updatedBy: "System", updatedAt: now },
              },
            },
            {
              id: "RT-NODE-COMPLETE",
              protocolId: "TBCT-BR-001",
              sessionId: "SESSION-03",
              type: "session_complete",
              position: { x: 1300, y: 40 },
              data: {
                protocolNodeId: "S03-END-001",
                protocolId: "TBCT-BR-001",
                sessionId: "SESSION-03",
                nodeType: "session_complete",
                title: "Session Complete",
                clinicalIntent: "Finish the session.",
                content: "We will end today's session here. Thank you for your effort.",
                required: true,
                status: "published",
                sourceStructuredItemIds: [],
                sourceEvidenceIds: [],
                safetyRuleIds: [],
                completionConditionIds: [],
                runtimeAction: { actionType: "complete_session", payload: { text: "We will end today's session here. Thank you for your effort." } },
                metadata: { createdBy: "System", createdAt: now, updatedBy: "System", updatedAt: now },
              },
            },
          ];
          const demoEdges: ProtocolGraphEdge[] = [
            { id: "RT-EDGE-1", protocolId: "TBCT-BR-001", sessionId: "SESSION-03", source: "RT-NODE-START", target: "RT-NODE-ORIENTATION", edgeType: "default", priority: 1, isFallback: false, sourceEvidenceIds: [], createdAt: now, updatedAt: now },
            { id: "RT-EDGE-2", protocolId: "TBCT-BR-001", sessionId: "SESSION-03", source: "RT-NODE-ORIENTATION", target: "RT-NODE-QUESTION", edgeType: "default", priority: 1, isFallback: false, sourceEvidenceIds: [], createdAt: now, updatedAt: now },
            { id: "RT-EDGE-3", protocolId: "TBCT-BR-001", sessionId: "SESSION-03", source: "RT-NODE-QUESTION", target: "RT-NODE-SAFETY", edgeType: "conditional", label: "high-risk", condition: { id: "COND-HIGH", field: "riskLevel", operator: "equals", value: "high" }, priority: 1, isFallback: false, sourceEvidenceIds: [], createdAt: now, updatedAt: now },
            { id: "RT-EDGE-4", protocolId: "TBCT-BR-001", sessionId: "SESSION-03", source: "RT-NODE-QUESTION", target: "RT-NODE-ACTIVITY", edgeType: "default", priority: 2, isFallback: true, sourceEvidenceIds: [], createdAt: now, updatedAt: now },
            { id: "RT-EDGE-5", protocolId: "TBCT-BR-001", sessionId: "SESSION-03", source: "RT-NODE-ACTIVITY", target: "RT-NODE-HOMEWORK", edgeType: "default", priority: 1, isFallback: false, sourceEvidenceIds: [], createdAt: now, updatedAt: now },
            { id: "RT-EDGE-6", protocolId: "TBCT-BR-001", sessionId: "SESSION-03", source: "RT-NODE-HOMEWORK", target: "RT-NODE-COMPLETE", edgeType: "default", priority: 1, isFallback: false, sourceEvidenceIds: [], createdAt: now, updatedAt: now },
            { id: "RT-EDGE-7", protocolId: "TBCT-BR-001", sessionId: "SESSION-03", source: "RT-NODE-SAFETY", target: "RT-NODE-ESC", edgeType: "safety", priority: 1, isFallback: false, sourceEvidenceIds: [], createdAt: now, updatedAt: now },
          ];
          await tx.table("protocolGraphNodes").bulkPut(demoNodes);
          await tx.table("protocolGraphEdges").bulkPut(demoEdges);
          await tx.table("protocolSessions").put({
            id: "SESSION-03",
            protocolId: "TBCT-BR-001",
            title: "Session 03",
            order: 3,
            goals: ["demo runtime session"],
            entryNodeId: "RT-NODE-START",
            completionNodeIds: ["RT-NODE-COMPLETE"],
            nodeIds: demoNodes.map((node) => node.id),
            edgeIds: demoEdges.map((edge) => edge.id),
            status: "published",
            locale: "ko-KR",
            createdAt: now,
            updatedAt: now,
          });
          await tx.table("protocolDefinitions").put({
            id: "TBCT-BR-001",
            projectId: "TBCT-BR-001",
            title: "TBCT Brazil Pilot Protocol",
            locale: "ko-KR",
            country: "BR",
            currentVersion: "1.0.0",
            status: "published",
            sessionIds: ["SESSION-03"],
            globalSafetyRuleIds: ["GLOBAL-RISK-01"],
            runtimeSchemaVersion: "1.0",
            createdAt: now,
            updatedAt: now,
          });
          await tx.table("protocolReleasePackages").put({
            id: "REL-PKG-DEMO-1",
            protocolId: "TBCT-BR-001",
            protocolVersion: "1.0.0",
            targetEnvironment: "pilot",
            packageChecksum: "demo-checksum",
            files: { "protocol.json": "demo" },
            generatedAt: now,
            generatedBy: "System",
          });
          await tx.table("protocolReleaseVersions").put({
            id: "REL-DEMO-1",
            protocolId: "TBCT-BR-001",
            version: "1.0.0",
            releasePackageId: "REL-PKG-DEMO-1",
            publishedAt: now,
            publishedBy: "System",
            changeSummary: "Seed demo runtime release",
            immutableSnapshot: { nodes: demoNodes, edges: demoEdges },
          });
        }
      });

    this.version(4)
      .stores({
        clinicalAssets: "id, projectId, title, checksumSha256, assetType, status, extractionStatus, currentVersionId, updatedAt, createdAt",
        storedFiles: "id, assetId, versionId",
        extractedDocuments: "id, assetId, assetVersionId, extractedAt",
        extractionJobs: "id, assetId, assetVersionId, status, createdAt",
        assetVersions: "id, assetId, version, isCurrent, createdAt",
        auditEntries: "id, timestamp, action, resource, version",
        reviewDrafts: "id, projectId, createdAt, status",
        relationships: "id, projectId, sourceAssetId, targetAssetId, relationType, createdAt",
        structuredTbctItems: "id, draftId, mappingType, status, updatedAt",
        sourceEvidence: "id, assetId, extractedDocumentId, blockId",
        reviewDecisions: "id, draftId, structuredItemId, decision, createdAt",
        protocolDraftCandidates: "id, sourceDraftId, sessionId, createdAt",
        protocolDefinitions: "id, projectId, status, currentVersion, updatedAt",
        protocolSessions: "id, protocolId, status, order, updatedAt",
        protocolGraphNodes: "id, protocolId, sessionId, type",
        protocolGraphEdges: "id, protocolId, sessionId, source, target",
        protocolValidationRuns: "id, protocolId, executedAt",
        protocolReleasePackages: "id, protocolId, protocolVersion, generatedAt",
        protocolReleaseVersions: "id, protocolId, version, publishedAt",
        runtimeExecutionLogs: "id, protocolId, sessionId, startedAt",
        runtimeSessions: "id, participantId, protocolId, releaseId, status, updatedAt, createdAt",
        runtimeMessages: "id, runtimeSessionId, role, createdAt, deliveredAt",
        runtimeSessionLogs: "id, runtimeSessionId, stage, status, timestamp",
        runtimeEscalations: "id, runtimeSessionId, protocolId, status, createdAt",
        runtimeCheckpoints: "id, runtimeSessionId, sequence, createdAt",
        runtimeProviderEvents: "id, runtimeSessionId, provider, createdAt",
        runtimeValidationEvents: "id, runtimeSessionId, createdAt",
        runtimeParticipants: "id, projectId, alias, status, updatedAt",
        longitudinalRecords: "id, participantId, updatedAt",
        longitudinalMemories: "id, participantId, memoryType, status, validUntil, updatedAt",
        runtimeSessionSummaries: "id, runtimeSessionId, participantId, summaryStatus, updatedAt",
        memoryCandidates: "id, participantId, memoryType, status, validUntil, updatedAt",
        memoryReviewDecisions: "id, memoryId, participantId, createdAt",
        memoryRetrievalRuns: "id, participantId, runtimeSessionId, createdAt",
        memoryUsageLogs: "id, memoryId, participantId, runtimeSessionId, createdAt",
        memoryRetentionPolicies: "id, name, updatedAt",
        participantConsentEvents: "id, participantId, effectiveAt",
        goalTrackingRecords: "id, participantId, status, updatedAt",
        homeworkTrackingRecords: "id, participantId, status, assignedAt",
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        const participantId = "PARTICIPANT-DEMO-01";
        const recordId = "LREC-DEMO-01";
        const participantTable = tx.table("runtimeParticipants");
        const existingParticipant = await participantTable.get(participantId);
        if (!existingParticipant) {
          await participantTable.put({
            id: participantId,
            projectId: "TBCT-BR-001",
            alias: "Demo Participant 01",
            locale: "ko-KR",
            country: "KR",
            status: "active",
            runtimeSessionIds: [],
            longitudinalRecordId: recordId,
            consent: {
              memoryStorageAllowed: true,
              crossSessionUseAllowed: true,
              sensitiveMemoryAllowed: false,
              updatedAt: now,
            },
            createdAt: now,
            updatedAt: now,
          });
        }
        await tx.table("longitudinalRecords").put({
          id: recordId,
          participantId,
          projectId: "TBCT-BR-001",
          activeMemoryIds: [],
          createdAt: now,
          updatedAt: now,
        });
        const sessions = await tx.table("runtimeSessions").toArray();
        for (const session of sessions) {
          await tx.table("runtimeSessions").put({
            ...session,
            participantId: (session as RuntimeSession).participantId ?? participantId,
            runtimeContext: {
              ...session.runtimeContext,
              longitudinalMemory: session.runtimeContext.longitudinalMemory ?? {
                treatmentGoals: [],
                patientPreferences: [],
                activeHomework: [],
                relevantBarriers: [],
                copingStrategies: [],
              },
            },
          });
        }
        const sessionIds = sessions.map((session) => session.id);
        await participantTable.put({
          id: participantId,
          projectId: "TBCT-BR-001",
          alias: "Demo Participant 01",
          locale: "ko-KR",
          country: "KR",
          status: "active",
          runtimeSessionIds: sessionIds,
          longitudinalRecordId: recordId,
          consent: {
            memoryStorageAllowed: true,
            crossSessionUseAllowed: true,
            sensitiveMemoryAllowed: false,
            updatedAt: now,
          },
          createdAt: now,
          updatedAt: now,
        });
        const policyTable = tx.table("memoryRetentionPolicies");
        const existingPolicies = await policyTable.toArray();
        if (!existingPolicies.length) {
          const policies: MemoryRetentionPolicy[] = [
            { id: "RET-TEMP", name: "Temporary Session Facts", memoryTypes: ["temporary_session_fact"], defaultDurationDays: 7, requiresReview: false, autoExpire: true, allowPatientView: false, allowPatientEdit: false, allowRuntimeInjection: true, sensitivityLimit: ["standard"], createdAt: now, updatedAt: now },
            { id: "RET-HW-ASG", name: "Homework Assignment", memoryTypes: ["homework_assignment"], requiresReview: false, autoExpire: false, allowPatientView: true, allowPatientEdit: true, allowRuntimeInjection: true, sensitivityLimit: ["standard", "sensitive"], createdAt: now, updatedAt: now },
            { id: "RET-HW-OUT", name: "Homework Outcome", memoryTypes: ["homework_outcome", "activity_history", "barrier"], defaultDurationDays: 90, requiresReview: false, autoExpire: true, allowPatientView: true, allowPatientEdit: true, allowRuntimeInjection: true, sensitivityLimit: ["standard", "sensitive"], createdAt: now, updatedAt: now },
            { id: "RET-PREF", name: "Preferences", memoryTypes: ["patient_preference", "communication_preference"], requiresReview: false, autoExpire: false, allowPatientView: true, allowPatientEdit: true, allowRuntimeInjection: true, sensitivityLimit: ["standard", "sensitive"], createdAt: now, updatedAt: now },
            { id: "RET-GOAL", name: "Goals", memoryTypes: ["session_goal", "treatment_goal", "coping_strategy", "progress_marker"], defaultDurationDays: 180, requiresReview: false, autoExpire: false, allowPatientView: true, allowPatientEdit: true, allowRuntimeInjection: true, sensitivityLimit: ["standard", "sensitive"], createdAt: now, updatedAt: now },
            { id: "RET-SAFE", name: "Safety Restricted", memoryTypes: ["safety_relevant", "clinician_note"], requiresReview: true, autoExpire: false, allowPatientView: false, allowPatientEdit: false, allowRuntimeInjection: false, sensitivityLimit: ["safety_restricted", "highly_sensitive"], createdAt: now, updatedAt: now },
          ];
          await policyTable.bulkPut(policies);
        }
      });

    this.version(5)
      .stores({
        clinicalAssets: "id",
        storedFiles: "id, assetId, versionId",
        extractedDocuments: "id, assetId, assetVersionId, extractedAt",
        extractionJobs: "id, assetId, assetVersionId, status, createdAt",
        assetVersions: "id, assetId, version, isCurrent, createdAt",
        auditEntries: "id, timestamp, action, resource, version",
        reviewDrafts: "id, projectId, createdAt, status",
        relationships: "id, projectId, sourceAssetId, targetAssetId, relationType, createdAt",
        structuredTbctItems: "id, draftId, mappingType, status, updatedAt",
        sourceEvidence: "id, assetId, extractedDocumentId, blockId",
        reviewDecisions: "id, draftId, structuredItemId, decision, createdAt",
        protocolDraftCandidates: "id, sourceDraftId, sessionId, createdAt",
        protocolDefinitions: "id, projectId, status, currentVersion, updatedAt",
        protocolSessions: "id, protocolId, status, order, updatedAt",
        protocolGraphNodes: "id, protocolId, sessionId, type",
        protocolGraphEdges: "id, protocolId, sessionId, source, target",
        protocolValidationRuns: "id, protocolId, executedAt",
        protocolReleasePackages: "id, protocolId, protocolVersion, generatedAt",
        protocolReleaseVersions: "id, protocolId, version, publishedAt",
        runtimeExecutionLogs: "id, protocolId, sessionId, startedAt",
        runtimeSessions: "id, participantId, protocolId, releaseId, status, updatedAt, createdAt",
        runtimeMessages: "id, runtimeSessionId, role, createdAt, deliveredAt",
        runtimeSessionLogs: "id, runtimeSessionId, stage, status, timestamp",
        runtimeEscalations: "id, runtimeSessionId, protocolId, status, createdAt",
        runtimeCheckpoints: "id, runtimeSessionId, sequence, createdAt",
        runtimeProviderEvents: "id, runtimeSessionId, provider, createdAt",
        runtimeValidationEvents: "id, runtimeSessionId, createdAt",
        runtimeParticipants: "id, projectId, alias, status, updatedAt",
        longitudinalRecords: "id, participantId, updatedAt",
        longitudinalMemories: "id, participantId, memoryType, status, validUntil, updatedAt",
        runtimeSessionSummaries: "id, runtimeSessionId, participantId, summaryStatus, updatedAt",
        memoryCandidates: "id, participantId, memoryType, status, validUntil, updatedAt",
        memoryReviewDecisions: "id, memoryId, participantId, createdAt",
        memoryRetrievalRuns: "id, participantId, runtimeSessionId, createdAt",
        memoryUsageLogs: "id, memoryId, participantId, runtimeSessionId, createdAt",
        memoryRetentionPolicies: "id, name, updatedAt",
        participantConsentEvents: "id, participantId, effectiveAt",
        goalTrackingRecords: "id, participantId, status, updatedAt",
        homeworkTrackingRecords: "id, participantId, status, assignedAt",
        safetyEvents: "id, participantId, runtimeSessionId, severity, urgency, status, createdAt",
        safetyTriageRecords: "id, safetyEventId, clinicianId, createdAt",
        humanInterventionRecords: "id, safetyEventId, clinicianId, status, createdAt",
        safetyFollowUpTasks: "id, safetyEventId, participantId, status, dueAt, updatedAt",
        runtimeClinicians: "id, role, available, updatedAt",
        safetyStatusTransitions: "id, safetyEventId, createdAt",
        safetyNotifications: "id, clinicianId, createdAt, readAt",
        safetyReports: "id, safetyEventId, participantId, createdAt",
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        const clinicianTable = tx.table("runtimeClinicians");
        if ((await clinicianTable.count()) === 0) {
          await clinicianTable.bulkPut([
            { id: "CLIN-A", name: "Demo Clinician A", initials: "DA", role: "clinician", locale: "ko-KR", country: "KR", active: true, available: true, assignedSafetyEventIds: [], createdAt: now, updatedAt: now },
            { id: "CLIN-B", name: "Demo Clinician B", initials: "DB", role: "clinician", locale: "ko-KR", country: "KR", active: true, available: true, assignedSafetyEventIds: [], createdAt: now, updatedAt: now },
            { id: "SAFE-R", name: "Demo Safety Reviewer", initials: "SR", role: "safety_reviewer", locale: "ko-KR", country: "KR", active: true, available: true, assignedSafetyEventIds: [], createdAt: now, updatedAt: now },
            { id: "SUP-1", name: "Demo Supervisor", initials: "SV", role: "supervisor", locale: "ko-KR", country: "KR", active: true, available: true, assignedSafetyEventIds: [], createdAt: now, updatedAt: now },
            { id: "RC-1", name: "Demo Research Coordinator", initials: "RC", role: "research_coordinator", locale: "ko-KR", country: "KR", active: true, available: true, assignedSafetyEventIds: [], createdAt: now, updatedAt: now },
          ]);
        }
        const escalations = await tx.table("runtimeEscalations").toArray();
        for (const escalation of escalations) {
          const existing = await tx.table("safetyEvents").where("linkedEscalationId").equals(escalation.id).first();
          if (existing) continue;
          const session = await tx.table("runtimeSessions").get(escalation.runtimeSessionId);
          if (!session) continue;
          await tx.table("safetyEvents").put({
            id: `SEV-${escalation.id}`,
            projectId: "TBCT-BR-001",
            participantId: session.participantId,
            runtimeSessionId: escalation.runtimeSessionId,
            protocolId: escalation.protocolId,
            protocolVersion: escalation.protocolVersion,
            sessionDefinitionId: escalation.sessionDefinitionId,
            source: "runtime_rule",
            sourceNodeId: escalation.nodeId,
            sourceMessageIds: [],
            sourceExecutionLogIds: [],
            safetyRuleIds: escalation.safetyRuleId ? [escalation.safetyRuleId] : [],
            linkedEscalationId: escalation.id,
            linkedSafetyMemoryIds: [],
            severity: escalation.severity,
            urgency: escalation.severity === "high" ? "urgent" : "priority",
            status: escalation.status === "resolved" ? "resolved" : escalation.status === "acknowledged" ? "acknowledged" : "queued",
            triggerSummary: escalation.triggerSummary,
            patientFacingStatus: escalation.status === "resolved" ? "review_completed" : "waiting_for_review",
            sessionHoldRequired: true,
            sessionResumeAuthorized: false,
            acknowledgedAt: escalation.acknowledgedAt,
            resolvedAt: escalation.resolvedAt,
            resolutionSummary: escalation.resolutionNote,
            followUpRequired: escalation.severity !== "low",
            followUpTaskIds: [],
            createdAt: escalation.createdAt,
            updatedAt: escalation.resolvedAt ?? escalation.acknowledgedAt ?? escalation.createdAt,
          });
        }
      });

    this.version(6)
      .stores({
        clinicalAssets: "id",
        storedFiles: "id, assetId, versionId",
        extractedDocuments: "id, assetId, assetVersionId, extractedAt",
        extractionJobs: "id, assetId, assetVersionId, status, createdAt",
        assetVersions: "id, assetId, version, isCurrent, createdAt",
        auditEntries: "id, timestamp, action, resource, version",
        reviewDrafts: "id, projectId, createdAt, status",
        relationships: "id, projectId, sourceAssetId, targetAssetId, relationType, createdAt",
        structuredTbctItems: "id, draftId, mappingType, status, updatedAt",
        sourceEvidence: "id, assetId, extractedDocumentId, blockId",
        reviewDecisions: "id, draftId, structuredItemId, decision, createdAt",
        protocolDraftCandidates: "id, sourceDraftId, sessionId, createdAt",
        protocolDefinitions: "id, projectId, status, currentVersion, updatedAt",
        protocolSessions: "id, protocolId, status, order, updatedAt",
        protocolGraphNodes: "id, protocolId, sessionId, type",
        protocolGraphEdges: "id, protocolId, sessionId, source, target",
        protocolValidationRuns: "id, protocolId, executedAt",
        protocolReleasePackages: "id, protocolId, protocolVersion, generatedAt",
        protocolReleaseVersions: "id, protocolId, version, publishedAt",
        runtimeExecutionLogs: "id, protocolId, sessionId, startedAt",
        runtimeSessions: "id, participantId, protocolId, releaseId, status, updatedAt, createdAt",
        runtimeMessages: "id, runtimeSessionId, role, createdAt, deliveredAt",
        runtimeSessionLogs: "id, runtimeSessionId, stage, status, timestamp",
        runtimeEscalations: "id, runtimeSessionId, protocolId, status, createdAt",
        runtimeCheckpoints: "id, runtimeSessionId, sequence, createdAt",
        runtimeProviderEvents: "id, runtimeSessionId, provider, createdAt",
        runtimeValidationEvents: "id, runtimeSessionId, createdAt",
        runtimeParticipants: "id, projectId, alias, status, updatedAt",
        longitudinalRecords: "id, participantId, updatedAt",
        longitudinalMemories: "id, participantId, memoryType, status, validUntil, updatedAt",
        runtimeSessionSummaries: "id, runtimeSessionId, participantId, summaryStatus, updatedAt",
        memoryCandidates: "id, participantId, memoryType, status, validUntil, updatedAt",
        memoryReviewDecisions: "id, memoryId, participantId, createdAt",
        memoryRetrievalRuns: "id, participantId, runtimeSessionId, createdAt",
        memoryUsageLogs: "id, memoryId, participantId, runtimeSessionId, createdAt",
        memoryRetentionPolicies: "id, name, updatedAt",
        participantConsentEvents: "id, participantId, effectiveAt",
        goalTrackingRecords: "id, participantId, status, updatedAt",
        homeworkTrackingRecords: "id, participantId, status, assignedAt",
        safetyEvents: "id, participantId, runtimeSessionId, severity, urgency, status, createdAt",
        safetyTriageRecords: "id, safetyEventId, clinicianId, createdAt",
        humanInterventionRecords: "id, safetyEventId, clinicianId, status, createdAt",
        safetyFollowUpTasks: "id, safetyEventId, participantId, status, dueAt, updatedAt",
        runtimeClinicians: "id, role, available, updatedAt",
        safetyStatusTransitions: "id, safetyEventId, createdAt",
        safetyNotifications: "id, clinicianId, createdAt, readAt",
        safetyReports: "id, safetyEventId, participantId, createdAt",
        clinicianHandoffRecords: "id, safetyEventId, toClinicianId, status, createdAt",
        sessionResumeRequests: "id, safetyEventId, runtimeSessionId, status, createdAt",
        safetyTriggerSuppressions: "id, runtimeSessionId, safetyEventId, createdAt, expiresAt",
      })
      .upgrade(async () => {});

    this.version(7)
      .stores({
        clinicalAssets: "id",
        storedFiles: "id, assetId, versionId",
        extractedDocuments: "id, assetId, assetVersionId, extractedAt",
        extractionJobs: "id, assetId, assetVersionId, status, createdAt",
        assetVersions: "id, assetId, version, isCurrent, createdAt",
        auditEntries: "id, timestamp, action, resource, version",
        reviewDrafts: "id, projectId, createdAt, status",
        relationships: "id, projectId, sourceAssetId, targetAssetId, relationType, createdAt",
        structuredTbctItems: "id, draftId, mappingType, status, updatedAt",
        sourceEvidence: "id, assetId, extractedDocumentId, blockId",
        reviewDecisions: "id, draftId, structuredItemId, decision, createdAt",
        protocolDraftCandidates: "id, sourceDraftId, sessionId, createdAt",
        protocolDefinitions: "id, projectId, status, currentVersion, updatedAt",
        protocolSessions: "id, protocolId, status, order, updatedAt",
        protocolGraphNodes: "id, protocolId, sessionId, type",
        protocolGraphEdges: "id, protocolId, sessionId, source, target",
        protocolValidationRuns: "id, protocolId, executedAt",
        protocolReleasePackages: "id, protocolId, protocolVersion, generatedAt",
        protocolReleaseVersions: "id, protocolId, version, publishedAt",
        runtimeExecutionLogs: "id, protocolId, sessionId, startedAt",
        runtimeSessions: "id, participantId, protocolId, releaseId, status, updatedAt, createdAt",
        runtimeMessages: "id, runtimeSessionId, role, createdAt, deliveredAt",
        runtimeSessionLogs: "id, runtimeSessionId, stage, status, timestamp",
        runtimeEscalations: "id, runtimeSessionId, protocolId, status, createdAt",
        runtimeCheckpoints: "id, runtimeSessionId, sequence, createdAt",
        runtimeProviderEvents: "id, runtimeSessionId, provider, createdAt",
        runtimeValidationEvents: "id, runtimeSessionId, createdAt",
        runtimeParticipants: "id, projectId, alias, status, updatedAt",
        longitudinalRecords: "id, participantId, updatedAt",
        longitudinalMemories: "id, participantId, memoryType, status, validUntil, updatedAt",
        runtimeSessionSummaries: "id, runtimeSessionId, participantId, summaryStatus, updatedAt",
        memoryCandidates: "id, participantId, memoryType, status, validUntil, updatedAt",
        memoryReviewDecisions: "id, memoryId, participantId, createdAt",
        memoryRetrievalRuns: "id, participantId, runtimeSessionId, createdAt",
        memoryUsageLogs: "id, memoryId, participantId, runtimeSessionId, createdAt",
        memoryRetentionPolicies: "id, name, updatedAt",
        participantConsentEvents: "id, participantId, effectiveAt",
        goalTrackingRecords: "id, participantId, status, updatedAt",
        homeworkTrackingRecords: "id, participantId, status, assignedAt",
        safetyEvents: "id, participantId, runtimeSessionId, severity, urgency, status, createdAt",
        safetyTriageRecords: "id, safetyEventId, clinicianId, createdAt",
        humanInterventionRecords: "id, safetyEventId, clinicianId, status, createdAt",
        safetyFollowUpTasks: "id, safetyEventId, participantId, status, dueAt, updatedAt",
        runtimeClinicians: "id, role, available, updatedAt",
        safetyStatusTransitions: "id, safetyEventId, createdAt",
        safetyNotifications: "id, clinicianId, createdAt, readAt",
        safetyReports: "id, safetyEventId, participantId, createdAt",
        clinicianHandoffRecords: "id, safetyEventId, toClinicianId, status, createdAt",
        sessionResumeRequests: "id, safetyEventId, runtimeSessionId, status, createdAt",
        safetyTriggerSuppressions: "id, runtimeSessionId, safetyEventId, createdAt, expiresAt",
        pilotStudies: "id, code, status, updatedAt",
        pilotStudyArms: "id, studyId, code, active, updatedAt",
        pilotSites: "id, studyId, countryCode, status, updatedAt",
        pilotStudyParticipants: "id, studyId, runtimeParticipantId, siteId, countryCode, status, studyArmId, updatedAt",
        participantScreeningRecords: "id, studyId, studyParticipantId, status, updatedAt",
        eligibilityDecisions: "id, studyParticipantId, decision, decidedAt",
        studyConsentRecords: "id, studyId, studyParticipantId, status, updatedAt",
        consentWithdrawalRecords: "id, studyParticipantId, consentRecordId, effectiveAt",
        studyEnrollments: "id, studyId, studyParticipantId, siteId, status, updatedAt",
        studyArmAllocations: "id, studyId, studyParticipantId, siteId, studyArmId, status, allocatedAt",
        participantProtocolAssignments: "id, studyParticipantId, studyArmId, protocolReleaseId, assignedAt",
        clinicianDeliveredSessions: "id, studyParticipantId, sessionScheduleId, clinicianId, updatedAt",
        studySessionSchedules: "id, studyParticipantId, runtimeParticipantId, status, plannedAt, updatedAt",
        participantAdherenceRecords: "id, studyParticipantId, updatedAt",
        protocolDeviations: "id, studyParticipantId, category, status, updatedAt",
        outcomeAssessmentInstances: "id, studyParticipantId, status, dueAt, completedAt",
        researchDataQualityIssues: "id, studyParticipantId, severity, status, updatedAt",
        researchDataSnapshots: "id, studyId, status, updatedAt",
        researchExports: "id, studyId, snapshotId, status, createdAt",
        pilotReports: "id, studyId, reportType, createdAt",
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        const studyId = "PILOT-STUDY-01";
        const participantId = "PARTICIPANT-DEMO-01";
        const releaseVersions = await tx.table("protocolReleaseVersions").toArray();
        const releaseId = releaseVersions[0]?.id ?? "REL-DEMO-001";
        await tx.table("runtimeClinicians").put({
          id: "ANL-1",
          name: "Demo Research Analyst",
          initials: "RA",
          role: "research_coordinator",
          locale: "en-US",
          country: "KR",
          active: true,
          available: true,
          assignedSafetyEventIds: [],
          createdAt: now,
          updatedAt: now,
        });
        await tx.table("pilotStudies").put({
          id: studyId,
          projectId: "TBCT-BR-001",
          code: "TBCT-PILOT-001",
          title: "TBCT 3-Arm Demo Pilot",
          description: "Demo pilot configuration — not a registered clinical trial system.",
          status: "recruiting",
          targetSampleSize: 30,
          targetPerArm: 10,
          countries: ["BR", "FR", "KR"],
          armIds: ["ARM-CLIN", "ARM-AIC", "ARM-AIO"],
          siteIds: ["SITE-BR", "SITE-FR", "SITE-KR"],
          protocolFamilyId: "TBCT-BR-001",
          protocolReleaseIds: [releaseId],
          screeningFormVersion: "demo-screening-v1",
          consentFormVersion: "demo-consent-v1",
          outcomeScheduleVersion: "demo-outcomes-v1",
          feasibilityObjectives: ["Session delivery readiness", "Cross-country workflow readiness"],
          safetyObjectives: ["Safety event handling completeness", "Human oversight readiness"],
          acceptabilityObjectives: ["Session completion experience", "Participant-facing flow clarity"],
          operationalObjectives: ["Allocation workflow readiness", "De-identified export readiness"],
          createdAt: now,
          updatedAt: now,
        });
        await tx.table("pilotStudyArms").bulkPut([
          { id: "ARM-CLIN", studyId, code: "CLINICIAN_ONLY", name: "Clinician-only TBCT", shortLabel: "Clinician-only", description: "Clinician-delivered protocol checklist flow", targetSampleSize: 10, clinicianRequired: true, aiRuntimeEnabled: false, aiLeadMode: false, humanSafetyOversightRequired: true, protocolReleaseIdsByCountry: { BR: releaseId, FR: releaseId, KR: releaseId }, allowedRuntimeModes: ["clinician_delivered"], active: true, createdAt: now, updatedAt: now },
          { id: "ARM-AIC", studyId, code: "AI_CLINICIAN", name: "AI + Clinician TBCT", shortLabel: "AI + Clinician", description: "AI runtime with clinician assignment and review gate", targetSampleSize: 10, clinicianRequired: true, aiRuntimeEnabled: true, aiLeadMode: false, humanSafetyOversightRequired: true, protocolReleaseIdsByCountry: { BR: releaseId, FR: releaseId, KR: releaseId }, allowedRuntimeModes: ["ai_assisted_clinician"], active: true, createdAt: now, updatedAt: now },
          { id: "ARM-AIO", studyId, code: "AI_LED_OVERSIGHT", name: "AI-led with Safety Oversight", shortLabel: "AI-led", description: "AI runtime with mandatory human safety oversight", targetSampleSize: 10, clinicianRequired: false, aiRuntimeEnabled: true, aiLeadMode: true, humanSafetyOversightRequired: true, protocolReleaseIdsByCountry: { BR: releaseId, FR: releaseId, KR: releaseId }, allowedRuntimeModes: ["ai_led_with_oversight"], active: true, createdAt: now, updatedAt: now },
        ]);
        await tx.table("pilotSites").bulkPut([
          { id: "SITE-BR", studyId, countryCode: "BR", name: "Brazil Demo Site", locale: "pt-BR", timezone: "America/Sao_Paulo", status: "recruiting", supportedProtocolReleaseIds: [releaseId], supportedConsentVersions: ["demo-consent-v1"], supportedAssessmentLanguages: ["pt-BR"], siteCoordinatorIds: ["RC-1"], clinicianIds: ["CLIN-A"], safetyReviewerIds: ["SAFE-R"], recruitmentTarget: 10, enrolledCount: 1, createdAt: now, updatedAt: now },
          { id: "SITE-FR", studyId, countryCode: "FR", name: "France Demo Site", locale: "fr-FR", timezone: "Europe/Paris", status: "recruiting", supportedProtocolReleaseIds: [releaseId], supportedConsentVersions: ["demo-consent-v1"], supportedAssessmentLanguages: ["fr-FR"], siteCoordinatorIds: ["RC-1"], clinicianIds: ["CLIN-B"], safetyReviewerIds: ["SAFE-R"], recruitmentTarget: 10, enrolledCount: 0, createdAt: now, updatedAt: now },
          { id: "SITE-KR", studyId, countryCode: "KR", name: "Korea Demo Site", locale: "ko-KR", timezone: "Asia/Seoul", status: "recruiting", supportedProtocolReleaseIds: [releaseId], supportedConsentVersions: ["demo-consent-v1"], supportedAssessmentLanguages: ["ko-KR"], siteCoordinatorIds: ["RC-1"], clinicianIds: ["CLIN-A"], safetyReviewerIds: ["SAFE-R"], recruitmentTarget: 10, enrolledCount: 1, createdAt: now, updatedAt: now },
        ]);
        const existingParticipant = await tx.table("pilotStudyParticipants").count();
        if (existingParticipant === 0) {
          await tx.table("pilotStudyParticipants").bulkPut([
            { id: "SP-KR-001", studyId, runtimeParticipantId: participantId, siteId: "SITE-KR", countryCode: "KR", studyParticipantCode: "KR-P001", alias: "Demo Participant 01", status: "allocated", consentRecordIds: ["CON-DEMO-1"], currentConsentRecordId: "CON-DEMO-1", enrollmentId: "ENR-DEMO-1", allocationId: "ALC-DEMO-1", studyArmId: "ARM-AIC", assignedClinicianIds: ["CLIN-A"], assignedSafetyReviewerIds: ["SAFE-R"], expectedSessionCount: 3, completedSessionCount: 1, sessionScheduleIds: ["SCH-DEMO-1"], assessmentInstanceIds: ["ASM-DEMO-1"], deviationIds: ["DEV-DEMO-1"], screeningRecordId: "SCR-DEMO-1", eligibilityDecisionId: "ELG-DEMO-1", enrolledAt: now, allocatedAt: now, createdAt: now, updatedAt: now },
            { id: "SP-BR-001", studyId, runtimeParticipantId: "PARTICIPANT-BR-01", siteId: "SITE-BR", countryCode: "BR", studyParticipantCode: "BR-P001", alias: "Demo Participant BR", status: "consented", consentRecordIds: ["CON-DEMO-2"], currentConsentRecordId: "CON-DEMO-2", assignedClinicianIds: [], assignedSafetyReviewerIds: [], expectedSessionCount: 3, completedSessionCount: 0, sessionScheduleIds: [], assessmentInstanceIds: [], deviationIds: [], screeningRecordId: "SCR-DEMO-2", eligibilityDecisionId: "ELG-DEMO-2", createdAt: now, updatedAt: now },
            { id: "SP-FR-001", studyId, runtimeParticipantId: "PARTICIPANT-FR-01", siteId: "SITE-FR", countryCode: "FR", studyParticipantCode: "FR-P001", alias: "Demo Participant FR", status: "screening", consentRecordIds: [], assignedClinicianIds: [], assignedSafetyReviewerIds: [], expectedSessionCount: 3, completedSessionCount: 0, sessionScheduleIds: [], assessmentInstanceIds: [], deviationIds: [], createdAt: now, updatedAt: now },
          ]);
          await tx.table("participantScreeningRecords").bulkPut([
            { id: "SCR-DEMO-1", studyId, studyParticipantId: "SP-KR-001", screeningVersion: "demo-screening-v1", results: [{ criterionId: "age-range", label: "Demo participation age-range confirmation", category: "inclusion", result: "met" }], status: "complete", completedBy: "RC-1", completedAt: now, createdAt: now, updatedAt: now },
            { id: "SCR-DEMO-2", studyId, studyParticipantId: "SP-BR-001", screeningVersion: "demo-screening-v1", results: [{ criterionId: "locale", label: "Supported locale confirmation", category: "operational", result: "met" }], status: "complete", completedBy: "RC-1", completedAt: now, createdAt: now, updatedAt: now },
          ]);
          await tx.table("eligibilityDecisions").bulkPut([
            { id: "ELG-DEMO-1", studyParticipantId: "SP-KR-001", screeningRecordId: "SCR-DEMO-1", decision: "eligible", reasonCodes: [], decidedBy: "RC-1", decidedAt: now, overridden: false },
            { id: "ELG-DEMO-2", studyParticipantId: "SP-BR-001", screeningRecordId: "SCR-DEMO-2", decision: "eligible", reasonCodes: [], decidedBy: "RC-1", decidedAt: now, overridden: false },
          ]);
          await tx.table("studyConsentRecords").bulkPut([
            { id: "CON-DEMO-1", studyId, studyParticipantId: "SP-KR-001", consentVersion: "demo-consent-v1", locale: "ko-KR", status: "accepted", studyParticipationAllowed: true, treatmentDataCollectionAllowed: true, researchDataUseAllowed: true, crossSessionMemoryAllowed: true, sensitiveMemoryAllowed: false, deidentifiedExportAllowed: true, presentedAt: now, respondedAt: now, recordedBy: "RC-1", createdAt: now, updatedAt: now },
            { id: "CON-DEMO-2", studyId, studyParticipantId: "SP-BR-001", consentVersion: "demo-consent-v1", locale: "pt-BR", status: "accepted", studyParticipationAllowed: true, treatmentDataCollectionAllowed: true, researchDataUseAllowed: true, crossSessionMemoryAllowed: true, sensitiveMemoryAllowed: false, deidentifiedExportAllowed: true, presentedAt: now, respondedAt: now, recordedBy: "RC-1", createdAt: now, updatedAt: now },
          ]);
          await tx.table("studyEnrollments").put({ id: "ENR-DEMO-1", studyId, studyParticipantId: "SP-KR-001", siteId: "SITE-KR", eligibilityDecisionId: "ELG-DEMO-1", consentRecordId: "CON-DEMO-1", status: "enrolled", enrolledBy: "RC-1", enrolledAt: now, createdAt: now, updatedAt: now });
          await tx.table("studyArmAllocations").put({ id: "ALC-DEMO-1", studyId, studyParticipantId: "SP-KR-001", siteId: "SITE-KR", countryCode: "KR", studyArmId: "ARM-AIC", method: "demo_blocked_allocation", blockKey: "KR-BLOCK-01", allocationSequence: 1, status: "assigned", allocatedBy: "RC-1", allocatedAt: now });
          await tx.table("participantProtocolAssignments").put({ id: "PAS-DEMO-1", studyParticipantId: "SP-KR-001", studyArmId: "ARM-AIC", protocolReleaseId: releaseId, countryCode: "KR", runtimeMode: "ai_assisted_clinician", assignedBy: "RC-1", assignedAt: now });
          await tx.table("studySessionSchedules").put({ id: "SCH-DEMO-1", studyParticipantId: "SP-KR-001", runtimeParticipantId: participantId, sessionDefinitionId: "SESSION-03", title: "Session 01", plannedAt: now, locale: "ko-KR", status: "completed", runtimeSessionId: "RTS-DEMO-1", clinicianId: "CLIN-A", createdAt: now, updatedAt: now });
          await tx.table("participantAdherenceRecords").put({ id: "ADH-DEMO-1", studyParticipantId: "SP-KR-001", completedSessions: 1, expectedSessions: 3, completionRate: 0.33, missedSessions: 0, updatedAt: now });
          await tx.table("protocolDeviations").put({ id: "DEV-DEMO-1", studyParticipantId: "SP-KR-001", category: "session", title: "Delayed clinician review gate", description: "Demo deviation placeholder for research operations.", status: "open", createdAt: now, updatedAt: now });
          await tx.table("outcomeAssessmentInstances").put({ id: "ASM-DEMO-1", studyParticipantId: "SP-KR-001", scheduleLabel: "Post Session Acceptability", locale: "ko-KR", status: "pending", dueAt: now });
          await tx.table("researchDataQualityIssues").put({ id: "DQ-DEMO-1", studyParticipantId: "SP-KR-001", category: "assessment", severity: "warning", title: "Pending post-session assessment", status: "open", createdAt: now, updatedAt: now });
          await tx.table("researchDataSnapshots").put({ id: "SNP-DEMO-1", studyId, status: "validated", participantCount: 2, createdAt: now, updatedAt: now });
          await tx.table("researchExports").put({ id: "EXP-DEMO-1", studyId, snapshotId: "SNP-DEMO-1", status: "ready", format: "json", manifestChecksum: "chk-demo-001", createdAt: now });
          await tx.table("pilotReports").put({ id: "PRT-DEMO-1", studyId, title: "Demo Pilot Operations Report", reportType: "operations_summary", createdAt: now, payload: { label: "descriptive operational summary", target: "N=30", note: "not confirmatory efficacy evidence" } });
        }
      });

    this.version(8).stores({
      pilotStudies: "id, code, status, updatedAt",
      pilotStudyArms: "id, studyId, code, active, updatedAt",
      pilotSites: "id, studyId, countryCode, status, updatedAt",
      pilotStudyParticipants: "id, studyId, runtimeParticipantId, siteId, countryCode, status, studyArmId, updatedAt",
      participantScreeningRecords: "id, studyId, studyParticipantId, status, updatedAt",
      eligibilityDecisions: "id, studyParticipantId, decision, decidedAt",
      eligibilityOverrideRecords: "id, studyParticipantId, eligibilityDecisionId, createdAt",
      studyConsentRecords: "id, studyId, studyParticipantId, status, updatedAt",
      consentWithdrawalRecords: "id, studyParticipantId, consentRecordId, effectiveAt",
      studyEnrollments: "id, studyId, studyParticipantId, siteId, status, updatedAt",
      studyArmAllocations: "id, studyId, studyParticipantId, siteId, studyArmId, status, allocatedAt",
      allocationOverrideRecords: "id, studyParticipantId, previousAllocationId, newAllocationId, createdAt",
      participantProtocolAssignments: "id, studyParticipantId, studyArmId, protocolReleaseId, assignedAt, active",
      protocolAssignmentOverrideRecords: "id, studyParticipantId, previousAssignmentId, newAssignmentId, createdAt",
      clinicianDeliveredSessions: "id, studyParticipantId, sessionScheduleId, clinicianId, updatedAt",
      clinicianSessionReviews: "id, studyParticipantId, runtimeSessionId, status, updatedAt",
      studySessionSchedules: "id, studyParticipantId, runtimeParticipantId, status, plannedAt, updatedAt",
      participantAdherenceRecords: "id, studyParticipantId, updatedAt",
      protocolDeviations: "id, studyParticipantId, category, status, updatedAt",
      outcomeAssessmentDefinitions: "id, studyId, code, active, updatedAt",
      outcomeAssessmentSchedules: "id, studyParticipantId, definitionId, status, dueAt, updatedAt",
      outcomeAssessmentInstances: "id, studyParticipantId, status, dueAt, completedAt",
      researchDataQualityIssues: "id, studyParticipantId, severity, status, updatedAt",
      researchDataSnapshots: "id, studyId, status, updatedAt",
      researchSnapshotValidationRuns: "id, snapshotId, studyId, validatedAt",
      researchExports: "id, studyId, snapshotId, status, createdAt",
      pilotReports: "id, studyId, reportType, createdAt",
    }).upgrade(async (tx) => {
      const assignments = await tx.table("participantProtocolAssignments").toArray();
      for (const assignment of assignments) {
        if (assignment.active === undefined) {
          await tx.table("participantProtocolAssignments").put({ ...assignment, active: true });
        }
      }
      const reports = await tx.table("pilotReports").toArray();
      for (const report of reports) {
        if (!report.status || !report.generatedAt) {
          await tx.table("pilotReports").put({
            ...report,
            status: "generated",
            generatedAt: report.createdAt,
            generatedBy: report.generatedBy ?? "RC-1",
            limitations: report.limitations ?? [
              "Demo/local-first data",
              "Feasibility-focused pilot",
              "Descriptive operational summary",
              "Not confirmatory efficacy evidence",
            ],
          });
        }
      }
    });

    this.version(9).stores({
      pilotStudies: "id, code, status, updatedAt",
      pilotStudyArms: "id, studyId, code, active, updatedAt",
      pilotSites: "id, studyId, countryCode, status, updatedAt",
      pilotStudyParticipants: "id, studyId, runtimeParticipantId, siteId, countryCode, status, studyArmId, updatedAt",
      participantScreeningRecords: "id, studyId, studyParticipantId, status, updatedAt",
      eligibilityDecisions: "id, studyParticipantId, decision, decidedAt",
      eligibilityOverrideRecords: "id, studyParticipantId, eligibilityDecisionId, createdAt",
      studyConsentRecords: "id, studyId, studyParticipantId, status, updatedAt",
      consentWithdrawalRecords: "id, studyParticipantId, consentRecordId, effectiveAt",
      studyEnrollments: "id, studyId, studyParticipantId, siteId, status, updatedAt",
      studyArmAllocations: "id, studyId, studyParticipantId, siteId, studyArmId, status, allocatedAt",
      allocationOverrideRecords: "id, studyParticipantId, previousAllocationId, newAllocationId, createdAt",
      participantProtocolAssignments: "id, studyParticipantId, studyArmId, protocolReleaseId, assignedAt, active",
      protocolAssignmentOverrideRecords: "id, studyParticipantId, previousAssignmentId, newAssignmentId, createdAt",
      clinicianDeliveredSessions: "id, studyParticipantId, sessionScheduleId, clinicianId, updatedAt",
      clinicianSessionReviews: "id, studyParticipantId, runtimeSessionId, status, updatedAt",
      studySessionSchedules: "id, studyParticipantId, runtimeParticipantId, status, plannedAt, updatedAt",
      participantAdherenceRecords: "id, studyParticipantId, updatedAt",
      protocolDeviations: "id, studyParticipantId, category, status, updatedAt",
      outcomeAssessmentDefinitions: "id, studyId, code, active, updatedAt",
      outcomeAssessmentSchedules: "id, studyParticipantId, definitionId, status, dueAt, updatedAt",
      outcomeAssessmentInstances: "id, studyParticipantId, status, dueAt, completedAt",
      researchDataQualityIssues: "id, studyParticipantId, severity, status, updatedAt",
      researchDataSnapshots: "id, studyId, status, updatedAt",
      researchSnapshotValidationRuns: "id, snapshotId, studyId, validatedAt",
      researchExports: "id, studyId, snapshotId, status, createdAt",
      researchExportFiles: "id, exportId, filename, createdAt",
      pilotReports: "id, studyId, reportType, createdAt",
    });

    this.version(10).stores({
      sourceFidelityBackups: "id, createdAt, migrationVersion",
    });

    this.version(11).stores({
      runtimeExecutionTraces: "id, runtimeSessionId, releaseId, nodeId, promptItemId, timestamp",
    });
  }
}

let dbSingleton: TbctLocalDatabase | null = null;
let sourceFidelityBackupPromise: Promise<SourceFidelityMigrationBackup | null> | null = null;

function isTbctProtocolId(protocolId?: string) {
  return protocolId?.toLowerCase() === "tbct-br-001";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stripSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveValues);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !/(api[_-]?key|token|secret|password|credential|authorization)/i.test(key))
      .map(([key, item]) => [key, stripSensitiveValues(item)]),
  );
}

function readLegacyCatalogSnapshot() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_SESSION_CATALOG_BACKUP_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_SESSION_CATALOG_STORAGE_KEY);
    return raw ? stripSensitiveValues(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function collectSourceTraces(...collections: unknown[][]) {
  return collections.flatMap((collection) => collection.flatMap((value) => {
    const record = asRecord(value);
    const data = asRecord(record?.data);
    const trace = record?.sourceTrace ?? data?.sourceTrace;
    return trace ? [trace] : [];
  }));
}

async function captureSourceFidelityBackup(db: TbctLocalDatabase): Promise<SourceFidelityMigrationBackup | null> {
  const existing = await db.sourceFidelityBackups.get(SOURCE_FIDELITY_BACKUP_ID);
  if (existing) return existing;

  const [allDefinitions, allSessions, allNodes, allEdges, allReleases, allRuntimeSessions, allRuntimeLogs] = await Promise.all([
    db.protocolDefinitions.toArray(),
    db.protocolSessions.toArray(),
    db.protocolGraphNodes.toArray(),
    db.protocolGraphEdges.toArray(),
    db.protocolReleaseVersions.toArray(),
    db.runtimeSessions.toArray(),
    db.runtimeExecutionLogs.toArray(),
  ]);
  const definitions = allDefinitions.filter((definition) => isTbctProtocolId(definition.id));
  const sessions = allSessions.filter((session) => isTbctProtocolId(session.protocolId));
  const nodes = allNodes.filter((node) => isTbctProtocolId(node.protocolId));
  const edges = allEdges.filter((edge) => isTbctProtocolId(edge.protocolId));
  const releases = allReleases.filter((release) => isTbctProtocolId(release.protocolId));
  const releaseIds = new Set(releases.map((release) => release.id));
  const runtimeReferences = allRuntimeSessions
    .filter((session) => isTbctProtocolId(session.protocolId) || releaseIds.has(session.releaseId))
    .map((session) => ({
      id: session.id,
      protocolId: session.protocolId,
      protocolVersion: session.protocolVersion,
      releaseId: session.releaseId,
      sessionDefinitionId: session.sessionDefinitionId,
      currentSessionId: session.currentSessionId,
      currentNodeId: session.currentNodeId,
      currentPromptItemId: session.currentPromptItemId,
      completedPromptItemIds: session.completedPromptItemIds,
      skippedPromptItemIds: session.skippedPromptItemIds,
      status: session.status,
      sourceVersion: session.sourceVersion,
      sourceTextHash: session.sourceTextHash,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  const runtimeExecutionReferences = allRuntimeLogs
    .filter((log) => isTbctProtocolId(log.protocolId))
    .map((log) => ({ id: log.id, protocolId: log.protocolId, sessionId: log.sessionId, startedAt: log.startedAt, steps: log.steps }));
  const legacyCatalog = readLegacyCatalogSnapshot();
  const legacyCatalogRecord = asRecord(legacyCatalog);
  const catalogDefinitions = asArray(legacyCatalogRecord?.definitions);
  const catalogNodes = asArray(legacyCatalogRecord?.nodes);
  const catalogEdges = asArray(legacyCatalogRecord?.edges);
  const catalogPromptItems = asArray(legacyCatalogRecord?.promptItems);
  const backup: SourceFidelityMigrationBackup = {
    id: SOURCE_FIDELITY_BACKUP_ID,
    schemaVersion: "source-fidelity-backup/v1",
    createdAt: new Date().toISOString(),
    migrationVersion: "source-fidelity-catalog/v1",
    sessionDefinitions: [...definitions, ...catalogDefinitions],
    protocolDefinitions: definitions,
    protocolSessions: sessions,
    nodes: [...nodes, ...catalogNodes],
    edges: [...edges, ...catalogEdges],
    promptItems: catalogPromptItems,
    sessionPlan: legacyCatalogRecord?.plan ?? null,
    releases,
    runtimeReferences,
    runtimeExecutionReferences,
    sourceTraces: collectSourceTraces(nodes, edges, catalogDefinitions, catalogNodes, catalogPromptItems),
    legacyCatalog,
  };
  await db.sourceFidelityBackups.put(backup);
  return backup;
}

function scheduleSourceFidelityBackup(db: TbctLocalDatabase) {
  if (typeof indexedDB === "undefined" || sourceFidelityBackupPromise) return;
  sourceFidelityBackupPromise = captureSourceFidelityBackup(db).catch(() => {
    sourceFidelityBackupPromise = null;
    return null;
  });
}

export function getLocalDb() {
  if (!dbSingleton) dbSingleton = new TbctLocalDatabase();
  scheduleSourceFidelityBackup(dbSingleton);
  return dbSingleton;
}

export async function ensureSourceFidelityBackup() {
  const db = getLocalDb();
  const existing = await db.sourceFidelityBackups.get(SOURCE_FIDELITY_BACKUP_ID);
  if (existing) return existing;
  sourceFidelityBackupPromise = captureSourceFidelityBackup(db);
  return sourceFidelityBackupPromise;
}

export async function getSourceFidelityBackup() {
  return getLocalDb().sourceFidelityBackups.get(SOURCE_FIDELITY_BACKUP_ID);
}

export async function resetLocalDb() {
  const db = getLocalDb();
  await Promise.all(db.tables.map((table) => table.clear()));
  sourceFidelityBackupPromise = null;
}
