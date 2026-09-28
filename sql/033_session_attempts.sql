-- Sessions by participant, session number and attempt
-- (.claude/TASK_SCOPE.json note2026_09_28_rct_backend, M2).
--
-- runtime_sessions gets its own columns for what used to live only inside
-- `data`:
--  - module_number: the AI module (tbct-s01..s08 -> 1..8), filled by trigger;
--  - session_number: the protocol session (1..12) the run belongs to, set when
--    it is linked to a study visit (study_visit_id);
--  - attempt_number: 1, 2, ... per participant and module, assigned by trigger
--    under an advisory lock so two starts at once still get 1 and 2;
--  - is_official: the first completed attempt of that module, fixed once set
--    (set by finalize_session_record in sql/034); later repeats are kept;
--  - ended_at: when it completed or was terminated.
-- Existing rows are back-filled; re-running this file changes nothing.
--
-- runtime_messages become append-only: the conversation record cannot be
-- edited or deleted, except under tbct.allow_erasure (an approved deletion).
--
-- Views participant_session_attempts / participant_session_messages give the
-- participant x session x attempt shape for researchers (Supabase table editor,
-- SQL editor) with the caller's own permissions (security_invoker).

ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS session_definition_id text;
ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS module_number smallint;
ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS session_number smallint;
ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS attempt_number integer;
ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false;
ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS study_visit_id text;

DO $$ BEGIN
  ALTER TABLE runtime_sessions ADD CONSTRAINT runtime_sessions_session_number_range CHECK (session_number BETWEEN 1 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION tbct_module_number(definition_id text) RETURNS smallint
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(substring(definition_id FROM '^tbct-s0*([0-9]+)$'), '')::smallint
$$;

-- Numbers a new session. createRuntimeSessionRecord is an upsert, so this
-- also fires on later saves of the same row: those are left alone.
CREATE OR REPLACE FUNCTION tbct_assign_session_attempt() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM runtime_sessions WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;
  NEW.session_definition_id := coalesce(NEW.session_definition_id, NEW.data ->> 'sessionDefinitionId');
  NEW.module_number := coalesce(NEW.module_number, tbct_module_number(NEW.session_definition_id));
  IF NEW.attempt_number IS NULL AND NEW.module_number IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.participant_id || ':' || NEW.module_number));
    SELECT coalesce(max(attempt_number), 0) + 1 INTO NEW.attempt_number
      FROM runtime_sessions WHERE participant_id = NEW.participant_id AND module_number = NEW.module_number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS runtime_sessions_assign_attempt ON runtime_sessions;
CREATE TRIGGER runtime_sessions_assign_attempt BEFORE INSERT ON runtime_sessions
  FOR EACH ROW EXECUTE FUNCTION tbct_assign_session_attempt();

-- Back-fill rows from before these columns.
UPDATE runtime_sessions SET session_definition_id = data ->> 'sessionDefinitionId' WHERE session_definition_id IS NULL;
UPDATE runtime_sessions SET module_number = tbct_module_number(session_definition_id) WHERE module_number IS NULL AND session_definition_id IS NOT NULL;
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY participant_id, module_number ORDER BY created_at, id)
    + coalesce((SELECT max(attempt_number) FROM runtime_sessions later
                WHERE later.participant_id = s.participant_id AND later.module_number = s.module_number), 0) AS attempt
  FROM runtime_sessions s
  WHERE attempt_number IS NULL AND module_number IS NOT NULL
)
UPDATE runtime_sessions SET attempt_number = numbered.attempt FROM numbered WHERE runtime_sessions.id = numbered.id;
UPDATE runtime_sessions SET ended_at = coalesce((data ->> 'completedAt')::timestamptz, (data ->> 'terminatedAt')::timestamptz, updated_at)
  WHERE ended_at IS NULL AND status IN ('completed', 'terminated');

CREATE UNIQUE INDEX IF NOT EXISTS runtime_sessions_attempt_uidx ON runtime_sessions (participant_id, module_number, attempt_number);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_sessions_official_uidx ON runtime_sessions (participant_id, module_number) WHERE is_official;
CREATE INDEX IF NOT EXISTS runtime_sessions_participant_module_idx ON runtime_sessions (participant_id, module_number, attempt_number);

-- Conversation records are append-only.
DROP TRIGGER IF EXISTS runtime_messages_append_only ON runtime_messages;
CREATE TRIGGER runtime_messages_append_only BEFORE UPDATE OR DELETE ON runtime_messages
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();

CREATE OR REPLACE VIEW participant_session_attempts WITH (security_invoker = true) AS
  SELECT s.participant_id, s.module_number, s.session_number, s.attempt_number, s.is_official,
         s.status, s.session_definition_id, s.id AS runtime_session_id, s.created_at, s.ended_at,
         s.data ->> 'locale' AS locale
  FROM runtime_sessions s;

CREATE OR REPLACE VIEW participant_session_messages WITH (security_invoker = true) AS
  SELECT s.participant_id, s.module_number, s.session_number, s.attempt_number, s.is_official,
         row_number() OVER (PARTITION BY m.runtime_session_id ORDER BY m.created_at, m.id) AS seq,
         m.role, m.data ->> 'content' AS content, m.created_at,
         m.data -> 'metadata' ->> 'focusField' AS focus_field,
         m.data -> 'metadata' ->> 'step' AS step,
         m.runtime_session_id, m.id AS message_id
  FROM runtime_messages m
  JOIN runtime_sessions s ON s.id = m.runtime_session_id;

REVOKE ALL ON participant_session_attempts, participant_session_messages FROM anon;
