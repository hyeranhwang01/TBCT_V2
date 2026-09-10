import { createMemoryAuditEntry } from "@/shared/memory/memory-helpers";
import { makeId } from "@/shared/id";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { getCurrentDemoActor, type DemoActorRole } from "@/shared/demo-actor";
import { assertPilotPermission } from "@/clinician/lib/pilot/pilot-permissions";
import { buildResearchDataset } from "@/clinician/lib/pilot/export/research-dataset-builder";
import { buildResearchExportZip } from "@/clinician/lib/pilot/export/research-export-packager";
import { downloadResearchExportBlob } from "@/clinician/lib/pilot/export/research-export-download";
import { stableChecksum } from "@/clinician/lib/pilot/export/export-checksum";
import { redactAliasForAnalyst } from "@/clinician/lib/pilot/export/export-redaction";
import { getParticipant, updateParticipant } from "@/shared/data/repositories/participant-repository";
import {
  getPilotParticipant,
  getPilotParticipantByRuntimeParticipantId,
  getPilotSite,
  getPilotStudy,
  getPilotStudyArm,
  getProtocolDeviation,
  listAdherenceRecords,
  listAllocations,
  listAllocationOverrides,
  listClinicianDeliveredSessions,
  listClinicianSessionReviews,
  listConsentRecords,
  listEligibilityDecisions,
  listEligibilityOverrides,
  listOutcomeAssessmentDefinitions,
  listOutcomeAssessmentSchedules,
  listOutcomeAssessmentInstances,
  listPilotParticipants,
  listPilotReports,
  listPilotSites,
  listPilotStudies,
  listPilotStudyArms,
  listProtocolAssignments,
  listProtocolAssignmentOverrides,
  listProtocolDeviations,
  listResearchDataQualityIssues,
  listResearchExports,
  listResearchExportFiles,
  listResearchSnapshots,
  listResearchSnapshotValidationRuns,
  listScreeningRecords,
  listSessionSchedules,
  listWithdrawals,
  listEnrollments,
  saveAdherenceRecord,
  saveAllocation,
  saveAllocationOverrideRecord,
  saveClinicianDeliveredSession,
  saveClinicianSessionReview,
  saveConsentRecord,
  saveEligibilityDecision,
  saveEligibilityOverrideRecord,
  saveEnrollment,
  saveOutcomeAssessmentDefinition,
  saveOutcomeAssessmentSchedule,
  saveOutcomeAssessmentInstance,
  savePilotParticipant,
  savePilotReport,
  saveProtocolAssignment,
  saveProtocolAssignmentOverrideRecord,
  saveProtocolDeviation,
  saveResearchDataQualityIssue,
  saveResearchExport,
  saveResearchExportFile,
  saveResearchSnapshot,
  saveResearchSnapshotValidationRun,
  saveScreeningRecord,
  saveSessionSchedule,
  saveWithdrawalRecord,
} from "@/shared/data/repositories/pilot-repository";
import type {
  AllocationOverrideRecord,
  EligibilityDecision,
  EligibilityOverrideRecord,
  OutcomeAssessmentDefinition,
  OutcomeAssessmentSchedule,
  ParticipantScreeningRecord,
  PilotReport,
  PilotStudyParticipant,
  ProtocolDeviation,
  ProtocolAssignmentOverrideRecord,
  ResearchExport,
  ResearchExportFile,
  ResearchDataSnapshot,
  ResearchSnapshotValidationRun,
  SessionAvailabilityResult,
  StudyArmAllocation,
  StudyConsentRecord,
  StudyEnrollment,
  StudyParticipantStatus,
} from "@/types/pilot-operations";

function now() {
  return new Date().toISOString();
}

function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `h-${(hash >>> 0).toString(16)}`;
}

function actor() {
  return getCurrentDemoActor();
}

function isResearchAnalystActor() {
  return actor().role === "research_analyst";
}

function redactPilotParticipantForActor(participant: PilotStudyParticipant): PilotStudyParticipant {
  if (!isResearchAnalystActor()) {
    return participant;
  }
  return {
    ...participant,
    alias: redactAliasForAnalyst(participant.studyParticipantCode),
    runtimeParticipantId: "redacted-runtime-participant",
    assignedClinicianIds: [],
    assignedSafetyReviewerIds: [],
  };
}

async function requirePilotPermission(action: Parameters<typeof assertPilotPermission>[0]["action"], resourceType: string, resourceId?: string) {
  const currentActor = actor();
  await assertPilotPermission({
    actorId: currentActor.id,
    actorRole: currentActor.role as DemoActorRole,
    action,
    resourceType,
    resourceId,
  });
  return currentActor;
}

async function audit(action: string, resource: string, previousValue: string, newValue: string, reason: string, result: "Success" | "Blocked" = "Success") {
  await getLocalDb().auditEntries.put(
    createMemoryAuditEntry({ action, resource, version: "stage5", previousValue, newValue, reason, result }),
  );
}

async function requirePilotParticipant(id: string) {
  const participant = await getPilotParticipant(id);
  if (!participant) throw new Error("Pilot participant not found");
  return participant;
}

export async function evaluateSessionAvailability(studyParticipantId: string): Promise<SessionAvailabilityResult> {
  const participant = await requirePilotParticipant(studyParticipantId);
  const [study, site, consent, enrollments, assignments, schedules, deviations] = await Promise.all([
    getPilotStudy(participant.studyId),
    getPilotSite(participant.siteId),
    participant.currentConsentRecordId ? listConsentRecords(studyParticipantId) : Promise.resolve([]),
    listEnrollments(studyParticipantId),
    listProtocolAssignments(studyParticipantId),
    listSessionSchedules(studyParticipantId),
    listProtocolDeviations(studyParticipantId),
  ]);
  const blockers: SessionAvailabilityResult["blockers"] = [];
  const warnings: SessionAvailabilityResult["warnings"] = [];
  const currentConsent = consent.find((item) => item.id === participant.currentConsentRecordId) ?? consent.at(-1);
  const activeEnrollment = enrollments.find((item) => item.status === "enrolled");
  const activeAssignment = [...assignments].reverse().find((item) => item.active !== false);
  const blockedSchedule = schedules.find((item) => item.status === "blocked");
  const unresolvedCriticalDeviation = deviations.find((item) => ["open", "assigned", "in_review"].includes(item.status));

  if (!study || !["recruiting", "active"].includes(study.status)) {
    blockers.push({ code: "study_inactive", message: "Study is not active for session delivery.", sourceEntityType: "PilotStudy", sourceEntityId: participant.studyId, resolutionRoute: "/runtime/pilot/configuration" });
  }
  if (!site || !["ready", "recruiting"].includes(site.status)) {
    blockers.push({ code: "site_unavailable", message: "Site is not ready for session delivery.", sourceEntityType: "PilotSite", sourceEntityId: participant.siteId, resolutionRoute: "/runtime/pilot/sites" });
  }
  if (participant.status === "withdrawn" || currentConsent?.status === "withdrawn") {
    blockers.push({ code: "consent_withdrawn", message: "Consent has been withdrawn. New sessions are blocked.", sourceEntityType: "StudyConsentRecord", sourceEntityId: currentConsent?.id, resolutionRoute: `/runtime/pilot/participants/${studyParticipantId}` });
  }
  if (!participant.eligibilityDecisionId) {
    blockers.push({ code: "eligibility_missing", message: "Eligibility decision is missing.", sourceEntityType: "EligibilityDecision", resolutionRoute: "/runtime/pilot/screening" });
  }
  if (!activeEnrollment) {
    blockers.push({ code: "enrollment_missing", message: "Participant is not enrolled.", sourceEntityType: "StudyEnrollment", resolutionRoute: "/runtime/pilot/enrollment" });
  }
  if (!activeAssignment) {
    blockers.push({ code: "protocol_assignment_missing", message: "No active protocol assignment found.", sourceEntityType: "ParticipantProtocolAssignment", resolutionRoute: "/runtime/pilot/allocation" });
  }
  if (blockedSchedule) {
    blockers.push({ code: "blocked_schedule", message: blockedSchedule.blockedReason ?? "A scheduled session is blocked.", sourceEntityType: "StudySessionSchedule", sourceEntityId: blockedSchedule.id, resolutionRoute: "/runtime/pilot/sessions" });
  }
  if (unresolvedCriticalDeviation) {
    blockers.push({ code: "open_deviation", message: "An unresolved protocol deviation blocks session delivery.", sourceEntityType: "ProtocolDeviation", sourceEntityId: unresolvedCriticalDeviation.id, resolutionRoute: "/runtime/pilot/deviations" });
  }
  if (participant.studyArmId) {
    const arm = await getPilotStudyArm(participant.studyArmId);
    if (arm?.code === "AI_CLINICIAN" && !participant.assignedClinicianIds.length) {
      blockers.push({ code: "clinician_missing", message: "Assigned clinician is required for AI + clinician arm.", sourceEntityType: "PilotStudyArm", sourceEntityId: arm.id, resolutionRoute: `/runtime/pilot/participants/${studyParticipantId}` });
    }
    if (arm?.code === "AI_LED_OVERSIGHT" && !participant.assignedSafetyReviewerIds.length) {
      blockers.push({ code: "safety_reviewer_missing", message: "Assigned safety reviewer is required for oversight arm.", sourceEntityType: "PilotStudyArm", sourceEntityId: arm.id, resolutionRoute: `/runtime/pilot/participants/${studyParticipantId}` });
    }
    if (arm?.code === "CLINICIAN_ONLY") {
      warnings.push({ code: "clinician_only_delivery", message: "This participant must use clinician-delivered workflow; AI runtime should remain blocked." });
    }
  }
  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
    runtimeMode: activeAssignment?.runtimeMode,
    protocolAssignmentId: activeAssignment?.id,
  };
}

export async function getPilotOverviewData() {
  const [studies, participants, sites, allocations, schedules, deviations, safetyEvents, qualityIssues, exportsData] = await Promise.all([
    listPilotStudies(),
    listPilotParticipants(),
    listPilotSites(),
    listAllocations(),
    listSessionSchedules(),
    listProtocolDeviations(),
    getLocalDb().safetyEvents.toArray(),
    listResearchDataQualityIssues(),
    listResearchExports(),
  ]);
  const study = studies[0] ?? null;
  return {
    study,
    participants,
    sites,
    allocations,
    recruitment: {
      total: participants.length,
      enrolled: participants.filter((item) => ["enrolled", "allocated", "active", "completed"].includes(item.status)).length,
      consented: participants.filter((item) => ["consented", "enrolled", "allocated", "active", "completed"].includes(item.status)).length,
      screening: participants.filter((item) => ["screening", "eligible", "consent_pending"].includes(item.status)).length,
    },
    sessions: {
      scheduled: schedules.filter((item) => item.status === "scheduled").length,
      completed: schedules.filter((item) => item.status === "completed").length,
      missed: schedules.filter((item) => item.status === "missed").length,
    },
    safety: {
      open: safetyEvents.filter((item) => !["resolved", "closed", "false_positive", "cancelled"].includes(item.status)).length,
      held: safetyEvents.filter((item) => item.sessionHoldRequired && !item.sessionResumeAuthorized).length,
    },
    deviations,
    qualityIssues,
    exportsData,
  };
}

export async function getPilotStudyConfiguration() {
  const [study, arms, sites] = await Promise.all([listPilotStudies(), listPilotStudyArms(), listPilotSites()]);
  return { study: study[0] ?? null, arms, sites };
}

export async function getPilotParticipantRegistry() {
  const [participants, sites, arms, schedules, safetyEvents, qualityIssues, consentRecords] = await Promise.all([
    listPilotParticipants(),
    listPilotSites(),
    listPilotStudyArms(),
    listSessionSchedules(),
    getLocalDb().safetyEvents.toArray(),
    listResearchDataQualityIssues(),
    listConsentRecords(),
  ]);
  return participants.map((participant) => ({
    participant: redactPilotParticipantForActor(participant),
    site: sites.find((item) => item.id === participant.siteId),
    arm: arms.find((item) => item.id === participant.studyArmId),
    nextSession: schedules.find((item) => item.studyParticipantId === participant.id && item.status === "scheduled"),
    safetyHold: safetyEvents.some((item) => item.participantId === participant.runtimeParticipantId && item.sessionHoldRequired && !item.sessionResumeAuthorized),
    consent: consentRecords.find((item) => item.id === participant.currentConsentRecordId),
    dataQualityOpen: qualityIssues.filter((item) => item.studyParticipantId === participant.id && item.status === "open").length,
  }));
}

export async function getPilotParticipantDetail(studyParticipantId: string) {
  const participant = await requirePilotParticipant(studyParticipantId);
  const [study, site, arm, screening, eligibility, consent, withdrawals, allocations, allocationOverrides, assignments, assignmentOverrides, eligibilityOverrides, schedules, adherence, deviations, outcomes, outcomeSchedules, outcomeDefinitions, clinicianSessions, clinicianReviews, runtimeParticipant, safetyEvents, availability] = await Promise.all([
    getPilotStudy(participant.studyId),
    getPilotSite(participant.siteId),
    participant.studyArmId ? getPilotStudyArm(participant.studyArmId) : null,
    listScreeningRecords(participant.id),
    listEligibilityDecisions(participant.id),
    listConsentRecords(participant.id),
    listWithdrawals(participant.id),
    listAllocations(participant.id),
    listAllocationOverrides(participant.id),
    listProtocolAssignments(participant.id),
    listProtocolAssignmentOverrides(participant.id),
    listEligibilityOverrides(participant.id),
    listSessionSchedules(participant.id),
    listAdherenceRecords(participant.id),
    listProtocolDeviations(participant.id),
    listOutcomeAssessmentInstances(participant.id),
    listOutcomeAssessmentSchedules(participant.id),
    listOutcomeAssessmentDefinitions(participant.studyId),
    listClinicianDeliveredSessions(participant.id),
    listClinicianSessionReviews(participant.id),
    getParticipant(participant.runtimeParticipantId),
    getLocalDb().safetyEvents.where("participantId").equals(participant.runtimeParticipantId).toArray(),
    evaluateSessionAvailability(participant.id),
  ]);
  return {
    participant: redactPilotParticipantForActor(participant),
    study,
    site,
    arm,
    screening,
    eligibility,
    consent,
    withdrawals,
    allocations,
    allocationOverrides,
    assignments,
    assignmentOverrides,
    eligibilityOverrides,
    schedules,
    adherence,
    deviations,
    outcomes,
    outcomeSchedules,
    outcomeDefinitions,
    clinicianSessions,
    clinicianReviews,
    runtimeParticipant: isResearchAnalystActor() ? null : runtimeParticipant,
    safetyEvents: isResearchAnalystActor() ? [] : safetyEvents,
    availability,
  };
}

export async function completeScreening(studyParticipantId: string) {
  const currentActor = await requirePilotPermission("screening_manage", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  const record: ParticipantScreeningRecord = {
    id: makeId("SCR"),
    studyId: participant.studyId,
    studyParticipantId,
    screeningVersion: "demo-screening-v1",
    results: [
      { criterionId: "age-range", label: "Demo participation age-range confirmation", category: "inclusion", result: "met" },
      { criterionId: "locale", label: "Supported locale confirmation", category: "operational", result: "met" },
      { criterionId: "device", label: "Device access confirmation", category: "operational", result: "met" },
      { criterionId: "consent", label: "Demo consent comprehension confirmation", category: "inclusion", result: "met" },
      { criterionId: "oversight", label: "Human safety oversight availability", category: "operational", result: "met" },
    ],
    status: "complete",
    completedBy: currentActor.id,
    completedAt: now(),
    createdAt: now(),
    updatedAt: now(),
  };
  await saveScreeningRecord(record);
  const next = { ...participant, status: "screening" as StudyParticipantStatus, screeningRecordId: record.id, updatedAt: now() };
  await savePilotParticipant(next);
  await audit("Pilot screening completed", `PilotParticipant ${studyParticipantId}`, JSON.stringify(participant), JSON.stringify(record), "Demo screening completed");
  return record;
}

export async function decideEligibility(studyParticipantId: string) {
  const currentActor = await requirePilotPermission("eligibility_decide", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  const screening = (await listScreeningRecords(studyParticipantId)).at(-1);
  if (!screening || screening.status !== "complete") throw new Error("Screening incomplete");
  const decision: EligibilityDecision = {
    id: makeId("ELG"),
    studyParticipantId,
    screeningRecordId: screening.id,
    decision: screening.results.some((item) => item.result === "unknown") ? "pending_review" : "eligible",
    reasonCodes: screening.results.filter((item) => item.result !== "met").map((item) => item.criterionId),
    decidedBy: currentActor.id,
    decidedAt: now(),
    overridden: false,
  };
  await saveEligibilityDecision(decision);
  const nextStatus: StudyParticipantStatus = decision.decision === "eligible" ? "eligible" : decision.decision === "pending_review" ? "screening" : "screen_failed";
  await savePilotParticipant({ ...participant, eligibilityDecisionId: decision.id, status: nextStatus, updatedAt: now() });
  await audit("Eligibility decided", `PilotParticipant ${studyParticipantId}`, "", JSON.stringify(decision), `Decision ${decision.decision}`);
  return decision;
}

export async function overrideEligibilityDecision(input: {
  studyParticipantId: string;
  decisionId: string;
  newDecision: "eligible" | "not_eligible" | "pending_review";
  reason: string;
}) {
  const currentActor = await requirePilotPermission("eligibility_override", "EligibilityDecision", input.decisionId);
  const participant = await requirePilotParticipant(input.studyParticipantId);
  const existing = (await listEligibilityDecisions(input.studyParticipantId)).find((item) => item.id === input.decisionId);
  if (!existing) throw new Error("Eligibility decision not found");
  const nextDecision: EligibilityDecision = {
    ...existing,
    decision: input.newDecision,
    overridden: true,
    overrideReason: input.reason,
    overriddenBy: currentActor.id,
    overriddenAt: now(),
  };
  const overrideRecord: EligibilityOverrideRecord = {
    id: makeId("EOV"),
    studyParticipantId: input.studyParticipantId,
    eligibilityDecisionId: input.decisionId,
    previousDecision: existing.decision,
    newDecision: input.newDecision,
    reason: input.reason,
    actorId: currentActor.id,
    actorRole: currentActor.role,
    impactReviewRequired: Boolean(participant.enrollmentId || participant.allocationId),
    linkedDataQualityIssueIds: [],
    createdAt: now(),
  };
  await saveEligibilityDecision(nextDecision);
  await saveEligibilityOverrideRecord(overrideRecord);
  const nextStatus: StudyParticipantStatus = input.newDecision === "eligible" ? "eligible" : input.newDecision === "pending_review" ? "screening" : "screen_failed";
  await savePilotParticipant({ ...participant, status: nextStatus, eligibilityDecisionId: nextDecision.id, updatedAt: now() });
  if (overrideRecord.impactReviewRequired) {
    const issueId = makeId("DQI");
    await saveResearchDataQualityIssue({
      id: issueId,
      studyParticipantId: participant.id,
      category: "allocation",
      severity: "critical",
      title: "Eligibility override requires enrollment/allocation impact review",
      status: "open",
      createdAt: now(),
      updatedAt: now(),
    });
    overrideRecord.linkedDataQualityIssueIds.push(issueId);
    await saveEligibilityOverrideRecord(overrideRecord);
  }
  await audit("Eligibility overridden", `PilotParticipant ${input.studyParticipantId}`, JSON.stringify(existing), JSON.stringify(overrideRecord), input.reason);
  return overrideRecord;
}

export async function acceptDemoConsent(studyParticipantId: string) {
  const currentActor = await requirePilotPermission("consent_record", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  const consent: StudyConsentRecord = {
    id: makeId("CON"),
    studyId: participant.studyId,
    studyParticipantId,
    consentVersion: "demo-consent-v1",
    locale: participant.countryCode === "BR" ? "pt-BR" : participant.countryCode === "FR" ? "fr-FR" : "ko-KR",
    status: "accepted",
    studyParticipationAllowed: true,
    treatmentDataCollectionAllowed: true,
    researchDataUseAllowed: true,
    crossSessionMemoryAllowed: true,
    sensitiveMemoryAllowed: false,
    deidentifiedExportAllowed: true,
    presentedAt: now(),
    respondedAt: now(),
    recordedBy: currentActor.id,
    createdAt: now(),
    updatedAt: now(),
  };
  await saveConsentRecord(consent);
  await savePilotParticipant({
    ...participant,
    status: "consented",
    consentRecordIds: [...participant.consentRecordIds, consent.id],
    currentConsentRecordId: consent.id,
    updatedAt: now(),
  });
  const runtimeParticipant = await getParticipant(participant.runtimeParticipantId);
  if (runtimeParticipant) {
    await updateParticipant(runtimeParticipant.id, {
      consent: {
        ...runtimeParticipant.consent,
        crossSessionUseAllowed: consent.crossSessionMemoryAllowed,
        sensitiveMemoryAllowed: consent.sensitiveMemoryAllowed,
        updatedAt: now(),
      },
    });
  }
  await audit("Demo consent accepted", `PilotParticipant ${studyParticipantId}`, "", JSON.stringify(consent), "Demo consent accepted");
  return consent;
}

export async function withdrawStudyConsent(studyParticipantId: string, reason = "Participant requested demo withdrawal") {
  await requirePilotPermission("consent_withdraw", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  if (!participant.currentConsentRecordId) throw new Error("Consent missing");
  const record = (await listConsentRecords(studyParticipantId)).find((item) => item.id === participant.currentConsentRecordId);
  if (!record) throw new Error("Consent record missing");
  const withdrawn: StudyConsentRecord = { ...record, status: "withdrawn", withdrawnAt: now(), withdrawalReason: reason, updatedAt: now() };
  await saveConsentRecord(withdrawn);
  const withdrawal = {
    id: makeId("WDR"),
    studyParticipantId,
    consentRecordId: record.id,
    effectiveAt: now(),
    reason,
    stopNewSessions: true,
    stopCrossSessionMemoryUse: true,
    stopNewResearchExport: true,
    dataDisposition: "exclude_from_future_analysis" as const,
    createdAt: now(),
  };
  await saveWithdrawalRecord(withdrawal);
  await savePilotParticipant({ ...participant, status: "withdrawn", withdrawnAt: now(), updatedAt: now() });
  await audit("Study consent withdrawn", `PilotParticipant ${studyParticipantId}`, JSON.stringify(record), JSON.stringify(withdrawn), reason);
  return withdrawal;
}

export async function enrollPilotParticipant(studyParticipantId: string) {
  const currentActor = await requirePilotPermission("enrollment_manage", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  const study = await getPilotStudy(participant.studyId);
  const site = await getPilotSite(participant.siteId);
  const eligibility = (await listEligibilityDecisions(studyParticipantId)).at(-1);
  const consent = (await listConsentRecords(studyParticipantId)).at(-1);
  if (!study || !site) throw new Error("Study or site missing");
  if (study.status === "paused" || study.status === "completed") throw new Error("Study paused");
  if (site.status !== "recruiting" && site.status !== "ready") throw new Error("Site not recruiting");
  if (!eligibility || eligibility.decision !== "eligible") throw new Error("Eligibility pending");
  if (!consent || consent.status !== "accepted") throw new Error("Consent missing");
  const existing = (await listEnrollments(studyParticipantId)).find((item: StudyEnrollment) => item.status === "enrolled");
  if (existing) throw new Error("Enrollment duplicate");
  const enrollment: StudyEnrollment = {
    id: makeId("ENR"),
    studyId: participant.studyId,
    studyParticipantId,
    siteId: participant.siteId,
    eligibilityDecisionId: eligibility.id,
    consentRecordId: consent.id,
    status: "enrolled",
    enrolledBy: currentActor.id,
    enrolledAt: now(),
    createdAt: now(),
    updatedAt: now(),
  };
  await saveEnrollment(enrollment);
  await savePilotParticipant({ ...participant, status: "enrolled", enrollmentId: enrollment.id, enrolledAt: enrollment.enrolledAt, updatedAt: now() });
  await audit("Participant enrolled", `PilotParticipant ${studyParticipantId}`, "", JSON.stringify(enrollment), "Enrollment completed");
  return enrollment;
}

export async function allocatePilotParticipant(studyParticipantId: string) {
  const currentActor = await requirePilotPermission("allocation_execute", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  if (participant.status !== "enrolled") throw new Error("Enrollment required");
  if (participant.allocationId) throw new Error("Duplicate allocation");
  const arms = (await listPilotStudyArms(participant.studyId)).filter((item) => item.active);
  const allocations = await listAllocations();
  const counts = new Map<string, number>();
  allocations.forEach((item) => counts.set(item.studyArmId, (counts.get(item.studyArmId) ?? 0) + 1));
  const chosenArm = [...arms].sort((left, right) => (counts.get(left.id) ?? 0) - (counts.get(right.id) ?? 0))[0];
  if (!chosenArm) throw new Error("Allocation capacity full");
  const allocation: StudyArmAllocation = {
    id: makeId("ALC"),
    studyId: participant.studyId,
    studyParticipantId,
    siteId: participant.siteId,
    countryCode: participant.countryCode,
    studyArmId: chosenArm.id,
    method: "demo_blocked_allocation",
    blockKey: `${participant.countryCode}-BLOCK-01`,
    allocationSequence: allocations.length + 1,
    status: "assigned",
    allocatedBy: currentActor.id,
    allocatedAt: now(),
  };
  await saveAllocation(allocation);
  const releaseId = chosenArm.protocolReleaseIdsByCountry[participant.countryCode] ?? Object.values(chosenArm.protocolReleaseIdsByCountry)[0];
  await saveProtocolAssignment({
    id: makeId("PAS"),
    studyParticipantId,
    studyArmId: chosenArm.id,
    protocolReleaseId: releaseId ?? "REL-DEMO-001",
    countryCode: participant.countryCode,
    runtimeMode: chosenArm.allowedRuntimeModes[0],
    assignedBy: currentActor.id,
    assignedAt: now(),
  });
  await savePilotParticipant({
    ...participant,
    status: "allocated",
    allocationId: allocation.id,
    studyArmId: chosenArm.id,
    allocatedAt: allocation.allocatedAt,
    assignedClinicianIds: chosenArm.clinicianRequired ? ["CLIN-A"] : [],
    assignedSafetyReviewerIds: chosenArm.humanSafetyOversightRequired ? ["SAFE-R"] : [],
    updatedAt: now(),
  });
  await audit("Participant allocated", `PilotParticipant ${studyParticipantId}`, "", JSON.stringify(allocation), `Allocated to ${chosenArm.code}`);
  return allocation;
}

export async function overrideStudyArmAllocation(input: {
  studyParticipantId: string;
  previousAllocationId: string;
  newStudyArmId: string;
  reason: string;
  createDeviation?: boolean;
}) {
  const currentActor = await requirePilotPermission("allocation_override", "StudyArmAllocation", input.previousAllocationId);
  const participant = await requirePilotParticipant(input.studyParticipantId);
  const previousAllocation = (await listAllocations(input.studyParticipantId)).find((item) => item.id === input.previousAllocationId);
  if (!previousAllocation) throw new Error("Allocation not found");
  const newArm = await getPilotStudyArm(input.newStudyArmId);
  if (!newArm || !newArm.active) throw new Error("Target arm is not available");
  const activeSchedules = (await listSessionSchedules(input.studyParticipantId)).filter((item) => ["available", "started"].includes(item.status));
  if (activeSchedules.length) throw new Error("Allocation override with active session is not allowed");
  await saveAllocation({ ...previousAllocation, status: "overridden", overrideReason: input.reason });
  const newAllocation: StudyArmAllocation = {
    ...previousAllocation,
    id: makeId("ALC"),
    studyArmId: newArm.id,
    method: "manual_override",
    status: "assigned",
    overrideReason: input.reason,
    allocatedBy: currentActor.id,
    allocatedAt: now(),
    supersededAllocationId: previousAllocation.id,
  };
  await saveAllocation(newAllocation);
  const previousAssignment = [...(await listProtocolAssignments(input.studyParticipantId))].reverse().find((item) => item.active !== false);
  if (previousAssignment) {
    await saveProtocolAssignment({ ...previousAssignment, active: false, supersededById: makeId("PAS") });
  }
  const newAssignmentId = makeId("PAS");
  await saveProtocolAssignment({
    id: newAssignmentId,
    studyParticipantId: input.studyParticipantId,
    studyArmId: newArm.id,
    protocolReleaseId: newArm.protocolReleaseIdsByCountry[participant.countryCode] ?? Object.values(newArm.protocolReleaseIdsByCountry)[0] ?? "REL-DEMO-001",
    countryCode: participant.countryCode,
    runtimeMode: newArm.allowedRuntimeModes[0],
    assignedBy: currentActor.id,
    assignedAt: now(),
    active: true,
    supersedesAssignmentId: previousAssignment?.id,
  });
  let linkedDeviationId: string | undefined;
  if (input.createDeviation !== false) {
    linkedDeviationId = makeId("DEV");
    await saveProtocolDeviation({
      id: linkedDeviationId,
      studyParticipantId: input.studyParticipantId,
      category: "allocation",
      title: "Allocation override applied",
      description: input.reason,
      status: "open",
      createdAt: now(),
      updatedAt: now(),
    });
  }
  const overrideRecord: AllocationOverrideRecord = {
    id: makeId("AOV"),
    studyParticipantId: input.studyParticipantId,
    previousAllocationId: previousAllocation.id,
    previousStudyArmId: previousAllocation.studyArmId,
    newAllocationId: newAllocation.id,
    newStudyArmId: newArm.id,
    reason: input.reason,
    actorId: currentActor.id,
    actorRole: currentActor.role,
    linkedDeviationId,
    createdAt: now(),
  };
  await saveAllocationOverrideRecord(overrideRecord);
  await savePilotParticipant({
    ...participant,
    studyArmId: newArm.id,
    allocationId: newAllocation.id,
    assignedClinicianIds: newArm.clinicianRequired ? participant.assignedClinicianIds.length ? participant.assignedClinicianIds : ["CLIN-A"] : [],
    assignedSafetyReviewerIds: newArm.humanSafetyOversightRequired ? participant.assignedSafetyReviewerIds.length ? participant.assignedSafetyReviewerIds : ["SAFE-R"] : [],
    updatedAt: now(),
  });
  await audit("Allocation overridden", `PilotParticipant ${input.studyParticipantId}`, JSON.stringify(previousAllocation), JSON.stringify(overrideRecord), input.reason);
  return overrideRecord;
}

export async function overrideParticipantProtocolAssignment(input: {
  studyParticipantId: string;
  previousAssignmentId: string;
  newProtocolReleaseId: string;
  reason: string;
}) {
  const currentActor = await requirePilotPermission("protocol_override", "ParticipantProtocolAssignment", input.previousAssignmentId);
  const participant = await requirePilotParticipant(input.studyParticipantId);
  const previousAssignment = (await listProtocolAssignments(input.studyParticipantId)).find((item) => item.id === input.previousAssignmentId);
  if (!previousAssignment) throw new Error("Protocol assignment not found");
  const newAssignmentId = makeId("PAS");
  await saveProtocolAssignment({ ...previousAssignment, active: false, supersededById: newAssignmentId });
  const nextAssignment = {
    ...previousAssignment,
    id: newAssignmentId,
    protocolReleaseId: input.newProtocolReleaseId,
    assignedBy: currentActor.id,
    assignedAt: now(),
    active: true,
    supersedesAssignmentId: previousAssignment.id,
    studyArmId: participant.studyArmId ?? previousAssignment.studyArmId,
  };
  await saveProtocolAssignment(nextAssignment);
  const overrideRecord: ProtocolAssignmentOverrideRecord = {
    id: makeId("POV"),
    studyParticipantId: input.studyParticipantId,
    previousAssignmentId: previousAssignment.id,
    newAssignmentId,
    previousProtocolReleaseId: previousAssignment.protocolReleaseId,
    newProtocolReleaseId: input.newProtocolReleaseId,
    reason: input.reason,
    actorId: currentActor.id,
    actorRole: currentActor.role,
    createdAt: now(),
  };
  await saveProtocolAssignmentOverrideRecord(overrideRecord);
  await audit("Protocol assignment overridden", `PilotParticipant ${input.studyParticipantId}`, JSON.stringify(previousAssignment), JSON.stringify(overrideRecord), input.reason);
  return overrideRecord;
}

export async function createNextSessionSchedule(studyParticipantId: string) {
  await requirePilotPermission("session_schedule", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  if (participant.status === "withdrawn") throw new Error("Consent withdrawn");
  if (!participant.studyArmId) throw new Error("Allocation required");
  const site = await getPilotSite(participant.siteId);
  if (!site) throw new Error("Site missing");
  const existing = await listSessionSchedules(studyParticipantId);
  const nextIndex = existing.length + 1;
  const schedule = {
    id: makeId("SCH"),
    studyParticipantId,
    runtimeParticipantId: participant.runtimeParticipantId,
    sessionDefinitionId: `SESSION-0${Math.min(nextIndex, 3)}`,
    title: `Session ${String(nextIndex).padStart(2, "0")}`,
    plannedAt: new Date(Date.now() + nextIndex * 86400000).toISOString(),
    locale: site.locale,
    status: "scheduled" as const,
    clinicianId: participant.assignedClinicianIds[0],
    createdAt: now(),
    updatedAt: now(),
  };
  await saveSessionSchedule(schedule);
  await savePilotParticipant({ ...participant, sessionScheduleIds: [...participant.sessionScheduleIds, schedule.id], status: "active", updatedAt: now() });
  await audit("Session scheduled", `PilotParticipant ${studyParticipantId}`, "", JSON.stringify(schedule), "Scheduled next pilot session");
  return schedule;
}

export async function completeClinicianDeliveredSession(studyParticipantId: string) {
  await requirePilotPermission("clinician_session_manage", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  if (participant.status === "withdrawn") throw new Error("Consent withdrawn");
  const allocation = participant.studyArmId ? await getPilotStudyArm(participant.studyArmId) : null;
  if (!allocation || allocation.code !== "CLINICIAN_ONLY") throw new Error("Clinician-only session required");
  const schedule = (await listSessionSchedules(studyParticipantId)).find((item) => item.status === "scheduled");
  if (!schedule) throw new Error("Session blocked");
  const session = {
    id: makeId("CDS"),
    studyParticipantId,
    sessionScheduleId: schedule.id,
    clinicianId: participant.assignedClinicianIds[0] ?? "CLIN-A",
    protocolReleaseId: (await listProtocolAssignments(studyParticipantId))[0]?.protocolReleaseId ?? "REL-DEMO-001",
    checklistCompleted: true,
    completedAt: now(),
    createdAt: now(),
    updatedAt: now(),
  };
  await saveClinicianDeliveredSession(session);
  await saveSessionSchedule({ ...schedule, status: "completed", updatedAt: now() });
  const adherence = {
    id: `ADH-${participant.id}`,
    studyParticipantId,
    completedSessions: participant.completedSessionCount + 1,
    expectedSessions: participant.expectedSessionCount,
    completionRate: (participant.completedSessionCount + 1) / participant.expectedSessionCount,
    missedSessions: 0,
    updatedAt: now(),
  };
  await saveAdherenceRecord(adherence);
  await savePilotParticipant({ ...participant, completedSessionCount: participant.completedSessionCount + 1, updatedAt: now() });
  await audit("Clinician-delivered session completed", `PilotParticipant ${studyParticipantId}`, "", JSON.stringify(session), "Completed clinician-only pilot session");
  return session;
}

export async function createDeviation(studyParticipantId: string, title: string, description: string) {
  await requirePilotPermission("deviation_create", "PilotParticipant", studyParticipantId);
  const deviation: ProtocolDeviation = {
    id: makeId("DEV"),
    studyParticipantId,
    category: "session",
    title,
    description,
    status: "open",
    createdAt: now(),
    updatedAt: now(),
  };
  await saveProtocolDeviation(deviation);
  const participant = await requirePilotParticipant(studyParticipantId);
  await savePilotParticipant({ ...participant, deviationIds: [...participant.deviationIds, deviation.id], updatedAt: now() });
  await audit("Protocol deviation created", `PilotParticipant ${studyParticipantId}`, "", JSON.stringify(deviation), title);
  return deviation;
}

export async function completeAssessment(studyParticipantId: string) {
  await requirePilotPermission("assessment_manage", "PilotParticipant", studyParticipantId);
  const participant = await requirePilotParticipant(studyParticipantId);
  const record = {
    id: makeId("ASM"),
    studyParticipantId,
    scheduleLabel: "Post Session Acceptability",
    locale: participant.countryCode === "BR" ? "pt-BR" : participant.countryCode === "FR" ? "fr-FR" : "ko-KR",
    status: "completed" as const,
    dueAt: now(),
    completedAt: now(),
    summary: "Participant completed the demo feasibility and acceptability assessment.",
  };
  await saveOutcomeAssessmentInstance(record);
  await savePilotParticipant({ ...participant, assessmentInstanceIds: [...participant.assessmentInstanceIds, record.id], updatedAt: now() });
  await audit("Outcome assessment completed", `PilotParticipant ${studyParticipantId}`, "", JSON.stringify(record), "Completed demo outcome assessment");
  return record;
}

export async function createOutcomeAssessmentDefinition(studyId: string, input: { code: string; title: string; scheduleWindow: "baseline" | "post_session" | "follow_up"; locale: string; required?: boolean }) {
  await requirePilotPermission("assessment_manage", "PilotStudy", studyId);
  const definition: OutcomeAssessmentDefinition = {
    id: makeId("OAD"),
    studyId,
    code: input.code,
    title: input.title,
    scheduleWindow: input.scheduleWindow,
    locale: input.locale,
    required: input.required ?? true,
    active: true,
    createdAt: now(),
    updatedAt: now(),
  };
  await saveOutcomeAssessmentDefinition(definition);
  return definition;
}

export async function scheduleOutcomeAssessment(studyParticipantId: string, definitionId: string, dueAt: string) {
  await requirePilotPermission("assessment_manage", "PilotParticipant", studyParticipantId);
  const definition = (await listOutcomeAssessmentDefinitions()).find((item) => item.id === definitionId);
  if (!definition) throw new Error("Assessment definition missing");
  const schedule: OutcomeAssessmentSchedule = {
    id: makeId("OAS"),
    studyParticipantId,
    definitionId,
    label: definition.title,
    dueAt,
    status: "pending",
    createdAt: now(),
    updatedAt: now(),
  };
  await saveOutcomeAssessmentSchedule(schedule);
  return schedule;
}

export async function runPilotDataQuality(studyId: string) {
  await requirePilotPermission("data_quality_run", "PilotStudy", studyId);
  const participants = await listPilotParticipants(studyId);
  const existing = await listResearchDataQualityIssues();
  const created: string[] = [];
  for (const participant of participants) {
    const consent = participant.currentConsentRecordId ? (await listConsentRecords(participant.id)).find((item) => item.id === participant.currentConsentRecordId) : undefined;
    const assignment = [...(await listProtocolAssignments(participant.id))].reverse().find((item) => item.active !== false);
    if (participant.status !== "candidate" && !consent && !existing.find((item) => item.studyParticipantId === participant.id && item.title === "Consent record missing for progressed participant")) {
      const id = makeId("DQI");
      await saveResearchDataQualityIssue({ id, studyParticipantId: participant.id, category: "consent", severity: "critical", title: "Consent record missing for progressed participant", status: "open", createdAt: now(), updatedAt: now() });
      created.push(id);
    }
    if (participant.status === "allocated" && !assignment && !existing.find((item) => item.studyParticipantId === participant.id && item.title === "Allocated participant missing active protocol assignment")) {
      const id = makeId("DQI");
      await saveResearchDataQualityIssue({ id, studyParticipantId: participant.id, category: "allocation", severity: "critical", title: "Allocated participant missing active protocol assignment", status: "open", createdAt: now(), updatedAt: now() });
      created.push(id);
    }
  }
  return { issues: await listResearchDataQualityIssues(), created };
}

export async function createResearchSnapshot(studyId: string) {
  await requirePilotPermission("snapshot_create", "PilotStudy", studyId);
  const participants = (await listPilotParticipants(studyId)).filter((item) => item.status !== "withdrawn");
  const snapshot: ResearchDataSnapshot = {
    id: makeId("SNP"),
    studyId,
    status: "draft",
    participantCount: participants.length,
    includedParticipantIds: participants.map((item) => item.id),
    excludedParticipantIds: (await listPilotParticipants(studyId)).filter((item) => item.status === "withdrawn").map((item) => item.id),
    createdAt: now(),
    updatedAt: now(),
  };
  await saveResearchSnapshot(snapshot);
  await audit("Research snapshot created", `PilotStudy ${studyId}`, "", JSON.stringify(snapshot), "Created de-identified research snapshot");
  return snapshot;
}

export async function validateResearchSnapshot(snapshotId: string, note = "Validation completed") {
  const currentActor = await requirePilotPermission("snapshot_validate", "ResearchDataSnapshot", snapshotId);
  const snapshot = (await listResearchSnapshots()).find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error("Snapshot missing");
  if (snapshot.status !== "draft") throw new Error("Only draft snapshot can be validated");
  const qualityIssues = await listResearchDataQualityIssues();
  const criticalIssueCount = qualityIssues.filter((item) => item.status === "open" && item.severity === "critical").length;
  if (criticalIssueCount) throw new Error("Critical data quality issue blocks snapshot validation");
  const run: ResearchSnapshotValidationRun = {
    id: makeId("SVR"),
    snapshotId,
    studyId: snapshot.studyId,
    status: "passed",
    criticalIssueCount,
    warningIssueCount: qualityIssues.filter((item) => item.status === "open" && item.severity === "warning").length,
    validatedBy: currentActor.id,
    validatedAt: now(),
    notes: note,
  };
  await saveResearchSnapshotValidationRun(run);
  await saveResearchSnapshot({ ...snapshot, status: "validated", validationRunId: run.id, updatedAt: now() });
  return run;
}

export async function lockResearchSnapshot(snapshotId: string) {
  const currentActor = await requirePilotPermission("snapshot_lock", "ResearchDataSnapshot", snapshotId);
  const snapshot = (await listResearchSnapshots()).find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error("Snapshot missing");
  if (snapshot.status !== "validated") throw new Error("Snapshot must be validated before lock");
  const checksum = stableHash(JSON.stringify(snapshot));
  const next: ResearchDataSnapshot = { ...snapshot, status: "locked", lockedAt: now(), lockedBy: currentActor.id, datasetChecksum: checksum, updatedAt: now() };
  await saveResearchSnapshot(next);
  return next;
}

async function buildExportDataset(studyId: string, snapshot: ResearchDataSnapshot) {
  const [participants, consents, enrollments, allocations, assignments, schedules, assessments, deviations, qualityIssues] = await Promise.all([
    listPilotParticipants(studyId),
    listConsentRecords(),
    listEnrollments(),
    listAllocations(),
    listProtocolAssignments(),
    listSessionSchedules(),
    listOutcomeAssessmentInstances(),
    listProtocolDeviations(),
    listResearchDataQualityIssues(),
  ]);

  return buildResearchDataset({
    studyId,
    snapshot,
    participants,
    consents,
    enrollments,
    allocations,
    assignments,
    schedules,
    assessments,
    deviations,
    qualityIssues,
  });
}

export async function createResearchExport(studyId: string) {
  const currentActor = await requirePilotPermission("export_generate", "PilotStudy", studyId);
  const snapshot = [...(await listResearchSnapshots())].reverse().find((item) => item.studyId === studyId && item.status === "locked");
  if (!snapshot) throw new Error("Locked snapshot required");
  const criticalIssueCount = (await listResearchDataQualityIssues()).filter((item) => item.status === "open" && item.severity === "critical").length;
  if (criticalIssueCount) throw new Error("Critical data quality issue blocks export");
  const dataset = await buildExportDataset(studyId, snapshot);
  const payload = Object.fromEntries(
    Object.entries(dataset.filesContent).map(([filename, content]) => [
      filename,
      filename.endsWith(".json") ? JSON.parse(content) as unknown : content,
    ]),
  );
  const exportRecord: ResearchExport = {
    id: makeId("EXP"),
    studyId,
    snapshotId: snapshot.id,
    status: "exported",
    format: "zip",
    manifestChecksum: stableChecksum(JSON.stringify(dataset.manifest)),
    packageChecksum: stableChecksum(JSON.stringify(dataset.filesContent)),
    filename: `pilot-${studyId}-${snapshot.id}.zip`,
    includedParticipantCount: snapshot.includedParticipantIds?.length ?? 0,
    excludedParticipantCount: snapshot.excludedParticipantIds?.length ?? 0,
    payload,
    createdAt: now(),
  };
  await saveResearchExport(exportRecord);
  for (const file of dataset.files) {
    const record: ResearchExportFile = {
      ...file,
      id: `${exportRecord.id}-${file.filename}`,
      exportId: exportRecord.id,
      description: file.filename,
      createdAt: exportRecord.createdAt,
    };
    await saveResearchExportFile(record);
  }
  await audit("Research export created", `PilotStudy ${studyId}`, "", JSON.stringify({
    exportId: exportRecord.id,
    snapshotId: snapshot.id,
    fileCount: dataset.files.length,
    actorId: currentActor.id,
  }), "Created de-identified export");
  return exportRecord;
}

export async function downloadResearchExport(exportId: string) {
  const exportRecord = (await listResearchExports()).find((item) => item.id === exportId);
  if (!exportRecord) {
    throw new Error("Research export not found");
  }
  const snapshot = (await listResearchSnapshots()).find((item) => item.id === exportRecord.snapshotId);
  if (!snapshot || snapshot.status !== "locked") {
    throw new Error("Locked snapshot missing");
  }
  const dataset = await buildExportDataset(exportRecord.studyId, snapshot);
  const zipBlob = await buildResearchExportZip(dataset.filesContent);
  downloadResearchExportBlob(zipBlob, exportRecord.filename ?? `${exportId}.zip`);
  await audit("Research export downloaded", `ResearchExport ${exportId}`, "", JSON.stringify({
    exportId,
    filename: exportRecord.filename,
    fileCount: dataset.files.length,
  }), "Downloaded research export ZIP");
  return {
    exportRecord,
    files: dataset.files,
    byteLength: zipBlob.size,
  };
}

export async function generatePilotReport(studyId: string) {
  const currentActor = await requirePilotPermission("report_generate", "PilotStudy", studyId);
  const overview = await getPilotOverviewData();
  const report: PilotReport = {
    id: makeId("PRT"),
    studyId,
    title: "Demo Pilot Operations Report",
    reportType: "operations_summary",
    status: "generated",
    createdAt: now(),
    generatedBy: currentActor.id,
    generatedAt: now(),
    limitations: [
      "Demo/local-first data",
      "Feasibility-focused pilot",
      "Descriptive operational summary",
      "Not confirmatory efficacy evidence",
    ],
    payload: {
      label: "feasibility-focused",
      note: "not confirmatory efficacy evidence",
      study: overview.study?.code,
      recruitment: overview.recruitment,
      sessions: overview.sessions,
      safety: overview.safety,
      generatedBy: currentActor.id,
    },
  };
  await savePilotReport(report);
  await audit("Pilot report generated", `PilotStudy ${studyId}`, "", JSON.stringify(report), "Generated pilot operations report");
  return report;
}

export async function getPilotReports() {
  return listPilotReports();
}

export async function getPilotReportDetail(reportId: string) {
  const report = (await listPilotReports()).find((item) => item.id === reportId) ?? null;
  if (!report) return null;
  const study = await getPilotStudy(report.studyId);
  const participants = await listPilotParticipants(report.studyId);
  return { report, study, participants };
}

export async function getPilotSitesOverview() {
  const [sites, participants] = await Promise.all([listPilotSites(), listPilotParticipants()]);
  return sites.map((site) => ({
    ...site,
    activeParticipants: participants.filter((participant) => participant.siteId === site.id && ["enrolled", "allocated", "active"].includes(participant.status)).length,
  }));
}

export async function getPilotSessionsOverview() {
  const [schedules, participants] = await Promise.all([listSessionSchedules(), listPilotParticipants()]);
  return schedules.map((schedule) => ({
    schedule,
    participant: participants.find((item) => item.id === schedule.studyParticipantId),
  }));
}

export async function getPilotDataQualityOverview() {
  const issues = await listResearchDataQualityIssues();
  return {
    issues,
    critical: issues.filter((item) => item.severity === "critical" && item.status === "open").length,
  };
}

export async function getPilotExportsOverview() {
  const [snapshots, exportsData, validationRuns, exportFiles] = await Promise.all([
    listResearchSnapshots(),
    listResearchExports(),
    listResearchSnapshotValidationRuns(),
    listResearchExportFiles(),
  ]);
  return {
    snapshots,
    validationRuns,
    exportsData: exportsData.map((item) => ({
      ...item,
      files: exportFiles.filter((file) => file.exportId === item.id),
    })),
  };
}
