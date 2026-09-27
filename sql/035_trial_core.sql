-- Trial operations, core (.claude/TASK_SCOPE.json note2026_09_28_rct_backend,
-- M3). Replaces the browser-only pilot layer (src/shared/data/db/
-- tbct-local-db.ts pilot* tables) with server tables. One database per
-- country (Protocol V9 p.18), so a study here is that country's part of the
-- trial.
--
-- Audit: rows that legitimately change (a participant's status, a deviation
-- being resolved) are "mutable with history": every UPDATE/DELETE writes the
-- old and new row to trial_history with the actor (tbct.actor, set by the
-- store per transaction). Records of facts (screenings, eligibility
-- decisions, consents, withdrawals) are append-only: a correction is a new
-- row.

CREATE TABLE IF NOT EXISTS trial_history (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  row_id text NOT NULL,
  operation text NOT NULL,
  old_row jsonb,
  new_row jsonb,
  actor text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_history_row_idx ON trial_history (table_name, row_id, changed_at);

CREATE OR REPLACE FUNCTION tbct_record_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO trial_history (table_name, row_id, operation, old_row, new_row, actor)
    VALUES (TG_TABLE_NAME, OLD.id, TG_OP, to_jsonb(OLD), NULL, nullif(current_setting('tbct.actor', true), ''));
    RETURN OLD;
  END IF;
  INSERT INTO trial_history (table_name, row_id, operation, old_row, new_row, actor)
  VALUES (TG_TABLE_NAME, NEW.id, TG_OP, CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW),
          nullif(current_setting('tbct.actor', true), ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trial_history_append_only ON trial_history;
CREATE TRIGGER trial_history_append_only BEFORE UPDATE OR DELETE ON trial_history
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();

CREATE TABLE IF NOT EXISTS studies (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  country text NOT NULL,
  protocol_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'closed')),
  sessions_per_participant smallint NOT NULL DEFAULT 12,
  completion_weeks smallint NOT NULL DEFAULT 14,
  retention_years smallint NOT NULL DEFAULT 5,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS study_arms (
  id text PRIMARY KEY,
  study_id text NOT NULL REFERENCES studies(id),
  code text NOT NULL CHECK (code IN ('CLINICIAN_ONLY', 'AI_CLINICIAN', 'AI_LED')),
  name text NOT NULL,
  ai_enabled boolean NOT NULL,
  therapist_required boolean NOT NULL,
  schedule_template jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, code)
);

CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  study_id text NOT NULL REFERENCES studies(id),
  code text NOT NULL,
  name text NOT NULL,
  locale text NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, code)
);

CREATE TABLE IF NOT EXISTS therapists (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  auth_user_id text,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_participants (
  id text PRIMARY KEY,
  study_id text NOT NULL REFERENCES studies(id),
  site_id text NOT NULL REFERENCES sites(id),
  runtime_participant_id text NOT NULL,
  study_code text NOT NULL UNIQUE,
  diagnosis_stratum text CHECK (diagnosis_stratum IN ('MDD', 'ANXIETY')),
  status text NOT NULL CHECK (status IN ('screening', 'ineligible', 'eligible', 'enrolled', 'allocated', 'completed', 'withdrawn')),
  therapist_id text REFERENCES therapists(id),
  enrolled_at timestamptz,
  allocated_at timestamptz,
  completed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}',
  UNIQUE (study_id, runtime_participant_id)
);
CREATE INDEX IF NOT EXISTS study_participants_status_idx ON study_participants (study_id, status);

CREATE TABLE IF NOT EXISTS screenings (
  id text PRIMARY KEY,
  study_participant_id text NOT NULL REFERENCES study_participants(id),
  screened_by text NOT NULL,
  screened_at timestamptz NOT NULL,
  criteria jsonb NOT NULL,
  phq9_total smallint,
  gad7_total smallint,
  cssrs_risk text CHECK (cssrs_risk IN ('none', 'low', 'moderate', 'high')),
  result text NOT NULL CHECK (result IN ('pass', 'fail')),
  data jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS eligibility_decisions (
  id text PRIMARY KEY,
  study_participant_id text NOT NULL REFERENCES study_participants(id),
  screening_id text REFERENCES screenings(id),
  decision text NOT NULL CHECK (decision IN ('eligible', 'ineligible')),
  reasons text[] NOT NULL DEFAULT '{}',
  is_override boolean NOT NULL DEFAULT false,
  override_reason text,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS study_consents (
  id text PRIMARY KEY,
  study_participant_id text NOT NULL REFERENCES study_participants(id),
  consent_type text NOT NULL CHECK (consent_type IN ('main', 'ai_interaction_logging', 'extended_retention')),
  version text NOT NULL,
  ai_release_id text,
  status text NOT NULL CHECK (status IN ('granted', 'withdrawn')),
  method text NOT NULL CHECK (method IN ('written', 'electronic')),
  document_ref text,
  decided_at timestamptz NOT NULL,
  recorded_by text NOT NULL
);
CREATE INDEX IF NOT EXISTS study_consents_participant_idx ON study_consents (study_participant_id, consent_type, decided_at);

CREATE TABLE IF NOT EXISTS withdrawals (
  id text PRIMARY KEY,
  study_participant_id text NOT NULL REFERENCES study_participants(id),
  withdrawn_at timestamptz NOT NULL,
  reason_category text NOT NULL CHECK (reason_category IN ('participant_choice', 'adverse_event', 'suicidality', 'lost_to_follow_up', 'investigator_decision', 'other')),
  reason_text text,
  initiated_by text NOT NULL CHECK (initiated_by IN ('participant', 'investigator', 'safety')),
  data_disposition text NOT NULL CHECK (data_disposition IN ('retain_collected', 'exclude_from_analysis', 'erasure_requested')),
  recorded_by text NOT NULL
);

CREATE TABLE IF NOT EXISTS protocol_deviations (
  id text PRIMARY KEY,
  study_id text NOT NULL REFERENCES studies(id),
  study_participant_id text REFERENCES study_participants(id),
  category text NOT NULL CHECK (category IN ('eligibility', 'consent', 'randomization', 'visit_window', 'intervention', 'ai_release_change', 'assessment', 'safety_reporting', 'data', 'other')),
  severity text NOT NULL CHECK (severity IN ('minor', 'major')),
  description text NOT NULL,
  detected_at timestamptz NOT NULL,
  detected_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  corrective_action text,
  resolved_at timestamptz,
  data jsonb NOT NULL DEFAULT '{}'
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['studies', 'study_arms', 'sites', 'therapists', 'study_participants', 'protocol_deviations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_history', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION tbct_record_history()', t || '_history', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['screenings', 'eligibility_decisions', 'study_consents', 'withdrawals'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite()', t || '_append_only', t);
  END LOOP;
END $$;
