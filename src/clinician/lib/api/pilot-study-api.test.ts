import { beforeAll, describe, expect, it } from "vitest";
import { setCurrentDemoActor } from "@/shared/demo-actor";
import {
  createResearchExport,
  createResearchSnapshot,
  evaluateSessionAvailability,
  getPilotParticipantDetail,
  getPilotReportDetail,
  lockResearchSnapshot,
  overrideEligibilityDecision,
  overrideParticipantProtocolAssignment,
  overrideStudyArmAllocation,
  runPilotDataQuality,
  validateResearchSnapshot,
} from "@/clinician/lib/api/pilot-study-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { saveParticipant } from "@/shared/data/repositories/participant-repository";
import {
  saveAllocation,
  saveConsentRecord,
  saveEligibilityDecision,
  saveEnrollment,
  savePilotParticipant,
  savePilotReport,
  savePilotSite,
  savePilotStudy,
  savePilotStudyArm,
  saveProtocolAssignment,
  saveProtocolDeviation,
} from "@/shared/data/repositories/pilot-repository";

beforeAll(async () => {
  const db = getLocalDb();
  await db.open();
  const now = new Date().toISOString();
  if ((await db.pilotStudies.count()) === 0) {
    await saveParticipant({
      id: "PARTICIPANT-DEMO-01",
      projectId: "TBCT-BR-001",
      alias: "Demo Participant 01",
      locale: "ko-KR",
      status: "active",
      runtimeSessionIds: [],
      longitudinalRecordId: "LR-DEMO-01",
      consent: {
        memoryStorageAllowed: true,
        crossSessionUseAllowed: true,
        sensitiveMemoryAllowed: false,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    await savePilotStudy({
      id: "PILOT-STUDY-01",
      projectId: "TBCT-BR-001",
      code: "TBCT-PILOT-001",
      title: "TBCT 3-Arm Demo Pilot",
      description: "Demo pilot",
      status: "recruiting",
      targetSampleSize: 30,
      targetPerArm: 10,
      countries: ["BR", "FR", "KR"],
      armIds: ["ARM-CLIN", "ARM-AIC", "ARM-AIO"],
      siteIds: ["SITE-KR"],
      protocolFamilyId: "TBCT-BR-001",
      protocolReleaseIds: ["REL-DEMO-001"],
      screeningFormVersion: "demo-screening-v1",
      consentFormVersion: "demo-consent-v1",
      outcomeScheduleVersion: "demo-outcome-v1",
      feasibilityObjectives: [],
      safetyObjectives: [],
      acceptabilityObjectives: [],
      operationalObjectives: [],
      createdAt: now,
      updatedAt: now,
    });
    await savePilotStudyArm({
      id: "ARM-CLIN",
      studyId: "PILOT-STUDY-01",
      code: "CLINICIAN_ONLY",
      name: "Clinician only",
      shortLabel: "Clinician",
      description: "Clinician delivered",
      targetSampleSize: 10,
      clinicianRequired: true,
      aiRuntimeEnabled: false,
      aiLeadMode: false,
      humanSafetyOversightRequired: false,
      protocolReleaseIdsByCountry: { KR: "REL-DEMO-001" },
      allowedRuntimeModes: ["clinician_delivered"],
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await savePilotStudyArm({
      id: "ARM-AIC",
      studyId: "PILOT-STUDY-01",
      code: "AI_CLINICIAN",
      name: "AI + Clinician",
      shortLabel: "AI+C",
      description: "AI assisted clinician",
      targetSampleSize: 10,
      clinicianRequired: true,
      aiRuntimeEnabled: true,
      aiLeadMode: false,
      humanSafetyOversightRequired: false,
      protocolReleaseIdsByCountry: { KR: "REL-DEMO-001" },
      allowedRuntimeModes: ["ai_assisted_clinician"],
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await savePilotStudyArm({
      id: "ARM-AIO",
      studyId: "PILOT-STUDY-01",
      code: "AI_LED_OVERSIGHT",
      name: "AI led oversight",
      shortLabel: "AI+O",
      description: "AI led with oversight",
      targetSampleSize: 10,
      clinicianRequired: false,
      aiRuntimeEnabled: true,
      aiLeadMode: true,
      humanSafetyOversightRequired: true,
      protocolReleaseIdsByCountry: { KR: "REL-DEMO-001" },
      allowedRuntimeModes: ["ai_led_with_oversight"],
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await savePilotSite({
      id: "SITE-KR",
      studyId: "PILOT-STUDY-01",
      countryCode: "KR",
      name: "Korea Demo Site",
      locale: "ko-KR",
      timezone: "Asia/Seoul",
      status: "recruiting",
      supportedProtocolReleaseIds: ["REL-DEMO-001"],
      supportedConsentVersions: ["demo-consent-v1"],
      supportedAssessmentLanguages: ["ko-KR"],
      siteCoordinatorIds: ["RC-1"],
      clinicianIds: ["CLIN-A"],
      safetyReviewerIds: ["SAFE-R"],
      recruitmentTarget: 10,
      enrolledCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await savePilotParticipant({
      id: "SP-KR-001",
      studyId: "PILOT-STUDY-01",
      runtimeParticipantId: "PARTICIPANT-DEMO-01",
      siteId: "SITE-KR",
      countryCode: "KR",
      studyParticipantCode: "KR-P001",
      alias: "Demo Participant 01",
      status: "allocated",
      screeningRecordId: "SCR-DEMO-1",
      eligibilityDecisionId: "ELG-DEMO-1",
      consentRecordIds: ["CON-DEMO-1"],
      currentConsentRecordId: "CON-DEMO-1",
      enrollmentId: "ENR-DEMO-1",
      allocationId: "ALC-DEMO-1",
      studyArmId: "ARM-AIC",
      assignedClinicianIds: ["CLIN-A"],
      assignedSafetyReviewerIds: ["SAFE-R"],
      expectedSessionCount: 3,
      completedSessionCount: 1,
      sessionScheduleIds: [],
      assessmentInstanceIds: [],
      deviationIds: [],
      enrolledAt: now,
      allocatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await savePilotParticipant({
      id: "SP-BR-001",
      studyId: "PILOT-STUDY-01",
      runtimeParticipantId: "PARTICIPANT-BR-01",
      siteId: "SITE-KR",
      countryCode: "KR",
      studyParticipantCode: "BR-P001",
      alias: "Demo Participant BR",
      status: "consented",
      screeningRecordId: "SCR-DEMO-2",
      eligibilityDecisionId: "ELG-DEMO-2",
      consentRecordIds: ["CON-DEMO-2"],
      currentConsentRecordId: "CON-DEMO-2",
      assignedClinicianIds: [],
      assignedSafetyReviewerIds: [],
      expectedSessionCount: 3,
      completedSessionCount: 0,
      sessionScheduleIds: [],
      assessmentInstanceIds: [],
      deviationIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await saveEligibilityDecision({
      id: "ELG-DEMO-1",
      studyParticipantId: "SP-KR-001",
      screeningRecordId: "SCR-DEMO-1",
      decision: "eligible",
      reasonCodes: [],
      decidedBy: "RC-1",
      decidedAt: now,
      overridden: false,
    });
    await saveEligibilityDecision({
      id: "ELG-DEMO-2",
      studyParticipantId: "SP-BR-001",
      screeningRecordId: "SCR-DEMO-2",
      decision: "eligible",
      reasonCodes: [],
      decidedBy: "RC-1",
      decidedAt: now,
      overridden: false,
    });
    await saveConsentRecord({
      id: "CON-DEMO-1",
      studyId: "PILOT-STUDY-01",
      studyParticipantId: "SP-KR-001",
      consentVersion: "demo-consent-v1",
      locale: "ko-KR",
      status: "accepted",
      studyParticipationAllowed: true,
      treatmentDataCollectionAllowed: true,
      researchDataUseAllowed: true,
      crossSessionMemoryAllowed: true,
      sensitiveMemoryAllowed: false,
      deidentifiedExportAllowed: true,
      presentedAt: now,
      respondedAt: now,
      recordedBy: "RC-1",
      createdAt: now,
      updatedAt: now,
    });
    await saveConsentRecord({
      id: "CON-DEMO-2",
      studyId: "PILOT-STUDY-01",
      studyParticipantId: "SP-BR-001",
      consentVersion: "demo-consent-v1",
      locale: "ko-KR",
      status: "accepted",
      studyParticipationAllowed: true,
      treatmentDataCollectionAllowed: true,
      researchDataUseAllowed: true,
      crossSessionMemoryAllowed: true,
      sensitiveMemoryAllowed: false,
      deidentifiedExportAllowed: true,
      presentedAt: now,
      respondedAt: now,
      recordedBy: "RC-1",
      createdAt: now,
      updatedAt: now,
    });
    await saveEnrollment({
      id: "ENR-DEMO-1",
      studyId: "PILOT-STUDY-01",
      studyParticipantId: "SP-KR-001",
      siteId: "SITE-KR",
      eligibilityDecisionId: "ELG-DEMO-1",
      consentRecordId: "CON-DEMO-1",
      status: "enrolled",
      enrolledBy: "RC-1",
      enrolledAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await saveAllocation({
      id: "ALC-DEMO-1",
      studyId: "PILOT-STUDY-01",
      studyParticipantId: "SP-KR-001",
      siteId: "SITE-KR",
      countryCode: "KR",
      studyArmId: "ARM-AIC",
      method: "demo_blocked_allocation",
      blockKey: "KR-BLOCK-01",
      allocationSequence: 1,
      status: "assigned",
      allocatedBy: "RC-1",
      allocatedAt: now,
    });
    await saveProtocolAssignment({
      id: "PAS-DEMO-1",
      studyParticipantId: "SP-KR-001",
      studyArmId: "ARM-AIC",
      protocolReleaseId: "REL-DEMO-001",
      countryCode: "KR",
      runtimeMode: "ai_assisted_clinician",
      assignedBy: "RC-1",
      assignedAt: now,
      active: true,
    });
    await savePilotReport({
      id: "PRT-DEMO-1",
      studyId: "PILOT-STUDY-01",
      title: "Demo Pilot Operations Report",
      reportType: "operations_summary",
      status: "generated",
      generatedBy: "RC-1",
      generatedAt: now,
      createdAt: now,
      limitations: ["Demo/local-first data"],
      payload: { note: "descriptive operational summary" },
    });
  }
});

describe("pilot study stage 5 smoke", () => {
  it("opens Dexie v11 with existing pilot data and source-fidelity backup storage", async () => {
    const db = getLocalDb();
    expect(db.verno).toBe(11);
    expect(typeof db.sourceFidelityBackups).toBe("object");
    expect(typeof db.eligibilityOverrideRecords).toBe("object");
    expect(typeof db.allocationOverrideRecords).toBe("object");
    expect(typeof db.protocolAssignmentOverrideRecords).toBe("object");
    expect(typeof db.researchSnapshotValidationRuns).toBe("object");
    expect(await db.pilotStudies.count()).toBeGreaterThan(0);
    expect(await db.pilotStudyParticipants.count()).toBeGreaterThan(0);
  });

  it("evaluates participant session availability", async () => {
    const result = await evaluateSessionAvailability("SP-KR-001");
    expect(typeof result.allowed).toBe("boolean");
    expect(Array.isArray(result.blockers)).toBe(true);
  });

  it("stores eligibility override history", async () => {
    setCurrentDemoActor("SUP-1");
    const before = await getLocalDb().eligibilityOverrideRecords.count();
    const result = await overrideEligibilityDecision({
      studyParticipantId: "SP-BR-001",
      decisionId: "ELG-DEMO-2",
      newDecision: "pending_review",
      reason: "Supervisor smoke override",
    });
    expect(result.actorId).toBe("SUP-1");
    expect(await getLocalDb().eligibilityOverrideRecords.count()).toBe(before + 1);
  });

  it("stores allocation override and protocol supersession", async () => {
    setCurrentDemoActor("SUP-1");
    const result = await overrideStudyArmAllocation({
      studyParticipantId: "SP-KR-001",
      previousAllocationId: "ALC-DEMO-1",
      newStudyArmId: "ARM-AIO",
      reason: "Supervisor smoke allocation override",
      createDeviation: true,
    });
    expect(result.actorId).toBe("SUP-1");
    const assignments = await getLocalDb().participantProtocolAssignments.where("studyParticipantId").equals("SP-KR-001").toArray();
    expect(assignments.some((item) => item.active === false)).toBe(true);
    expect(assignments.some((item) => item.active === true)).toBe(true);
  });

  it("stores protocol assignment override supersession", async () => {
    setCurrentDemoActor("SUP-1");
    const activeAssignment = [...(await getLocalDb().participantProtocolAssignments.where("studyParticipantId").equals("SP-KR-001").toArray())].reverse().find((item) => item.active !== false);
    expect(activeAssignment).toBeTruthy();
    const result = await overrideParticipantProtocolAssignment({
      studyParticipantId: "SP-KR-001",
      previousAssignmentId: activeAssignment!.id,
      newProtocolReleaseId: activeAssignment!.protocolReleaseId,
      reason: "Supervisor smoke protocol override",
    });
    expect(result.previousAssignmentId).toBe(activeAssignment!.id);
    const previous = await getLocalDb().participantProtocolAssignments.get(activeAssignment!.id);
    expect(previous?.active).toBe(false);
  });

  it("creates data quality issues for a synthetic invalid participant", async () => {
    setCurrentDemoActor("RC-1");
    const db = getLocalDb();
    const syntheticId = "SP-SMOKE-001";
    const exists = await db.pilotStudyParticipants.get(syntheticId);
    if (!exists) {
      await savePilotParticipant({
        id: syntheticId,
        studyId: "PILOT-STUDY-01",
        runtimeParticipantId: "PARTICIPANT-SMOKE-001",
        siteId: "SITE-KR",
        countryCode: "KR",
        studyParticipantCode: "KR-SMOKE-001",
        alias: "Smoke Participant",
        status: "allocated",
        consentRecordIds: [],
        assignedClinicianIds: [],
        assignedSafetyReviewerIds: [],
        expectedSessionCount: 3,
        completedSessionCount: 0,
        sessionScheduleIds: [],
        assessmentInstanceIds: [],
        deviationIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    const result = await runPilotDataQuality("PILOT-STUDY-01");
    expect(result.issues.some((item) => item.studyParticipantId === syntheticId)).toBe(true);
  });

  it("creates, validates, and locks a snapshot", async () => {
    const db = getLocalDb();
    const syntheticDeviationId = "DEV-SMOKE-LOCK";
    const existing = await db.protocolDeviations.get(syntheticDeviationId);
    if (!existing) {
      await saveProtocolDeviation({
        id: syntheticDeviationId,
        studyParticipantId: "SP-SMOKE-001",
        category: "export",
        title: "Resolved smoke deviation",
        description: "Resolved before validation",
        status: "resolved",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    const openCritical = await db.researchDataQualityIssues.filter((item) => item.severity === "critical" && item.status === "open").toArray();
    for (const issue of openCritical) {
      await db.researchDataQualityIssues.put({ ...issue, status: "resolved", updatedAt: new Date().toISOString() });
    }
    setCurrentDemoActor("RC-1");
    const snapshot = await createResearchSnapshot("PILOT-STUDY-01");
    setCurrentDemoActor("SUP-1");
    const validation = await validateResearchSnapshot(snapshot.id, "Smoke validation");
    expect(validation.status).toBe("passed");
    const locked = await lockResearchSnapshot(snapshot.id);
    expect(locked.status).toBe("locked");
    expect(locked.datasetChecksum).toBeTruthy();
    await expect(validateResearchSnapshot(snapshot.id)).rejects.toThrow();
  });

  it("creates de-identified export payload without raw conversation or safety memory content", async () => {
    setCurrentDemoActor("RA-1");
    const exportRecord = await createResearchExport("PILOT-STUDY-01");
    expect(exportRecord.payload).toBeTruthy();
    expect(exportRecord.payload?.["participants.csv"]).toContain("study_participant_code,country_code,site_id,arm_code");
    expect(Array.isArray(exportRecord.payload?.["participants.json"])).toBe(true);
    expect(exportRecord.payload?.["dataset_manifest.json"]).toBeTruthy();
    expect(exportRecord.payload?.["enrollment.csv"]).toBeTruthy();
    expect(exportRecord.payload?.["protocol_assignments.csv"]).toBeTruthy();
    expect((await getLocalDb().researchExportFiles.where("exportId").equals(exportRecord.id).count())).toBeGreaterThan(3);
    const json = JSON.stringify(exportRecord.payload);
    expect(json.includes("rawMessage")).toBe(false);
    expect(json.includes("messageIds")).toBe(false);
    expect(json.includes("safety_restricted")).toBe(false);
    expect(json.includes("Demo Participant 01")).toBe(false);
    expect(exportRecord.manifestChecksum).toBeTruthy();
    expect(exportRecord.packageChecksum).toBeTruthy();
  });

  it("opens participant detail and report detail data", async () => {
    const participantDetail = await getPilotParticipantDetail("SP-KR-001");
    expect(participantDetail.availability).toBeTruthy();
    const report = await getPilotReportDetail("PRT-DEMO-1");
    expect(report?.report.id).toBe("PRT-DEMO-1");
  });
});
