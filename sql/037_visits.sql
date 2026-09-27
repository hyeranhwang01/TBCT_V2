-- Visit schedule, therapist attendance, homework logs, AI engagement
-- (.claude/TASK_SCOPE.json note2026_09_28_rct_backend, M5; Protocol V9
-- p.12-17).
--
-- study_visits: every planned contact of a participant, generated from the
-- arm's schedule_template at allocation -- 12 protocol sessions (fixed,
-- decision 2026-09-28): therapist sessions, AI sessions (with the AI module
-- they run), between-session modules, the AI-led arm's orientation and
-- coordinator calls. Each has a window; a runtime session is linked to its
-- visit when it starts (runtime_sessions.study_visit_id/session_number).
-- Therapist attendance is recorded on the visit. Mutable with history.
--
-- homework_logs: the therapist-only arm's weekly self-report (p.12).
-- Append-only.
--
-- ai_engagement_weekly: the AI engagement metrics of p.15 computed from the
-- runtime tables (minutes, interactions, sessions, official modules, mean
-- participant turns per session), per participant and study week.

CREATE TABLE IF NOT EXISTS study_visits (
  id text PRIMARY KEY,
  study_participant_id text NOT NULL REFERENCES study_participants(id),
  visit_type text NOT NULL CHECK (visit_type IN ('therapist_session', 'ai_session', 'between_module', 'orientation', 'coordinator_call')),
  number smallint NOT NULL CHECK (number BETWEEN 0 AND 12),
  ai_module_number smallint,
  window_start date NOT NULL,
  window_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled')),
  completed_at timestamptz,
  runtime_session_id text,
  therapist_id text REFERENCES therapists(id),
  attended boolean,
  duration_minutes smallint,
  modality text CHECK (modality IN ('video', 'audio', 'in_app')),
  recorded_by text,
  data jsonb NOT NULL DEFAULT '{}',
  UNIQUE (study_participant_id, visit_type, number)
);
CREATE INDEX IF NOT EXISTS study_visits_participant_idx ON study_visits (study_participant_id, window_start);

DROP TRIGGER IF EXISTS study_visits_history ON study_visits;
CREATE TRIGGER study_visits_history AFTER INSERT OR UPDATE OR DELETE ON study_visits
  FOR EACH ROW EXECUTE FUNCTION tbct_record_history();

CREATE TABLE IF NOT EXISTS homework_logs (
  id text PRIMARY KEY,
  study_participant_id text NOT NULL REFERENCES study_participants(id),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 14),
  minutes smallint NOT NULL CHECK (minutes >= 0),
  completed boolean NOT NULL,
  note text,
  logged_by text NOT NULL,
  logged_at timestamptz NOT NULL
);
DROP TRIGGER IF EXISTS homework_logs_append_only ON homework_logs;
CREATE TRIGGER homework_logs_append_only BEFORE UPDATE OR DELETE ON homework_logs
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();

CREATE OR REPLACE VIEW ai_engagement_weekly WITH (security_invoker = true) AS
  WITH per_session AS (
    SELECT sp.id AS study_participant_id, s.id AS runtime_session_id, s.is_official,
           greatest(0, floor(extract(epoch FROM (s.created_at - sp.allocated_at)) / 604800))::int + 1 AS study_week,
           least(extract(epoch FROM (coalesce(s.ended_at, s.updated_at) - s.created_at)) / 60, 120) AS minutes,
           (SELECT count(*) FROM runtime_messages m WHERE m.runtime_session_id = s.id AND m.role = 'patient') AS participant_turns
    FROM study_participants sp
    JOIN runtime_sessions s ON s.participant_id = sp.runtime_participant_id
    WHERE sp.allocated_at IS NOT NULL AND s.created_at >= sp.allocated_at
  )
  SELECT study_participant_id, study_week,
         round(sum(minutes)::numeric, 1) AS minutes,
         sum(participant_turns)::int AS interactions,
         count(*)::int AS sessions,
         count(*) FILTER (WHERE is_official)::int AS official_modules,
         round(avg(participant_turns)::numeric, 1) AS mean_turns_per_session
  FROM per_session
  GROUP BY study_participant_id, study_week;

REVOKE ALL ON ai_engagement_weekly FROM anon;
