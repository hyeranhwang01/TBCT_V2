// Assessment tasks and responses (sql/038, review tasks sql/039).
// Server-only.

import { TrialError, addDays, isoDate, makeId, select, selectOne, transaction, type Queryable } from "@/shared/data/server/trial/db";
import { requireStudy, studySettings } from "@/shared/data/server/trial/study-store";
import { recordEvents } from "@/shared/data/server/trial/events-store";
import { InvalidResponseError, instrumentByCode, scoreResponse } from "@/shared/trial/instruments";
import type { TrialActor } from "@/shared/trial/trial-store-ops";
import type { ArmCode, AssessmentResponse, AssessmentTask, AssessmentTimepoint, StudyParticipant } from "@/types/trial";

/** Creates the participant's tasks for every timepoint with this anchor. The
 * arm (null before allocation) picks the arm-specific instruments. */
export async function generateTasks(db: Queryable, participant: StudyParticipant, anchor: "enrollment" | "allocation", anchorDate: Date, armCode: ArmCode | null) {
  const timepoints = await select<AssessmentTimepoint>("SELECT * FROM assessment_timepoints WHERE study_id = $1 AND anchor = $2", [participant.studyId, anchor], db);
  let created = 0;
  for (const timepoint of timepoints) {
    const codes = [...(timepoint.instruments.ALL ?? []), ...(armCode ? timepoint.instruments[armCode] ?? [] : [])];
    const occurrences = timepoint.repeatEveryDays && timepoint.repeatCount ? timepoint.repeatCount : 1;
    for (let occurrence = 1; occurrence <= occurrences; occurrence += 1) {
      const offset = (occurrence - 1) * (timepoint.repeatEveryDays ?? 0);
      for (const code of codes) {
        const instrument = instrumentByCode(code);
        if (!instrument) throw new TrialError(`Timepoint ${timepoint.code} names an unknown instrument ${code}`);
        const result = await db.query(
          `INSERT INTO assessment_tasks (id, study_participant_id, timepoint_code, instrument_code, occurrence, mode, window_start, window_end, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'due') ON CONFLICT (study_participant_id, timepoint_code, instrument_code, occurrence) DO NOTHING`,
          [makeId("TASK"), participant.id, timepoint.code, code, occurrence, instrument.mode, isoDate(addDays(anchorDate, timepoint.startDay + offset)), isoDate(addDays(anchorDate, timepoint.endDay + offset))],
        );
        created += result.rowCount ?? 0;
      }
    }
  }
  return created;
}

export async function participantForAuthUser(authUserId: string, db?: Queryable) {
  return selectOne<StudyParticipant>(
    `SELECT sp.* FROM study_participants sp JOIN runtime_participants rp ON rp.id = sp.runtime_participant_id
     WHERE rp.auth_user_id = $1 ORDER BY sp.created_at DESC LIMIT 1`,
    [authUserId],
    db,
  );
}

export async function listAssessmentTasks(actor: TrialActor | undefined, filter: { studyParticipantId?: string; mine?: boolean; mode?: "self" | "interview"; status?: string }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };
  if (actor?.role === "patient" || filter.mine) {
    const own = actor ? await participantForAuthUser(actor.userId) : undefined;
    if (!own) return [];
    add("t.study_participant_id = ?", own.id);
    add("t.mode = ?", "self");
  } else {
    if (filter.studyParticipantId) add("t.study_participant_id = ?", filter.studyParticipantId);
    // A blinded assessor sees interview tasks only: which self-report
    // instruments a participant has (CALPAS vs WAI-SR) would reveal the arm.
    if (actor?.role === "assessor") add("t.mode = ?", "interview");
    else if (filter.mode) add("t.mode = ?", filter.mode);
  }
  if (filter.status) add("t.status = ?", filter.status);
  return select<AssessmentTask & { studyCode: string }>(
    `SELECT t.*, sp.study_code FROM assessment_tasks t JOIN study_participants sp ON sp.id = t.study_participant_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY t.window_start, sp.study_code, t.instrument_code, t.occurrence`,
    params,
  );
}

const REVIEW_FOR_FLAG: Record<string, { source: "phq2_weekly" | "suicidality_item" | "cssrs"; reason: string }> = {
  suicidality: { source: "suicidality_item", reason: "Suicidality item above 0" },
  phq2_high: { source: "phq2_weekly", reason: "Weekly PHQ-2 at or above threshold" },
  cssrs_high: { source: "cssrs", reason: "C-SSRS high risk: withdraw and refer (Protocol V9 p.8)" },
  cssrs_moderate: { source: "cssrs", reason: "C-SSRS moderate risk: withdraw and refer (Protocol V9 p.8)" },
};

export async function submitAssessmentResponse(actor: TrialActor | undefined, input: { taskId: string; items: unknown[]; supersedesId?: string; correctionReason?: string }) {
  return transaction(actor, async (db) => {
    const task = await selectOne<AssessmentTask>("SELECT * FROM assessment_tasks WHERE id = $1 FOR UPDATE", [input.taskId], db);
    if (!task) throw new TrialError("Assessment task not found");
    const participant = await selectOne<StudyParticipant>("SELECT * FROM study_participants WHERE id = $1", [task.studyParticipantId], db);
    if (!participant) throw new TrialError("Participant not found");
    const correcting = Boolean(input.supersedesId);
    if (actor?.role === "patient") {
      const own = await participantForAuthUser(actor.userId, db);
      if (!own || own.id !== task.studyParticipantId || task.mode !== "self") throw new TrialError("Not your assessment");
      if (correcting) throw new TrialError("Corrections are made by the study team");
    }
    if (actor?.role === "assessor" && task.mode !== "interview" && !correcting) throw new TrialError("Assessors enter interview instruments");
    if (!correcting && task.status !== "due") throw new TrialError(`This assessment is ${task.status}`);
    if (correcting && !input.correctionReason?.trim()) throw new TrialError("A correction needs a reason");
    if (correcting) {
      const previous = await selectOne<AssessmentResponse>("SELECT * FROM assessment_responses WHERE id = $1", [input.supersedesId], db);
      if (!previous || previous.taskId !== task.id) throw new TrialError("The response being corrected does not belong to this task");
    }
    const instrument = instrumentByCode(task.instrumentCode);
    if (!instrument) throw new TrialError(`Unknown instrument ${task.instrumentCode}`);
    const study = await requireStudy(db);
    let scored;
    try {
      scored = scoreResponse(instrument, input.items, { phq2Threshold: studySettings(study).phq2Threshold });
    } catch (error) {
      if (error instanceof InvalidResponseError) throw new TrialError(error.message);
      throw error;
    }
    const now = new Date();
    const today = isoDate(now);
    const inWindow = today >= task.windowStart && today <= task.windowEnd;
    const id = makeId("RESP");
    await db.query(
      `INSERT INTO assessment_responses (id, study_participant_id, task_id, instrument_code, instrument_version, items, total, subscales, flags, mode, administered_by, completed_at, in_window, supersedes_id, correction_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, participant.id, task.id, instrument.code, instrument.version, JSON.stringify(input.items), scored.total, JSON.stringify(scored.subscales), scored.flags, task.mode, actor?.userId ?? "server", now.toISOString(), inWindow, input.supersedesId ?? null, input.correctionReason ?? null],
    );
    await db.query("UPDATE assessment_tasks SET status = 'completed', response_id = $2 WHERE id = $1", [task.id, id]);
    for (const flag of scored.flags) {
      const review = REVIEW_FOR_FLAG[flag];
      if (!review) continue;
      await db.query(
        `INSERT INTO review_tasks (id, study_participant_id, runtime_participant_id, source, source_ref, reason, due_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open') ON CONFLICT (source, source_ref) DO NOTHING`,
        [makeId("REV"), participant.id, participant.runtimeParticipantId, review.source, `${id}:${flag}`, `${review.reason} (${instrument.code})`, addDays(now, 1).toISOString()],
      );
    }
    if (scored.flags.length) {
      await recordEvents([{ id: makeId("EVT"), participantId: participant.runtimeParticipantId, category: "safety", severity: "warn", code: "ASSESSMENT_FLAG", detail: { instrument: instrument.code, flags: scored.flags, responseId: id }, createdAt: now.toISOString() }], db);
    }
    return (await selectOne<AssessmentResponse>("SELECT * FROM assessment_responses WHERE id = $1", [id], db))!;
  });
}

export async function listAssessmentResponses(studyParticipantId: string) {
  return select<AssessmentResponse>("SELECT * FROM assessment_responses WHERE study_participant_id = $1 ORDER BY completed_at, id", [studyParticipantId]);
}

export async function setInstrumentItems(actor: TrialActor | undefined, code: string, version: string, items: Record<string, string[]>) {
  return transaction(actor, async (db) => {
    const instrument = instrumentByCode(code);
    if (!instrument) throw new TrialError(`Unknown instrument ${code}`);
    for (const [locale, wording] of Object.entries(items)) {
      if (wording.length !== instrument.itemCount) throw new TrialError(`${code} (${locale}) needs ${instrument.itemCount} items, got ${wording.length}`);
    }
    const result = await db.query("UPDATE instruments SET items = $3 WHERE code = $1 AND version = $2", [code, version, JSON.stringify(items)]);
    if (!result.rowCount) throw new TrialError(`Instrument ${code} version ${version} is not configured`);
    return { code, version, locales: Object.keys(items) };
  });
}
