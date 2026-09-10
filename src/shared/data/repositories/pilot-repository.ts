import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import type {
  AllocationOverrideRecord,
  ClinicianDeliveredSession,
  ClinicianSessionReview,
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
  ResearchDataQualityIssue,
  ResearchDataSnapshot,
  ResearchSnapshotValidationRun,
  ResearchExport,
  ResearchExportFile,
  ProtocolAssignmentOverrideRecord,
  StudyArmAllocation,
  StudyConsentRecord,
  StudyEnrollment,
  StudySessionSchedule,
} from "@/types/pilot-operations";

export const listPilotStudies = () => getLocalDb().pilotStudies.toArray();
export const getPilotStudy = (id: string) => getLocalDb().pilotStudies.get(id);
export const listPilotStudyArms = (studyId?: string) => studyId ? getLocalDb().pilotStudyArms.where("studyId").equals(studyId).toArray() : getLocalDb().pilotStudyArms.toArray();
export const getPilotStudyArm = (id: string) => getLocalDb().pilotStudyArms.get(id);
export const listPilotSites = (studyId?: string) => studyId ? getLocalDb().pilotSites.where("studyId").equals(studyId).toArray() : getLocalDb().pilotSites.toArray();
export const getPilotSite = (id: string) => getLocalDb().pilotSites.get(id);
export const listPilotParticipants = (studyId?: string) => studyId ? getLocalDb().pilotStudyParticipants.where("studyId").equals(studyId).toArray() : getLocalDb().pilotStudyParticipants.toArray();
export const getPilotParticipant = (id: string) => getLocalDb().pilotStudyParticipants.get(id);
export async function getPilotParticipantByRuntimeParticipantId(runtimeParticipantId: string) {
  return getLocalDb().pilotStudyParticipants.where("runtimeParticipantId").equals(runtimeParticipantId).first();
}
export const listScreeningRecords = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().participantScreeningRecords.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().participantScreeningRecords.toArray();
export const getScreeningRecord = (id: string) => getLocalDb().participantScreeningRecords.get(id);
export const listEligibilityDecisions = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().eligibilityDecisions.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().eligibilityDecisions.toArray();
export const listEligibilityOverrides = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().eligibilityOverrideRecords.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().eligibilityOverrideRecords.toArray();
export const listConsentRecords = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().studyConsentRecords.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().studyConsentRecords.toArray();
export const listWithdrawals = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().consentWithdrawalRecords.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().consentWithdrawalRecords.toArray();
export const listEnrollments = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().studyEnrollments.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().studyEnrollments.toArray();
export const listAllocations = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().studyArmAllocations.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().studyArmAllocations.toArray();
export const listAllocationOverrides = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().allocationOverrideRecords.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().allocationOverrideRecords.toArray();
export const listProtocolAssignments = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().participantProtocolAssignments.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().participantProtocolAssignments.toArray();
export const listProtocolAssignmentOverrides = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().protocolAssignmentOverrideRecords.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().protocolAssignmentOverrideRecords.toArray();
export const listSessionSchedules = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().studySessionSchedules.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().studySessionSchedules.toArray();
export const listClinicianDeliveredSessions = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().clinicianDeliveredSessions.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().clinicianDeliveredSessions.toArray();
export const listClinicianSessionReviews = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().clinicianSessionReviews.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().clinicianSessionReviews.toArray();
export const listAdherenceRecords = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().participantAdherenceRecords.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().participantAdherenceRecords.toArray();
export const listProtocolDeviations = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().protocolDeviations.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().protocolDeviations.toArray();
export const getProtocolDeviation = (id: string) => getLocalDb().protocolDeviations.get(id);
export const listOutcomeAssessmentDefinitions = (studyId?: string) => studyId ? getLocalDb().outcomeAssessmentDefinitions.where("studyId").equals(studyId).toArray() : getLocalDb().outcomeAssessmentDefinitions.toArray();
export const listOutcomeAssessmentSchedules = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().outcomeAssessmentSchedules.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().outcomeAssessmentSchedules.toArray();
export const listOutcomeAssessmentInstances = (studyParticipantId?: string) => studyParticipantId ? getLocalDb().outcomeAssessmentInstances.where("studyParticipantId").equals(studyParticipantId).toArray() : getLocalDb().outcomeAssessmentInstances.toArray();
export const listResearchDataQualityIssues = () => getLocalDb().researchDataQualityIssues.toArray();
export const listResearchSnapshots = () => getLocalDb().researchDataSnapshots.toArray();
export const listResearchSnapshotValidationRuns = (snapshotId?: string) => snapshotId ? getLocalDb().researchSnapshotValidationRuns.where("snapshotId").equals(snapshotId).toArray() : getLocalDb().researchSnapshotValidationRuns.toArray();
export const listResearchExports = () => getLocalDb().researchExports.toArray();
export const listResearchExportFiles = (exportId?: string) => exportId ? getLocalDb().researchExportFiles.where("exportId").equals(exportId).toArray() : getLocalDb().researchExportFiles.toArray();
export const listPilotReports = () => getLocalDb().pilotReports.toArray();

async function upsert<T extends { id: string }>(table: Dexie.Table<T, string>, record: T) {
  await table.put(record);
  return record;
}

import type Dexie from "dexie";

export const savePilotStudy = (record: PilotStudy) => upsert(getLocalDb().pilotStudies, record);
export const savePilotStudyArm = (record: PilotStudyArm) => upsert(getLocalDb().pilotStudyArms, record);
export const savePilotSite = (record: PilotSite) => upsert(getLocalDb().pilotSites, record);
export const savePilotParticipant = (record: PilotStudyParticipant) => upsert(getLocalDb().pilotStudyParticipants, record);
export const saveScreeningRecord = (record: ParticipantScreeningRecord) => upsert(getLocalDb().participantScreeningRecords, record);
export const saveEligibilityDecision = (record: EligibilityDecision) => upsert(getLocalDb().eligibilityDecisions, record);
export const saveEligibilityOverrideRecord = (record: EligibilityOverrideRecord) => upsert(getLocalDb().eligibilityOverrideRecords, record);
export const saveConsentRecord = (record: StudyConsentRecord) => upsert(getLocalDb().studyConsentRecords, record);
export const saveWithdrawalRecord = (record: ConsentWithdrawalRecord) => upsert(getLocalDb().consentWithdrawalRecords, record);
export const saveEnrollment = (record: StudyEnrollment) => upsert(getLocalDb().studyEnrollments, record);
export const saveAllocation = (record: StudyArmAllocation) => upsert(getLocalDb().studyArmAllocations, record);
export const saveAllocationOverrideRecord = (record: AllocationOverrideRecord) => upsert(getLocalDb().allocationOverrideRecords, record);
export const saveProtocolAssignment = (record: ParticipantProtocolAssignment) => upsert(getLocalDb().participantProtocolAssignments, record);
export const saveProtocolAssignmentOverrideRecord = (record: ProtocolAssignmentOverrideRecord) => upsert(getLocalDb().protocolAssignmentOverrideRecords, record);
export const saveSessionSchedule = (record: StudySessionSchedule) => upsert(getLocalDb().studySessionSchedules, record);
export const saveClinicianDeliveredSession = (record: ClinicianDeliveredSession) => upsert(getLocalDb().clinicianDeliveredSessions, record);
export const saveClinicianSessionReview = (record: ClinicianSessionReview) => upsert(getLocalDb().clinicianSessionReviews, record);
export const saveAdherenceRecord = (record: ParticipantAdherenceRecord) => upsert(getLocalDb().participantAdherenceRecords, record);
export const saveProtocolDeviation = (record: ProtocolDeviation) => upsert(getLocalDb().protocolDeviations, record);
export const saveOutcomeAssessmentDefinition = (record: OutcomeAssessmentDefinition) => upsert(getLocalDb().outcomeAssessmentDefinitions, record);
export const saveOutcomeAssessmentSchedule = (record: OutcomeAssessmentSchedule) => upsert(getLocalDb().outcomeAssessmentSchedules, record);
export const saveOutcomeAssessmentInstance = (record: OutcomeAssessmentInstance) => upsert(getLocalDb().outcomeAssessmentInstances, record);
export const saveResearchDataQualityIssue = (record: ResearchDataQualityIssue) => upsert(getLocalDb().researchDataQualityIssues, record);
export const saveResearchSnapshot = (record: ResearchDataSnapshot) => upsert(getLocalDb().researchDataSnapshots, record);
export const saveResearchSnapshotValidationRun = (record: ResearchSnapshotValidationRun) => upsert(getLocalDb().researchSnapshotValidationRuns, record);
export const saveResearchExport = (record: ResearchExport) => upsert(getLocalDb().researchExports, record);
export const saveResearchExportFile = (record: ResearchExportFile) => upsert(getLocalDb().researchExportFiles, record);
export const savePilotReport = (record: PilotReport) => upsert(getLocalDb().pilotReports, record);
