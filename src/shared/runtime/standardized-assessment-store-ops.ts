// Shared client/server contract for the standardized clinical screening
// store (Neon/Supabase Postgres, sql/011_standardized_assessments.sql).
// Mirrors the pattern in homework-store-ops.ts: no server-only imports, so
// this is safe to import from both the repository client
// (src/lib/repositories/standardized-assessment-repository.ts) and the
// server-side store implementation
// (src/lib/server/standardized-assessment-store.ts).
import type { StandardizedAssessmentResponse } from "@/types/standardized-assessment";

export type StandardizedAssessmentStoreOp =
  | { op: "saveResponse"; response: StandardizedAssessmentResponse }
  | { op: "listResponsesByParticipant"; participantId: string }
  | { op: "listAllResponses" };

export const STANDARDIZED_ASSESSMENT_STORE_ENDPOINT = "/api/standardized-assessments/store";
