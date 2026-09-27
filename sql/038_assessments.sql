-- Outcome assessments (.claude/TASK_SCOPE.json note2026_09_28_rct_backend, M6;
-- Protocol V9 p.16-18). Self-report instruments are answered in the app;
-- interview instruments (SCID-5-CV, C-SSRS) are entered by the blinded
-- assessor (decision 2026-09-28).
--
-- instruments: structure and scoring of each instrument (code, version,
-- item count, response range, scoring rule, licence note). Item wording lives
-- in `items` (by locale) and is filled in by the research team where the
-- licence allows -- licensed wording is not shipped in the code.
-- assessment_timepoints: when each instrument is due, relative to an anchor
-- (enrolment, allocation), per arm ('ALL' or an arm code).
-- assessment_tasks: one per participant x timepoint x instrument (x week for
-- weekly ones), generated at enrolment (baseline) and allocation (the rest).
-- assessment_responses: the answers, item by item, with the computed total;
-- append-only -- a correction is a new row that supersedes the old one.

CREATE TABLE IF NOT EXISTS instruments (
  id text PRIMARY KEY,
  code text NOT NULL,
  version text NOT NULL,
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('self', 'interview')),
  item_count smallint NOT NULL,
  response_min smallint,
  response_max smallint,
  scoring jsonb NOT NULL,
  license_note text,
  items jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);
DROP TRIGGER IF EXISTS instruments_history ON instruments;
CREATE TRIGGER instruments_history AFTER INSERT OR UPDATE OR DELETE ON instruments
  FOR EACH ROW EXECUTE FUNCTION tbct_record_history();

CREATE TABLE IF NOT EXISTS assessment_timepoints (
  id text PRIMARY KEY,
  study_id text NOT NULL REFERENCES studies(id),
  code text NOT NULL CHECK (code IN ('baseline', 'mid', 'post', 'fu3m', 'weekly', 'after_first_session')),
  anchor text NOT NULL CHECK (anchor IN ('enrollment', 'allocation')),
  start_day smallint NOT NULL,
  end_day smallint NOT NULL,
  repeat_every_days smallint,
  repeat_count smallint,
  instruments jsonb NOT NULL,
  UNIQUE (study_id, code)
);
DROP TRIGGER IF EXISTS assessment_timepoints_history ON assessment_timepoints;
CREATE TRIGGER assessment_timepoints_history AFTER INSERT OR UPDATE OR DELETE ON assessment_timepoints
  FOR EACH ROW EXECUTE FUNCTION tbct_record_history();

CREATE TABLE IF NOT EXISTS assessment_tasks (
  id text PRIMARY KEY,
  study_participant_id text NOT NULL REFERENCES study_participants(id),
  timepoint_code text NOT NULL,
  instrument_code text NOT NULL,
  occurrence smallint NOT NULL DEFAULT 1,
  mode text NOT NULL CHECK (mode IN ('self', 'interview')),
  window_start date NOT NULL,
  window_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('due', 'completed', 'missed', 'cancelled')),
  response_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_participant_id, timepoint_code, instrument_code, occurrence)
);
CREATE INDEX IF NOT EXISTS assessment_tasks_due_idx ON assessment_tasks (status, window_end);
DROP TRIGGER IF EXISTS assessment_tasks_history ON assessment_tasks;
CREATE TRIGGER assessment_tasks_history AFTER INSERT OR UPDATE OR DELETE ON assessment_tasks
  FOR EACH ROW EXECUTE FUNCTION tbct_record_history();

CREATE TABLE IF NOT EXISTS assessment_responses (
  id text PRIMARY KEY,
  study_participant_id text NOT NULL REFERENCES study_participants(id),
  task_id text REFERENCES assessment_tasks(id),
  instrument_code text NOT NULL,
  instrument_version text NOT NULL,
  items jsonb NOT NULL,
  total numeric,
  subscales jsonb NOT NULL DEFAULT '{}',
  flags text[] NOT NULL DEFAULT '{}',
  mode text NOT NULL CHECK (mode IN ('self', 'interview')),
  administered_by text NOT NULL,
  completed_at timestamptz NOT NULL,
  in_window boolean NOT NULL,
  supersedes_id text REFERENCES assessment_responses(id),
  correction_reason text
);
CREATE INDEX IF NOT EXISTS assessment_responses_participant_idx ON assessment_responses (study_participant_id, instrument_code, completed_at);
DROP TRIGGER IF EXISTS assessment_responses_append_only ON assessment_responses;
CREATE TRIGGER assessment_responses_append_only BEFORE UPDATE OR DELETE ON assessment_responses
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();
