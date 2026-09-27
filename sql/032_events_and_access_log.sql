-- Foundation for the RCT backend (.claude/TASK_SCOPE.json note2026_09_28_rct_backend).
--
-- runtime_events: one row per thing worth finding later -- a model call (with
-- latency and tokens), a rejected value, a safety clarification, a skipped
-- step, a failed background job. Stable codes (MODEL_TIMEOUT,
-- FIELD_REJECTED, ...) so they can be counted, not only read; participant and
-- session on every row so they can be filtered. Written by
-- src/shared/trial/runtime-events.ts. Append-only.
--
-- access_log: staff reading or downloading identifiable or clinical data
-- (who, role, what, when). Append-only.
--
-- schema_migrations is created by scripts/lib/apply-migrations.mjs.

CREATE TABLE IF NOT EXISTS runtime_events (
  id text PRIMARY KEY,
  participant_id text,
  runtime_session_id text,
  session_number smallint,
  attempt_number integer,
  message_id text,
  turn_id text,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  code text NOT NULL,
  model text,
  prompt_version text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_events_participant_idx ON runtime_events (participant_id, created_at);
CREATE INDEX IF NOT EXISTS runtime_events_session_idx ON runtime_events (runtime_session_id, created_at);
CREATE INDEX IF NOT EXISTS runtime_events_code_idx ON runtime_events (code, created_at);
CREATE INDEX IF NOT EXISTS runtime_events_severity_idx ON runtime_events (severity, created_at);

DROP TRIGGER IF EXISTS runtime_events_append_only ON runtime_events;
CREATE TRIGGER runtime_events_append_only BEFORE UPDATE OR DELETE ON runtime_events
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();

CREATE TABLE IF NOT EXISTS access_log (
  id text PRIMARY KEY,
  actor_user_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL,
  participant_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS access_log_participant_idx ON access_log (participant_id, created_at);
CREATE INDEX IF NOT EXISTS access_log_actor_idx ON access_log (actor_user_id, created_at);

DROP TRIGGER IF EXISTS access_log_append_only ON access_log;
CREATE TRIGGER access_log_append_only BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();

ALTER TABLE runtime_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runtime_events_clinician_read ON runtime_events;
CREATE POLICY runtime_events_clinician_read ON runtime_events FOR SELECT USING (is_clinician());
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;
