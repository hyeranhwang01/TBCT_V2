-- Monitoring views and the database lock (.claude/TASK_SCOPE.json
-- note2026_09_28_rct_backend, M8).
--
-- study_locks: once a row exists, clinical tables refuse every write (the
-- database lock at the end of the trial); only an approved erasure
-- (tbct.allow_erasure) passes. Append-only.
--
-- Views, for researchers in the Supabase table/SQL editor and for the
-- monitoring page, all security_invoker (the caller's own permissions):
--  - participant_overview: one row per study participant, with arm;
--  - participant_overview_blinded: the same without arm or allocation (for
--    blinded assessors);
--  - enrollment_summary, visit_adherence, assessment_completion,
--    adverse_event_summary, session_fidelity, events_daily,
--    ai_adherence_monthly (the DSMB's monthly AI report, Protocol V9 p.15).

CREATE TABLE IF NOT EXISTS study_locks (
  study_id text PRIMARY KEY REFERENCES studies(id),
  locked_at timestamptz NOT NULL,
  locked_by text NOT NULL,
  reason text NOT NULL
);
DROP TRIGGER IF EXISTS study_locks_append_only ON study_locks;
CREATE TRIGGER study_locks_append_only BEFORE UPDATE OR DELETE ON study_locks
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();

CREATE OR REPLACE FUNCTION tbct_refuse_when_locked() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('tbct.allow_erasure', true), '') = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF EXISTS (SELECT 1 FROM study_locks) THEN
    RAISE EXCEPTION 'the study database is locked (% refused on %)', TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['runtime_sessions', 'runtime_messages', 'session_records', 'study_participants', 'screenings',
    'eligibility_decisions', 'study_consents', 'withdrawals', 'protocol_deviations', 'allocations', 'study_visits',
    'homework_logs', 'assessment_tasks', 'assessment_responses', 'adverse_events', 'review_tasks'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_study_lock', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION tbct_refuse_when_locked()', t || '_study_lock', t);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW participant_overview WITH (security_invoker = true) AS
  SELECT sp.id AS study_participant_id, sp.study_code, sp.runtime_participant_id, st.code AS site_code,
         sp.diagnosis_stratum, sp.status, a.arm_code, a.ai_release_id, sp.enrolled_at, sp.allocated_at, sp.withdrawn_at,
         (SELECT count(*) FROM study_visits v WHERE v.study_participant_id = sp.id AND v.status = 'completed')::int AS visits_completed,
         (SELECT count(*) FROM study_visits v WHERE v.study_participant_id = sp.id)::int AS visits_planned,
         (SELECT count(*) FROM runtime_sessions s WHERE s.participant_id = sp.runtime_participant_id AND s.is_official)::int AS ai_modules_completed,
         (SELECT count(*) FROM assessment_tasks t WHERE t.study_participant_id = sp.id AND t.status = 'completed')::int AS assessments_completed,
         (SELECT count(*) FROM assessment_tasks t WHERE t.study_participant_id = sp.id AND t.status = 'due')::int AS assessments_due,
         (SELECT count(*) FROM adverse_events e WHERE e.study_participant_id = sp.id AND e.status = 'open')::int AS open_adverse_events
  FROM study_participants sp
  JOIN sites st ON st.id = sp.site_id
  LEFT JOIN allocations a ON a.study_participant_id = sp.id;

CREATE OR REPLACE VIEW participant_overview_blinded WITH (security_invoker = true) AS
  SELECT study_participant_id, study_code, site_code, diagnosis_stratum,
         CASE WHEN status = 'allocated' THEN 'enrolled' ELSE status END AS status,
         enrolled_at, withdrawn_at, assessments_completed, assessments_due
  FROM participant_overview;

CREATE OR REPLACE VIEW enrollment_summary WITH (security_invoker = true) AS
  SELECT st.code AS site_code, coalesce(a.arm_code, '-') AS arm_code, sp.status, count(*)::int AS participants
  FROM study_participants sp JOIN sites st ON st.id = sp.site_id
  LEFT JOIN allocations a ON a.study_participant_id = sp.id
  GROUP BY st.code, coalesce(a.arm_code, '-'), sp.status;

CREATE OR REPLACE VIEW visit_adherence WITH (security_invoker = true) AS
  SELECT v.study_participant_id, v.visit_type,
         count(*)::int AS planned,
         count(*) FILTER (WHERE v.status = 'completed')::int AS completed,
         count(*) FILTER (WHERE v.status = 'missed')::int AS missed,
         count(*) FILTER (WHERE v.status = 'scheduled' AND v.window_end < current_date)::int AS overdue
  FROM study_visits v GROUP BY v.study_participant_id, v.visit_type;

CREATE OR REPLACE VIEW assessment_completion WITH (security_invoker = true) AS
  SELECT t.timepoint_code, t.instrument_code,
         count(*)::int AS tasks,
         count(*) FILTER (WHERE t.status = 'completed')::int AS completed,
         count(*) FILTER (WHERE t.status = 'missed' OR (t.status = 'due' AND t.window_end < current_date))::int AS missed_or_overdue,
         count(r.id) FILTER (WHERE r.in_window)::int AS completed_in_window
  FROM assessment_tasks t LEFT JOIN assessment_responses r ON r.id = t.response_id
  GROUP BY t.timepoint_code, t.instrument_code;

CREATE OR REPLACE VIEW adverse_event_summary WITH (security_invoker = true) AS
  SELECT coalesce(a.arm_code, '-') AS arm_code,
         count(e.id)::int AS adverse_events,
         count(e.id) FILTER (WHERE e.serious)::int AS serious,
         count(e.id) FILTER (WHERE e.serious AND e.reported_at IS NULL AND e.report_due_at < now())::int AS serious_overdue,
         count(e.id) FILTER (WHERE e.relatedness IN ('possible', 'probable', 'definite'))::int AS possibly_related
  FROM adverse_events e
  LEFT JOIN allocations a ON a.study_participant_id = e.study_participant_id
  GROUP BY coalesce(a.arm_code, '-');

CREATE OR REPLACE VIEW session_fidelity WITH (security_invoker = true) AS
  SELECT r.participant_id, r.module_number, r.session_number, r.attempt_number, r.end_status, r.is_official_at_write,
         (r.snapshot -> 'fidelity' ->> 'totalSteps')::int AS total_steps,
         (r.snapshot -> 'fidelity' ->> 'completedSteps')::int AS completed_steps,
         r.snapshot -> 'fidelity' -> 'skippedSteps' AS skipped_steps,
         r.snapshot -> 'fidelity' -> 'orderDeviations' AS order_deviations,
         r.created_at
  FROM session_records r;

CREATE OR REPLACE VIEW events_daily WITH (security_invoker = true) AS
  SELECT date_trunc('day', created_at)::date AS day, category, code, severity, count(*)::int AS events,
         round(avg(latency_ms))::int AS mean_latency_ms
  FROM runtime_events GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW ai_adherence_monthly WITH (security_invoker = true) AS
  WITH records AS (
    SELECT date_trunc('month', created_at)::date AS month,
           count(*)::int AS ended_sessions,
           count(*) FILTER (WHERE end_status = 'completed')::int AS completed_sessions,
           round(avg(((snapshot -> 'fidelity' ->> 'completedSteps')::numeric) / nullif((snapshot -> 'fidelity' ->> 'totalSteps')::numeric, 0)), 3) AS mean_step_completion
    FROM session_records GROUP BY 1
  ), off_protocol AS (
    SELECT date_trunc('month', created_at)::date AS month, count(*)::int AS off_protocol_events
    FROM runtime_events
    WHERE code IN ('AUTHORSHIP_BLOCKED', 'FIELD_REJECTED', 'STEP_SKIPPED', 'STEP_MISMATCH', 'SAFETY_CLARIFICATION')
    GROUP BY 1
  )
  SELECT r.month, r.ended_sessions, r.completed_sessions, r.mean_step_completion, coalesce(o.off_protocol_events, 0) AS off_protocol_events
  FROM records r LEFT JOIN off_protocol o ON o.month = r.month;

REVOKE ALL ON participant_overview, participant_overview_blinded, enrollment_summary, visit_adherence,
  assessment_completion, adverse_event_summary, session_fidelity, events_daily, ai_adherence_monthly FROM anon;
