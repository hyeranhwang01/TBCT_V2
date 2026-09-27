// Queries behind scripts/export-deidentified.ts and the erasure behind
// scripts/purge-retention.ts, kept here so the tests run them against
// Postgres (src/test/pglite/trial-scripts.test.ts).
// .claude/TASK_SCOPE.json note2026_09_28_rct_backend.

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> };
type Connectable = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };

const EXCLUDED = `sp.id NOT IN (SELECT study_participant_id FROM withdrawals WHERE data_disposition IN ('exclude_from_analysis', 'erasure_requested'))`;
const DAY = (column: string) => `CASE WHEN ${column} IS NULL OR sp.enrolled_at IS NULL THEN NULL ELSE floor(extract(epoch FROM (${column}::timestamptz - sp.enrolled_at)) / 86400)::int END`;

export const EXTRACT_QUERIES: Record<string, string> = {
  participants: `SELECT sp.study_code, st.code AS site_code, sp.diagnosis_stratum, sp.status, a.arm_code, a.stratum, a.ai_release_id,
      ${DAY("a.allocated_at")} AS allocated_day, ${DAY("sp.completed_at")} AS completed_day, ${DAY("sp.withdrawn_at")} AS withdrawn_day, t.id AS therapist_id
    FROM study_participants sp JOIN sites st ON st.id = sp.site_id LEFT JOIN allocations a ON a.study_participant_id = sp.id LEFT JOIN therapists t ON t.id = sp.therapist_id
    WHERE sp.enrolled_at IS NOT NULL AND ${EXCLUDED} ORDER BY sp.study_code`,
  assessments: `SELECT sp.study_code, tk.timepoint_code, tk.occurrence, r.instrument_code, r.instrument_version, r.mode, r.items, r.total, r.subscales, r.flags, r.in_window,
      ${DAY("r.completed_at")} AS completed_day, (r.supersedes_id IS NOT NULL) AS is_correction
    FROM assessment_responses r JOIN study_participants sp ON sp.id = r.study_participant_id LEFT JOIN assessment_tasks tk ON tk.id = r.task_id
    WHERE NOT EXISTS (SELECT 1 FROM assessment_responses later WHERE later.supersedes_id = r.id) AND ${EXCLUDED}
    ORDER BY sp.study_code, completed_day, r.instrument_code`,
  visits: `SELECT sp.study_code, v.visit_type, v.number, v.ai_module_number, v.status, v.attended, v.duration_minutes, v.modality, v.therapist_id,
      ${DAY("v.window_start")} AS window_start_day, ${DAY("v.window_end")} AS window_end_day, ${DAY("v.completed_at")} AS completed_day
    FROM study_visits v JOIN study_participants sp ON sp.id = v.study_participant_id WHERE ${EXCLUDED} ORDER BY sp.study_code, v.visit_type, v.number`,
  homework: `SELECT sp.study_code, h.week, h.minutes, h.completed FROM homework_logs h JOIN study_participants sp ON sp.id = h.study_participant_id WHERE ${EXCLUDED} ORDER BY sp.study_code, h.week`,
  ai_sessions: `SELECT sp.study_code, r.module_number, r.session_number, r.attempt_number, r.is_official_at_write AS official, r.end_status,
      (r.snapshot -> 'fidelity' ->> 'completedSteps')::int AS steps_completed, (r.snapshot -> 'fidelity' ->> 'totalSteps')::int AS steps_total,
      jsonb_array_length(coalesce(r.snapshot -> 'fidelity' -> 'skippedSteps', '[]')) AS steps_skipped,
      (SELECT count(*) FROM jsonb_array_elements(coalesce(r.snapshot -> 'conversation', '[]')) m WHERE m ->> 'role' = 'patient')::int AS participant_turns,
      (SELECT count(*) FROM jsonb_array_elements(coalesce(r.snapshot -> 'conversation', '[]')) m WHERE m ->> 'role' = 'assistant')::int AS ai_turns,
      r.snapshot ->> 'memoryConsent' IS NOT NULL AS memory_consent_recorded, ${DAY("r.created_at")} AS sealed_day
    FROM session_records r JOIN study_participants sp ON sp.runtime_participant_id = r.participant_id WHERE ${EXCLUDED}
    ORDER BY sp.study_code, r.module_number, r.attempt_number`,
  adverse_events: `SELECT sp.study_code, e.serious, e.seriousness_criteria, e.severity, e.relatedness, e.expected, e.outcome, e.status,
      ${DAY("e.onset_at")} AS onset_day, ${DAY("e.detected_at")} AS detected_day,
      CASE WHEN e.report_due_at IS NULL THEN NULL ELSE (e.reported_at IS NOT NULL AND e.reported_at <= e.report_due_at) END AS reported_in_time
    FROM adverse_events e JOIN study_participants sp ON sp.id = e.study_participant_id WHERE ${EXCLUDED} ORDER BY sp.study_code, detected_day`,
  withdrawals: `SELECT sp.study_code, w.reason_category, w.initiated_by, w.data_disposition, ${DAY("w.withdrawn_at")} AS withdrawn_day
    FROM withdrawals w JOIN study_participants sp ON sp.id = w.study_participant_id WHERE w.data_disposition = 'retain_collected' ORDER BY sp.study_code`,
  deviations: `SELECT sp.study_code, d.category, d.severity, d.status, ${DAY("d.detected_at")} AS detected_day
    FROM protocol_deviations d JOIN study_participants sp ON sp.id = d.study_participant_id WHERE ${EXCLUDED} ORDER BY sp.study_code, detected_day`,
};


const PARTICIPANT_TABLES = ["participant_memory_chunks", "memory_chunk_retrievals", "runtime_events", "session_records"];

export type ExpiredStudy = { id: string; code: string; retentionYears: number; lockedAt: string; participants: string[]; sessionTables: string[] };

/** Studies past retention (from their database lock) and the participants
 * whose AI data would be erased: all but those whose latest
 * extended-retention consent is "granted". */
export async function findExpiredStudies(db: Queryable): Promise<ExpiredStudy[]> {
  const { rows: studies } = await db.query(
    `SELECT s.id, s.code, s.retention_years, max(l.locked_at) AS locked_at FROM studies s JOIN study_locks l ON l.study_id = s.id
     GROUP BY s.id HAVING max(l.locked_at) + make_interval(years => s.retention_years) < now()`,
  );
  // Tables holding rows keyed to a runtime session, found from the schema so
  // a table added later is not missed. Visits keep their (dangling) link.
  const { rows: keyed } = await db.query(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'runtime_session_id' AND t.table_type = 'BASE TABLE' AND c.table_name NOT IN ('study_visits', 'runtime_sessions')`,
  );
  const sessionTables = keyed.map((row) => String(row.table_name)).sort();
  const expired: ExpiredStudy[] = [];
  for (const study of studies) {
    const { rows } = await db.query(
      `SELECT sp.runtime_participant_id FROM study_participants sp WHERE sp.study_id = $1 AND coalesce((
         SELECT c.status FROM study_consents c WHERE c.study_participant_id = sp.id AND c.consent_type = 'extended_retention' ORDER BY c.decided_at DESC, c.id DESC LIMIT 1), '') <> 'granted'`,
      [study.id],
    );
    const lockedAt = study.locked_at instanceof Date ? study.locked_at.toISOString() : String(study.locked_at);
    expired.push({ id: String(study.id), code: String(study.code), retentionYears: Number(study.retention_years), lockedAt, participants: rows.map((row) => String(row.runtime_participant_id)), sessionTables });
  }
  return expired;
}

/** Erases the AI interaction data of the study's participants in one
 * transaction, with tbct.allow_erasure on. Returns rows deleted per table. */
export async function eraseStudyAiData(pool: Connectable, study: ExpiredStudy) {
  const counts: Record<string, number> = {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('tbct.allow_erasure', 'on', true), set_config('tbct.actor', 'purge-retention', true)");
    const ids = study.participants;
    for (const table of study.sessionTables) {
      counts[table] = (await client.query(`DELETE FROM ${table} WHERE runtime_session_id IN (SELECT id FROM runtime_sessions WHERE participant_id = ANY($1))`, [ids])).rowCount ?? 0;
    }
    for (const table of PARTICIPANT_TABLES) {
      counts[table] = (counts[table] ?? 0) + ((await client.query(`DELETE FROM ${table} WHERE participant_id = ANY($1)`, [ids])).rowCount ?? 0);
    }
    counts.runtime_sessions = (await client.query("DELETE FROM runtime_sessions WHERE participant_id = ANY($1)", [ids])).rowCount ?? 0;
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
