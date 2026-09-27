-- Adverse events and clinician review tasks (.claude/TASK_SCOPE.json
-- note2026_09_28_rct_backend, M7; Protocol V9 p.13-19).
--
-- adverse_events: the trial's AE/SAE record. The protocol does not define AE
-- categories or reporting timelines, so the standard ICH E2A fields are used
-- (seriousness, severity, relatedness, expectedness, action, outcome) with a
-- 24-hour reporting deadline for serious events (configurable per study).
-- May link to a runtime safety_event (sql/003) or stand alone (an event
-- reported outside a session). Mutable with history.
--
-- review_tasks: things a clinician must look at by a deadline -- a weekly
-- PHQ-2 at or above threshold or a positive suicidality item in the AI-led
-- arm (review within 24 h), a moderate/high C-SSRS, a deterioration alert.
-- Mutable with history.

CREATE TABLE IF NOT EXISTS adverse_events (
  id text PRIMARY KEY,
  study_participant_id text REFERENCES study_participants(id),
  runtime_participant_id text,
  safety_event_id text,
  onset_at timestamptz,
  detected_at timestamptz NOT NULL,
  description text NOT NULL,
  serious boolean NOT NULL,
  seriousness_criteria text[] NOT NULL DEFAULT '{}',
  severity text NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
  relatedness text NOT NULL CHECK (relatedness IN ('not_related', 'unlikely', 'possible', 'probable', 'definite', 'not_assessed')),
  expected boolean,
  action_taken text,
  outcome text NOT NULL CHECK (outcome IN ('ongoing', 'recovering', 'recovered', 'recovered_with_sequelae', 'fatal', 'unknown')),
  report_due_at timestamptz,
  reported_at timestamptz,
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  recorded_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS adverse_events_participant_idx ON adverse_events (study_participant_id, detected_at);
CREATE INDEX IF NOT EXISTS adverse_events_due_idx ON adverse_events (report_due_at) WHERE reported_at IS NULL;
DROP TRIGGER IF EXISTS adverse_events_history ON adverse_events;
CREATE TRIGGER adverse_events_history AFTER INSERT OR UPDATE OR DELETE ON adverse_events
  FOR EACH ROW EXECUTE FUNCTION tbct_record_history();

CREATE TABLE IF NOT EXISTS review_tasks (
  id text PRIMARY KEY,
  study_participant_id text REFERENCES study_participants(id),
  runtime_participant_id text,
  source text NOT NULL CHECK (source IN ('phq2_weekly', 'suicidality_item', 'cssrs', 'deterioration', 'safety_event')),
  source_ref text,
  reason text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'done')),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
CREATE INDEX IF NOT EXISTS review_tasks_open_idx ON review_tasks (status, due_at);
DROP TRIGGER IF EXISTS review_tasks_history ON review_tasks;
CREATE TRIGGER review_tasks_history AFTER INSERT OR UPDATE OR DELETE ON review_tasks
  FOR EACH ROW EXECUTE FUNCTION tbct_record_history();
