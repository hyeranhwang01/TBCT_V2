// Review tasks, adverse events, protocol deviations, the deterioration check,
// monitoring and the database lock (sql/035, 039, 040). Server-only.

import { TrialError, makeId, select, selectOne, transaction } from "@/shared/data/server/trial/db";
import { requireStudy, studySettings } from "@/shared/data/server/trial/study-store";
import { recordEvents } from "@/shared/data/server/trial/events-store";
import type { TrialActor } from "@/shared/trial/trial-store-ops";
import type { AdverseEvent, ProtocolDeviation, ReviewTask } from "@/types/trial";

export async function listReviewTasks(status?: "open" | "done") {
  return select<ReviewTask & { studyCode: string | null }>(
    `SELECT r.*, sp.study_code FROM review_tasks r LEFT JOIN study_participants sp ON sp.id = r.study_participant_id
     ${status ? "WHERE r.status = $1" : ""} ORDER BY r.status, r.due_at`,
    status ? [status] : [],
  );
}

export async function resolveReviewTask(actor: TrialActor | undefined, taskId: string, note: string) {
  if (!note.trim()) throw new TrialError("Say what was done");
  return transaction(actor, async (db) => {
    const result = await db.query("UPDATE review_tasks SET status = 'done', resolved_by = $2, resolved_at = now(), resolution_note = $3 WHERE id = $1 AND status = 'open'", [taskId, actor?.userId ?? "server", note]);
    if (!result.rowCount) throw new TrialError("Review task not found or already done");
    return (await selectOne<ReviewTask>("SELECT * FROM review_tasks WHERE id = $1", [taskId], db))!;
  });
}

const AE_PATCHABLE: Array<keyof AdverseEvent> = ["onsetAt", "description", "serious", "seriousnessCriteria", "severity", "relatedness", "expected", "actionTaken", "outcome", "reportedAt", "status", "safetyEventId"];
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export async function createAdverseEvent(actor: TrialActor | undefined, event: Omit<AdverseEvent, "id" | "recordedBy" | "updatedAt" | "reportDueAt" | "status">) {
  return transaction(actor, async (db) => {
    const study = await requireStudy(db);
    const settings = studySettings(study);
    const detectedAt = new Date(event.detectedAt);
    if (Number.isNaN(detectedAt.getTime())) throw new TrialError("detectedAt is not a date");
    const reportDueAt = event.serious ? new Date(detectedAt.getTime() + settings.seriousReportHours * 3600_000).toISOString() : null;
    const id = makeId("AE");
    await db.query(
      `INSERT INTO adverse_events (id, study_participant_id, runtime_participant_id, safety_event_id, onset_at, detected_at, description, serious, seriousness_criteria,
         severity, relatedness, expected, action_taken, outcome, report_due_at, reported_at, status, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'open',$17)`,
      [id, event.studyParticipantId ?? null, event.runtimeParticipantId ?? null, event.safetyEventId ?? null, event.onsetAt ?? null, detectedAt.toISOString(), event.description, event.serious, event.seriousnessCriteria ?? [],
        event.severity, event.relatedness, event.expected ?? null, event.actionTaken ?? null, event.outcome, reportDueAt, event.reportedAt ?? null, actor?.userId ?? "server"],
    );
    if (event.serious) {
      await recordEvents([{ id: makeId("EVT"), participantId: event.runtimeParticipantId ?? null, category: "safety", severity: "error", code: "SERIOUS_ADVERSE_EVENT", detail: { adverseEventId: id, reportDueAt }, createdAt: new Date().toISOString() }], db);
    }
    return (await selectOne<AdverseEvent>("SELECT * FROM adverse_events WHERE id = $1", [id], db))!;
  });
}

export async function updateAdverseEvent(actor: TrialActor | undefined, id: string, patch: Partial<AdverseEvent>) {
  return transaction(actor, async (db) => {
    const current = await selectOne<AdverseEvent>("SELECT * FROM adverse_events WHERE id = $1 FOR UPDATE", [id], db);
    if (!current) throw new TrialError("Adverse event not found");
    const keys = Object.keys(patch).filter((key) => AE_PATCHABLE.includes(key as keyof AdverseEvent)) as Array<keyof AdverseEvent>;
    const unknown = Object.keys(patch).filter((key) => !AE_PATCHABLE.includes(key as keyof AdverseEvent));
    if (unknown.length) throw new TrialError(`These fields cannot be changed: ${unknown.join(", ")}`);
    const assignments = keys.map((key, index) => `${snake(key)} = $${index + 2}`);
    const values = keys.map((key) => (key === "seriousnessCriteria" ? (patch[key] as string[]) : patch[key]));
    // Becoming serious starts the reporting clock from detection.
    if (patch.serious === true && !current.reportDueAt) {
      const settings = studySettings(await requireStudy(db));
      assignments.push(`report_due_at = $${values.length + 2}`);
      values.push(new Date(new Date(current.detectedAt).getTime() + settings.seriousReportHours * 3600_000).toISOString());
    }
    assignments.push("updated_at = now()");
    await db.query(`UPDATE adverse_events SET ${assignments.join(", ")} WHERE id = $1`, [id, ...values]);
    return (await selectOne<AdverseEvent>("SELECT * FROM adverse_events WHERE id = $1", [id], db))!;
  });
}

export async function listAdverseEvents(studyParticipantId?: string) {
  return select<AdverseEvent>(`SELECT * FROM adverse_events ${studyParticipantId ? "WHERE study_participant_id = $1" : ""} ORDER BY detected_at DESC`, studyParticipantId ? [studyParticipantId] : []);
}

export async function createDeviation(actor: TrialActor | undefined, input: { studyParticipantId?: string | null; category: string; severity: "minor" | "major"; description: string }) {
  return transaction(actor, async (db) => {
    const study = await requireStudy(db);
    const id = makeId("DEV");
    await db.query(
      `INSERT INTO protocol_deviations (id, study_id, study_participant_id, category, severity, description, detected_at, detected_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7,'open')`,
      [id, study.id, input.studyParticipantId ?? null, input.category, input.severity, input.description, actor?.userId ?? "server"],
    );
    return (await selectOne<ProtocolDeviation>("SELECT * FROM protocol_deviations WHERE id = $1", [id], db))!;
  });
}

export async function resolveDeviation(actor: TrialActor | undefined, id: string, correctiveAction: string) {
  if (!correctiveAction.trim()) throw new TrialError("Describe the corrective action");
  return transaction(actor, async (db) => {
    const result = await db.query("UPDATE protocol_deviations SET status = 'resolved', corrective_action = $2, resolved_at = now() WHERE id = $1 AND status = 'open'", [id, correctiveAction]);
    if (!result.rowCount) throw new TrialError("Deviation not found or already resolved");
    return (await selectOne<ProtocolDeviation>("SELECT * FROM protocol_deviations WHERE id = $1", [id], db))!;
  });
}

export async function listDeviations(studyParticipantId?: string) {
  return select<ProtocolDeviation>(`SELECT * FROM protocol_deviations ${studyParticipantId ? "WHERE study_participant_id = $1" : ""} ORDER BY detected_at DESC`, studyParticipantId ? [studyParticipantId] : []);
}

/**
 * The DSMB's emergency trigger (Protocol V9 p.19): the share of AI-only
 * participants whose latest DASS-21 is at least `deteriorationPoints` above
 * their baseline. At or above `deteriorationShare` it opens a review task and
 * logs an error event, once per day.
 */
export async function checkDeterioration(actor: TrialActor | undefined) {
  const study = await requireStudy();
  const settings = studySettings(study);
  const rows = await select<{ studyParticipantId: string; baseline: number | null; latest: number | null }>(
    `WITH dass AS (
       SELECT r.study_participant_id, r.total, t.timepoint_code, r.completed_at,
              row_number() OVER (PARTITION BY r.study_participant_id ORDER BY r.completed_at DESC) AS latest_rank
       FROM assessment_responses r JOIN assessment_tasks t ON t.id = r.task_id
       WHERE r.instrument_code = 'DASS21' AND r.total IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM assessment_responses newer WHERE newer.supersedes_id = r.id))
     SELECT a.study_participant_id,
            (SELECT total FROM dass WHERE dass.study_participant_id = a.study_participant_id AND timepoint_code = 'baseline' ORDER BY completed_at DESC LIMIT 1)::float AS baseline,
            (SELECT total FROM dass WHERE dass.study_participant_id = a.study_participant_id AND latest_rank = 1 AND timepoint_code <> 'baseline')::float AS latest
     FROM allocations a WHERE a.arm_code = 'AI_LED'`,
  );
  const measured = rows.filter((row) => row.baseline !== null && row.latest !== null);
  const deteriorated = measured.filter((row) => (row.latest as number) - (row.baseline as number) >= settings.deteriorationPoints);
  const share = measured.length ? deteriorated.length / measured.length : 0;
  const triggered = measured.length > 0 && share >= settings.deteriorationShare;
  if (triggered) {
    await transaction(actor, async (db) => {
      const day = new Date().toISOString().slice(0, 10);
      const result = await db.query(
        `INSERT INTO review_tasks (id, source, source_ref, reason, due_at, status) VALUES ($1,'deterioration',$2,$3,now() + interval '24 hours','open')
         ON CONFLICT (source, source_ref) DO NOTHING`,
        [makeId("REV"), `dsmb-${day}`, `${deteriorated.length}/${measured.length} AI-only participants deteriorated on DASS-21 (>= ${settings.deteriorationPoints} points): DSMB emergency review (Protocol V9 p.19)`],
      );
      if (result.rowCount) {
        await recordEvents([{ id: makeId("EVT"), category: "safety", severity: "error", code: "DETERIORATION_ALERT", detail: { deteriorated: deteriorated.length, measured: measured.length, share }, createdAt: new Date().toISOString() }], db);
      }
    });
  }
  return { measured: measured.length, deteriorated: deteriorated.length, share, threshold: settings.deteriorationShare, triggered };
}

export async function getMonitoringSummary() {
  const [enrollment, visitAdherence, assessments, adverseEvents, aiAdherence, events, openReviews, randomization] = await Promise.all([
    select<Record<string, unknown>>("SELECT * FROM enrollment_summary ORDER BY site_code, arm_code, status"),
    select<Record<string, unknown>>(
      `SELECT a.arm_code, v.visit_type, sum(v.planned)::int AS planned, sum(v.completed)::int AS completed, sum(v.missed)::int AS missed, sum(v.overdue)::int AS overdue
       FROM visit_adherence v LEFT JOIN allocations a ON a.study_participant_id = v.study_participant_id GROUP BY a.arm_code, v.visit_type ORDER BY 1, 2`,
    ),
    select<Record<string, unknown>>("SELECT * FROM assessment_completion ORDER BY timepoint_code, instrument_code"),
    select<Record<string, unknown>>("SELECT * FROM adverse_event_summary ORDER BY arm_code"),
    select<Record<string, unknown>>("SELECT * FROM ai_adherence_monthly ORDER BY month DESC LIMIT 12"),
    select<Record<string, unknown>>("SELECT * FROM events_daily WHERE day >= current_date - 30 ORDER BY day DESC, events DESC"),
    select<Record<string, unknown>>("SELECT count(*)::int AS open, count(*) FILTER (WHERE due_at < now())::int AS overdue FROM review_tasks WHERE status = 'open'"),
    select<Record<string, unknown>>("SELECT stratum, count(*)::int AS total, count(used_at)::int AS used FROM randomization_lists GROUP BY stratum ORDER BY stratum"),
  ]);
  return { enrollment, visitAdherence, assessments, adverseEvents, aiAdherence, events, reviewTasks: openReviews[0] ?? { open: 0, overdue: 0 }, randomization };
}

export async function lockStudy(actor: TrialActor | undefined, reason: string) {
  if (!reason.trim()) throw new TrialError("Give the reason for locking");
  return transaction(actor, async (db) => {
    const study = await requireStudy(db);
    const open = await selectOne<{ n: number }>("SELECT count(*)::int AS n FROM adverse_events WHERE serious AND reported_at IS NULL", [], db);
    if ((open?.n ?? 0) > 0) throw new TrialError(`${open!.n} serious adverse event(s) are not reported yet`);
    await db.query("INSERT INTO study_locks (study_id, locked_at, locked_by, reason) VALUES ($1, now(), $2, $3)", [study.id, actor?.userId ?? "server", reason]);
    return { studyId: study.id, locked: true };
  });
}
