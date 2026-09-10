import { scoreInstrument, INSTRUMENTS } from "@/shared/standardized-assessments/instruments";
import {
  saveStandardizedAssessmentResponse,
  listStandardizedAssessmentResponsesByParticipant,
  listAllStandardizedAssessmentResponses,
} from "@/shared/data/repositories/standardized-assessment-repository";
import type { StandardizedAssessmentResponse, StandardizedInstrumentId } from "@/types/standardized-assessment";

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Scores and persists one PHQ-9/GAD-7 response. Callers should check
 * selfHarmFlag on the result and, if true, dispatch a safety alert the
 * same way runtime-execution-api.ts does for an in-session escalation
 * (POST /api/notifications/safety-alert) -- deliberately NOT folded into
 * this function itself, since that route call is a client-side fetch and
 * this module is meant to stay callable from either side. This does NOT
 * create a SafetyEvent row: SafetyEvent's schema assumes a runtime session
 * (runtimeSessionId, sourceMessageIds, ...), and a standalone check-in has
 * none of those -- fabricating placeholder values would misrepresent the
 * signal's real provenance to whoever reviews it later. The email alert
 * plus the selfHarmFlag surfaced in the clinician UI (see
 * getCohortAssessmentSummary and patient-detail-page.tsx) is the honest
 * equivalent for this kind of signal. */
export async function submitStandardizedAssessment(
  participantId: string,
  instrumentId: StandardizedInstrumentId,
  answers: number[],
): Promise<StandardizedAssessmentResponse> {
  const { totalScore, severity } = scoreInstrument(instrumentId, answers);
  const definition = INSTRUMENTS[instrumentId];
  const selfHarmFlag = definition.selfHarmItemIndex !== undefined ? answers[definition.selfHarmItemIndex] > 0 : undefined;
  const now = new Date().toISOString();
  const response: StandardizedAssessmentResponse = {
    id: makeId("SAR"),
    participantId,
    instrument: instrumentId,
    answers,
    totalScore,
    severity,
    selfHarmFlag,
    submittedAt: now,
    createdAt: now,
  };
  return saveStandardizedAssessmentResponse(response);
}

export async function listStandardizedAssessments(participantId: string): Promise<StandardizedAssessmentResponse[]> {
  return listStandardizedAssessmentResponsesByParticipant(participantId);
}

export { listAllStandardizedAssessmentResponses };

export interface CohortAssessmentSummaryRow {
  instrument: StandardizedInstrumentId;
  averageLatestScore: number;
  sampleSize: number;
  selfHarmFlagCount: number;
}

/** Every participant's single most recent response per instrument -- the
 * shared building block for both summarizeCohortAssessments and
 * latestSelfHarmFlaggedParticipantIds below, so a caller that needs both
 * (see patient-list-page.tsx) fetches the full response list once and
 * derives both views from it, rather than two separate cohort-wide reads. */
function latestResponsesByParticipantAndInstrument(responses: StandardizedAssessmentResponse[]): StandardizedAssessmentResponse[] {
  const latest = new Map<string, StandardizedAssessmentResponse>();
  for (const response of responses) {
    const key = `${response.participantId}:${response.instrument}`;
    const existing = latest.get(key);
    if (!existing || response.submittedAt > existing.submittedAt) latest.set(key, response);
  }
  return Array.from(latest.values());
}

/** Clinician-facing cohort rollup: for each instrument, the average of
 * every participant's MOST RECENT response, plus how many participants
 * currently have a self-harm flag on their latest PHQ-9 ("currently" --
 * this clears itself the moment that participant's next check-in scores
 * the item at 0, there's no separate acknowledge/resolve workflow for it,
 * matching how the rest of this "needs attention" style view works). */
export function summarizeCohortAssessments(responses: StandardizedAssessmentResponse[]): CohortAssessmentSummaryRow[] {
  const rowsByInstrument = new Map<StandardizedInstrumentId, StandardizedAssessmentResponse[]>();
  for (const response of latestResponsesByParticipantAndInstrument(responses)) {
    const list = rowsByInstrument.get(response.instrument) ?? [];
    list.push(response);
    rowsByInstrument.set(response.instrument, list);
  }
  return Array.from(rowsByInstrument.entries()).map(([instrument, instrumentResponses]) => ({
    instrument,
    averageLatestScore: Math.round((instrumentResponses.reduce((sum, r) => sum + r.totalScore, 0) / instrumentResponses.length) * 10) / 10,
    sampleSize: instrumentResponses.length,
    selfHarmFlagCount: instrumentResponses.filter((r) => r.selfHarmFlag).length,
  }));
}

/** Participant ids whose latest PHQ-9 response has selfHarmFlag set -- see
 * summarizeCohortAssessments's doc comment for the "currently" caveat. */
export function latestSelfHarmFlaggedParticipantIds(responses: StandardizedAssessmentResponse[]): Set<string> {
  return new Set(
    latestResponsesByParticipantAndInstrument(responses)
      .filter((response) => response.selfHarmFlag)
      .map((response) => response.participantId),
  );
}

/** Convenience wrapper for a caller that only needs the summary (fetches
 * internally) -- patient-list-page.tsx needs both this and
 * latestSelfHarmFlaggedParticipantIds, so it calls
 * listAllStandardizedAssessmentResponses itself once and derives both from
 * the same list instead of using this wrapper. */
export async function getCohortAssessmentSummary(): Promise<CohortAssessmentSummaryRow[]> {
  return summarizeCohortAssessments(await listAllStandardizedAssessmentResponses());
}
