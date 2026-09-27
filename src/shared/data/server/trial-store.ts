// Server-only: the trial store (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend) -- reached through /api/trial/store (which
// decides who may run each op and sets `actor`) or in process from the
// server runtime (runtime-request-context.ts, actor "server").

import type { TrialStoreOp } from "@/shared/trial/trial-store-ops";
import { listEvents, logAccess, recordEvents } from "@/shared/data/server/trial/events-store";
import { finalizeSessionRecord, listSessionRecords, recordRecordDownload } from "@/shared/data/server/trial/records-store";
import { configureStudy, createAiRelease, freezeAiRelease, getStudyContext, randomizationStatus, retireAiRelease, uploadRandomizationList, upsertTherapist } from "@/shared/data/server/trial/study-store";
import {
  allocateParticipant, assignTherapist, completeParticipant, decideEligibility, enrollParticipant, getMyTrialStatus, getSessionGate, getTrialParticipant,
  listTrialParticipants, listUnregisteredAccounts, logHomework, recordConsent, recordGateEvent, recordScreening, recordVisit, registerParticipant, setDiagnosisStratum, withdrawParticipant,
} from "@/shared/data/server/trial/participants-store";
import { listAssessmentResponses, listAssessmentTasks, setInstrumentItems, submitAssessmentResponse } from "@/shared/data/server/trial/assessments-store";
import {
  checkDeterioration, createAdverseEvent, createDeviation, getMonitoringSummary, listAdverseEvents, listDeviations, listReviewTasks, lockStudy, resolveDeviation,
  resolveReviewTask, updateAdverseEvent,
} from "@/shared/data/server/trial/safety-store";

export async function dispatchTrialStoreOp(op: TrialStoreOp): Promise<unknown> {
  const actor = op.actor ?? { userId: "server", role: "server" as const };
  switch (op.op) {
    case "recordEvents": return recordEvents(op.events);
    case "listEvents": return listEvents(op.filter);
    case "logAccess": return logAccess(actor, op.entry);
    case "finalizeSessionRecord": return finalizeSessionRecord(actor, op.runtimeSessionId);
    case "listSessionRecords": return listSessionRecords(op.participantId, op.moduleNumber);
    case "recordRecordDownload": return recordRecordDownload(actor, op.download);
    case "configureStudy": return configureStudy(actor, op.config);
    case "getStudyContext": return getStudyContext();
    case "upsertTherapist": return upsertTherapist(actor, op.therapist);
    case "createAiRelease": return createAiRelease(actor, op.release);
    case "freezeAiRelease": return freezeAiRelease(actor, op.releaseId);
    case "retireAiRelease": return retireAiRelease(actor, op.releaseId, op.reason);
    case "uploadRandomizationList": return uploadRandomizationList(actor, op.listVersion, op.csv);
    case "randomizationStatus": return randomizationStatus();
    case "listTrialParticipants": return listTrialParticipants(false);
    case "listBlindedParticipants": return listTrialParticipants(true);
    case "getTrialParticipant": return getTrialParticipant(op.studyParticipantId);
    case "getMyTrialStatus": return getMyTrialStatus(actor);
    case "listUnregisteredAccounts": return listUnregisteredAccounts();
    case "registerParticipant": return registerParticipant(actor, op.participant);
    case "recordScreening": return recordScreening(actor, op.screening);
    case "decideEligibility": return decideEligibility(actor, op);
    case "recordConsent": return recordConsent(actor, op.consent);
    case "setDiagnosisStratum": return setDiagnosisStratum(actor, op.studyParticipantId, op.diagnosisStratum);
    case "enrollParticipant": return enrollParticipant(actor, op.studyParticipantId);
    case "allocateParticipant": return allocateParticipant(actor, op.studyParticipantId);
    case "assignTherapist": return assignTherapist(actor, op.studyParticipantId, op.therapistId);
    case "withdrawParticipant": return withdrawParticipant(actor, op.withdrawal);
    case "completeParticipant": return completeParticipant(actor, op.studyParticipantId);
    case "getSessionGate": {
      // recordEvent: set when a session is actually being started, so a
      // screen that only asks whether a session is available logs nothing.
      const gate = await getSessionGate(op.runtimeParticipantId, op.sessionDefinitionId, op.currentPromptVersions);
      if (op.recordEvent) await recordGateEvent(gate, { participantId: op.runtimeParticipantId, runtimeSessionId: op.runtimeSessionId });
      return gate;
    }
    case "recordVisit": return recordVisit(actor, op.visitId, op.patch);
    case "logHomework": return logHomework(actor, op.log);
    case "listAssessmentTasks": return listAssessmentTasks(actor, op);
    case "submitAssessmentResponse": return submitAssessmentResponse(actor, op.response);
    case "listAssessmentResponses": return listAssessmentResponses(op.studyParticipantId);
    case "setInstrumentItems": return setInstrumentItems(actor, op.code, op.version, op.items);
    case "listReviewTasks": return listReviewTasks(op.status);
    case "resolveReviewTask": return resolveReviewTask(actor, op.taskId, op.note);
    case "createAdverseEvent": return createAdverseEvent(actor, op.event);
    case "updateAdverseEvent": return updateAdverseEvent(actor, op.id, op.patch);
    case "listAdverseEvents": return listAdverseEvents(op.studyParticipantId);
    case "createDeviation": return createDeviation(actor, op.deviation);
    case "resolveDeviation": return resolveDeviation(actor, op.id, op.correctiveAction);
    case "listDeviations": return listDeviations(op.studyParticipantId);
    case "getMonitoringSummary": return getMonitoringSummary();
    case "checkDeterioration": return checkDeterioration(actor);
    case "lockStudy": return lockStudy(actor, op.reason);
    default: {
      const unknown: never = op;
      throw new Error(`Unknown trial store op: ${JSON.stringify(unknown)}`);
    }
  }
}
