import { redactParticipantForExport } from "@/clinician/lib/pilot/export/export-redaction";
import { serializeCsv } from "@/clinician/lib/pilot/export/csv-serializer";
import { stableChecksum } from "@/clinician/lib/pilot/export/export-checksum";
import { buildDatasetManifest } from "@/clinician/lib/pilot/export/dataset-manifest-builder";
import type {
  OutcomeAssessmentInstance,
  ParticipantProtocolAssignment,
  PilotStudyParticipant,
  ProtocolDeviation,
  ResearchDataQualityIssue,
  ResearchDataSnapshot,
  ResearchExportFile,
  StudyArmAllocation,
  StudyConsentRecord,
  StudyEnrollment,
  StudySessionSchedule,
} from "@/types/pilot-operations";

export function buildResearchDataset(input: {
  studyId: string;
  snapshot: ResearchDataSnapshot;
  participants: PilotStudyParticipant[];
  consents: StudyConsentRecord[];
  enrollments: StudyEnrollment[];
  allocations: StudyArmAllocation[];
  assignments: ParticipantProtocolAssignment[];
  schedules: StudySessionSchedule[];
  assessments: OutcomeAssessmentInstance[];
  deviations: ProtocolDeviation[];
  qualityIssues: ResearchDataQualityIssue[];
}) {
  const includedParticipants = input.participants
    .filter((participant) => input.snapshot.includedParticipantIds?.includes(participant.id))
    .sort((left, right) => left.countryCode.localeCompare(right.countryCode) || left.studyParticipantCode.localeCompare(right.studyParticipantCode));

  const participantsRows = includedParticipants.map((participant) => {
    const consent = input.consents.find((item) => item.studyParticipantId === participant.id && item.id === participant.currentConsentRecordId);
    const enrollment = input.enrollments.find((item) => item.studyParticipantId === participant.id && item.status === "enrolled");
    const allocation = [...input.allocations].reverse().find((item) => item.studyParticipantId === participant.id);
    const redacted = redactParticipantForExport(participant);
    return {
      study_participant_code: redacted.studyParticipantCode,
      country_code: redacted.countryCode,
      site_id: redacted.siteId,
      arm_code: redacted.studyArmId,
      participant_status: redacted.participantStatus,
      consent_status: consent?.status ?? "missing",
      enrollment_status: enrollment?.status ?? "pending",
      allocation_status: allocation?.status ?? "pending",
      enrolled_date: redacted.enrolledAt,
      allocated_date: redacted.allocatedAt,
      completed_session_count: redacted.completedSessionCount,
      expected_session_count: redacted.expectedSessionCount,
      withdrawal_flag: participant.status === "withdrawn",
      export_included: true,
    };
  });

  const enrollmentRows = includedParticipants.map((participant) => {
    const eligibility = participant.eligibilityDecisionId;
    const consent = input.consents.find((item) => item.studyParticipantId === participant.id && item.id === participant.currentConsentRecordId);
    const enrollment = input.enrollments.find((item) => item.studyParticipantId === participant.id && item.status === "enrolled");
    return {
      study_participant_code: participant.studyParticipantCode,
      site_id: participant.siteId,
      eligibility_decision: eligibility ?? "",
      consent_version: consent?.consentVersion ?? "",
      consent_status: consent?.status ?? "missing",
      enrollment_status: enrollment?.status ?? "pending",
      enrolled_date: enrollment?.enrolledAt ?? "",
      withdrawal_flag: participant.status === "withdrawn",
      data_disposition: participant.status === "withdrawn" ? "exclude_from_future_analysis" : "retain_existing_deidentified",
    };
  });

  const allocationRows = includedParticipants.map((participant) => {
    const allocation = [...input.allocations].reverse().find((item) => item.studyParticipantId === participant.id);
    return {
      study_participant_code: participant.studyParticipantCode,
      country_code: participant.countryCode,
      arm_code: participant.studyArmId ?? "",
      allocation_method: allocation?.method ?? "",
      allocation_status: allocation?.status ?? "",
      allocation_date: allocation?.allocatedAt ?? "",
      override_flag: allocation?.method === "manual_override",
      previous_arm_code: allocation?.supersededAllocationId ?? "",
      allocation_sequence: allocation?.allocationSequence ?? "",
    };
  });

  const assignmentRows = includedParticipants.map((participant) => {
    const assignment = [...input.assignments].reverse().find((item) => item.studyParticipantId === participant.id);
    return {
      study_participant_code: participant.studyParticipantCode,
      arm_code: participant.studyArmId ?? "",
      country_code: participant.countryCode,
      protocol_id: "TBCT-BR-001",
      protocol_release_id: assignment?.protocolReleaseId ?? "",
      protocol_version: assignment?.protocolReleaseId ?? "",
      locale: participant.countryCode === "BR" ? "pt-BR" : participant.countryCode === "FR" ? "fr-FR" : "ko-KR",
      assignment_active: assignment?.active !== false,
      assigned_date: assignment?.assignedAt ?? "",
      superseded_flag: Boolean(assignment?.supersedesAssignmentId),
    };
  });

  const sessionRows = input.schedules
    .filter((schedule) => includedParticipants.some((participant) => participant.id === schedule.studyParticipantId))
    .map((schedule, index) => {
      const participant = includedParticipants.find((item) => item.id === schedule.studyParticipantId)!;
      return {
        study_participant_code: participant.studyParticipantCode,
        session_record_id: schedule.id,
        session_delivery_mode: participant.studyArmId === "ARM-CLIN" ? "clinician_delivered" : "runtime",
        session_number: index + 1,
        session_definition_id: schedule.sessionDefinitionId,
        protocol_release_id: [...input.assignments].reverse().find((item) => item.studyParticipantId === participant.id)?.protocolReleaseId ?? "",
        session_status: schedule.status,
        scheduled_date: schedule.plannedAt,
      };
    });

  const adherenceRows = includedParticipants.map((participant) => ({
    study_participant_code: participant.studyParticipantCode,
    completed_session_count: participant.completedSessionCount,
    expected_session_count: participant.expectedSessionCount,
    completion_rate: participant.expectedSessionCount ? participant.completedSessionCount / participant.expectedSessionCount : 0,
  }));

  const assessmentRows = input.assessments
    .filter((item) => includedParticipants.some((participant) => participant.id === item.studyParticipantId))
    .map((item) => {
      const participant = includedParticipants.find((row) => row.id === item.studyParticipantId)!;
      return {
        study_participant_code: participant.studyParticipantCode,
        schedule_label: item.scheduleLabel,
        locale: item.locale,
        status: item.status,
        due_at: item.dueAt,
        completed_at: item.completedAt ?? "",
      };
    });

  const safetySummaryRows = includedParticipants.map((participant) => ({
    study_participant_code: participant.studyParticipantCode,
    safety_event_count: 0,
    intervention_count: 0,
    hold_count: 0,
  }));

  const deviationRows = input.deviations
    .filter((item) => includedParticipants.some((participant) => participant.id === item.studyParticipantId))
    .map((item) => {
      const participant = includedParticipants.find((row) => row.id === item.studyParticipantId)!;
      return {
        study_participant_code: participant.studyParticipantCode,
        category: item.category,
        status: item.status,
        title: item.title,
      };
    });

  const dataQualityRows = input.qualityIssues
    .filter((item) => !item.studyParticipantId || includedParticipants.some((participant) => participant.id === item.studyParticipantId))
    .map((item) => ({
      study_participant_id: item.studyParticipantId ?? "",
      category: item.category,
      severity: item.severity,
      status: item.status,
      title: item.title,
    }));

  const filesContent: Record<string, string> = {
    "participants.csv": serializeCsv(participantsRows, ["study_participant_code", "country_code", "site_id", "arm_code", "participant_status", "consent_status", "enrollment_status", "allocation_status", "enrolled_date", "allocated_date", "completed_session_count", "expected_session_count", "withdrawal_flag", "export_included"]),
    "enrollment.csv": serializeCsv(enrollmentRows, ["study_participant_code", "site_id", "eligibility_decision", "consent_version", "consent_status", "enrollment_status", "enrolled_date", "withdrawal_flag", "data_disposition"]),
    "allocations.csv": serializeCsv(allocationRows, ["study_participant_code", "country_code", "arm_code", "allocation_method", "allocation_status", "allocation_date", "override_flag", "previous_arm_code", "allocation_sequence"]),
    "protocol_assignments.csv": serializeCsv(assignmentRows, ["study_participant_code", "arm_code", "country_code", "protocol_id", "protocol_release_id", "protocol_version", "locale", "assignment_active", "assigned_date", "superseded_flag"]),
    "sessions.csv": serializeCsv(sessionRows, ["study_participant_code", "session_record_id", "session_delivery_mode", "session_number", "session_definition_id", "protocol_release_id", "session_status", "scheduled_date"]),
    "adherence.csv": serializeCsv(adherenceRows, ["study_participant_code", "completed_session_count", "expected_session_count", "completion_rate"]),
    "assessments.csv": serializeCsv(assessmentRows, ["study_participant_code", "schedule_label", "locale", "status", "due_at", "completed_at"]),
    "safety_summary.csv": serializeCsv(safetySummaryRows, ["study_participant_code", "safety_event_count", "intervention_count", "hold_count"]),
    "deviations.csv": serializeCsv(deviationRows, ["study_participant_code", "category", "status", "title"]),
    "data_quality.csv": serializeCsv(dataQualityRows, ["study_participant_id", "category", "severity", "status", "title"]),
    "protocol_manifest.json": JSON.stringify({
      protocolId: "TBCT-BR-001",
      releaseIds: [...new Set(assignmentRows.map((row) => row.protocol_release_id).filter(Boolean))],
    }, null, 2),
    "participants.json": JSON.stringify(participantsRows, null, 2),
    "export_audit.json": JSON.stringify({
      generatedAt: new Date().toISOString(),
      includedParticipantIds: includedParticipants.map((participant) => participant.id),
      excludedParticipantIds: input.snapshot.excludedParticipantIds ?? [],
    }, null, 2),
  };

  const draftFiles: ResearchExportFile[] = Object.entries(filesContent).map(([filename, content]) => ({
    id: `FILE-${filename}`,
    exportId: "",
    filename,
    mediaType: filename.endsWith(".csv") ? "text/csv" : "application/json",
    rowCount: filename.endsWith(".csv") ? Math.max(content.split("\n").length - 1, 0) : undefined,
    byteLength: new TextEncoder().encode(content).length,
    checksum: stableChecksum(content),
    description: filename,
    createdAt: new Date().toISOString(),
  }));

  const datasetManifest = buildDatasetManifest({
    studyId: input.studyId,
    snapshot: input.snapshot,
    files: draftFiles.map((file) => ({ ...file, filename: file.filename })),
    countries: [...new Set(participantsRows.map((row) => row.country_code))],
    arms: [...new Set(participantsRows.map((row) => row.arm_code))],
    included: input.snapshot.includedParticipantIds ?? [],
    excluded: input.snapshot.excludedParticipantIds ?? [],
  });

  filesContent["dataset_manifest.json"] = JSON.stringify(datasetManifest, null, 2);

  const files = Object.entries(filesContent).map(([filename, content]) => ({
    id: `FILE-${filename}`,
    exportId: "",
    filename,
    mediaType: filename.endsWith(".csv") ? "text/csv" as const : "application/json" as const,
    rowCount: filename.endsWith(".csv") ? Math.max(content.split("\n").length - 1, 0) : undefined,
    byteLength: new TextEncoder().encode(content).length,
    checksum: stableChecksum(content),
    description: filename,
    createdAt: new Date().toISOString(),
  }));

  return { filesContent, files, manifest: datasetManifest };
}
