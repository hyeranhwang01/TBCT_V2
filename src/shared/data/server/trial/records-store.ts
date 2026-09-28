// Sealed session records and their download log (sql/034). Server-only.

import { createHash } from "node:crypto";
import { getRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";
import { TrialError, makeId, select, transaction } from "@/shared/data/server/trial/db";
import { listEvents, recordEvents } from "@/shared/data/server/trial/events-store";
import { linkEndedSessionToVisit } from "@/shared/data/server/trial/participants-store";
import { SESSION_RECORD_SCHEMA_VERSION, buildSessionSnapshot, canonicalJson } from "@/shared/trial/session-snapshot";
import type { TrialActor } from "@/shared/trial/trial-store-ops";
import type { SessionRecordRow } from "@/types/trial";

/**
 * Seals an ended session: links it to the study visit it fulfils, builds the
 * snapshot from the stores, and writes it with its hash through
 * finalize_session_record (which also marks the first completed attempt of
 * the module official). Idempotent: a second call returns the existing record.
 */
export async function finalizeSessionRecord(actor: TrialActor | undefined, runtimeSessionId: string) {
  const session = await getRuntimeSessionRecord(runtimeSessionId);
  if (!session) throw new TrialError("Runtime session not found");
  if (session.status !== "completed" && session.status !== "terminated") throw new TrialError(`Session has not ended (${session.status})`);
  await transaction(actor, (db) => linkEndedSessionToVisit(db, session));
  const events = await listEvents({ runtimeSessionId, limit: 2000 });
  const snapshot = await buildSessionSnapshot(runtimeSessionId, { events });
  const contentSha256 = createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
  const result = await transaction(actor, async (db) => {
    const { rows } = await db.query<{ record_id: string; inserted: boolean; is_official: boolean }>(
      "SELECT * FROM finalize_session_record($1, $2, $3, $4, $5)",
      [makeId("REC"), runtimeSessionId, SESSION_RECORD_SCHEMA_VERSION, contentSha256, JSON.stringify(snapshot)],
    );
    return rows[0];
  });
  if (result.inserted && snapshot.fidelity?.skippedSteps.length) {
    await recordEvents([{
      id: makeId("EVT"), participantId: session.participantId, runtimeSessionId, category: "step", severity: "warn", code: "STEP_SKIPPED",
      detail: { skippedSteps: snapshot.fidelity.skippedSteps, completedSteps: snapshot.fidelity.completedSteps, totalSteps: snapshot.fidelity.totalSteps }, createdAt: new Date().toISOString(),
    }]);
  }
  return { recordId: result.record_id, inserted: result.inserted, isOfficial: result.is_official, contentSha256: result.inserted ? contentSha256 : undefined };
}

export async function listSessionRecords(participantId: string, moduleNumber?: number) {
  return select<SessionRecordRow>(
    `SELECT * FROM session_records WHERE participant_id = $1 ${moduleNumber ? "AND module_number = $2" : ""} ORDER BY module_number, attempt_number`,
    moduleNumber ? [participantId, moduleNumber] : [participantId],
  );
}

export async function recordRecordDownload(actor: TrialActor | undefined, download: { participantId: string | null; moduleNumber: number | null; attempts: string; format: string; recordHashes: string[] }) {
  if (!actor || actor.role === "server") throw new TrialError("Downloads are recorded against a person");
  await transaction(actor, (db) =>
    db.query(
      `INSERT INTO session_record_downloads (id, downloaded_by, downloader_role, participant_id, module_number, attempts, format, record_hashes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [makeId("DL"), actor.userId, actor.role, download.participantId, download.moduleNumber, download.attempts, download.format, download.recordHashes],
    ),
  );
}
