import { getPgPool } from "@/shared/data/db/pg-pool";
import type { StandardizedAssessmentStoreOp } from "@/shared/runtime/standardized-assessment-store-ops";
import type { StandardizedAssessmentResponse } from "@/types/standardized-assessment";

// Server-only: the real (Postgres) implementation of the standardized
// assessment store -- reached only through
// src/app/api/standardized-assessments/store/route.ts (or, for the cron/
// server-side callers, direct import -- see listResponses's own doc
// comment), never imported by client components. Same "document row"
// writer/reader shape as homework-store.ts.

async function saveResponse(response: StandardizedAssessmentResponse): Promise<StandardizedAssessmentResponse> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO standardized_assessment_responses (id, participant_id, instrument, total_score, severity, submitted_at, created_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [response.id, response.participantId, response.instrument, response.totalScore, response.severity, response.submittedAt, response.createdAt, JSON.stringify(response)],
  );
  return response;
}

async function listResponsesByParticipant(participantId: string): Promise<StandardizedAssessmentResponse[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: StandardizedAssessmentResponse }>(
    `SELECT data FROM standardized_assessment_responses WHERE participant_id = $1 ORDER BY submitted_at DESC`,
    [participantId],
  );
  return rows.map((row) => row.data);
}

/** Every response across every participant -- used by the clinician-facing
 * cohort rollup (see getCohortAssessmentSummary in
 * standardized-assessment-api.ts). Exported directly (not just through
 * dispatchStandardizedAssessmentStoreOp) so a genuinely server-side caller
 * can read it without the cookie-authed fetch round trip -- same reasoning
 * as listRuntimeSessionRecords in runtime-session-store.ts. */
export async function listAllResponses(): Promise<StandardizedAssessmentResponse[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: StandardizedAssessmentResponse }>(
    `SELECT data FROM standardized_assessment_responses ORDER BY submitted_at DESC`,
  );
  return rows.map((row) => row.data);
}

export async function dispatchStandardizedAssessmentStoreOp(op: StandardizedAssessmentStoreOp): Promise<unknown> {
  switch (op.op) {
    case "saveResponse": return saveResponse(op.response);
    case "listResponsesByParticipant": return listResponsesByParticipant(op.participantId);
    case "listAllResponses": return listAllResponses();
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown standardized assessment store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
