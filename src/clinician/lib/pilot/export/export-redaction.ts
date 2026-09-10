import type { PilotStudyParticipant } from "@/types/pilot-operations";

export function redactParticipantForExport(participant: PilotStudyParticipant) {
  return {
    studyParticipantCode: participant.studyParticipantCode,
    countryCode: participant.countryCode,
    siteId: participant.siteId,
    studyArmId: participant.studyArmId ?? "unassigned",
    participantStatus: participant.status,
    completedSessionCount: participant.completedSessionCount,
    expectedSessionCount: participant.expectedSessionCount,
    enrolledAt: participant.enrolledAt ?? "",
    allocatedAt: participant.allocatedAt ?? "",
    withdrawnAt: participant.withdrawnAt ?? "",
  };
}

export function redactAliasForAnalyst(studyParticipantCode: string) {
  return `De-identified ${studyParticipantCode}`;
}
