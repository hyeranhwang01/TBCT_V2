-- Sealed session records and their download log (.claude/TASK_SCOPE.json
-- note2026_09_28_rct_backend, M2).
--
-- session_records: when a session completes or is terminated, everything it
-- produced (conversation, worksheet, homework, safety events, summary, the
-- earlier-session memory the model was shown, consent state, step fidelity,
-- events, model and prompt versions) is written once as `snapshot`, with a
-- sha256 of its canonical JSON. One per runtime session; append-only.
-- Paused or held sessions can resume, so they get no record until they end.
--
-- finalize_session_record(): inserts the record (idempotent) and, for a
-- completed session that is the first completed attempt of its module, marks
-- it official -- in one statement, so the record and the flag never disagree.
--
-- session_record_downloads: who downloaded which records, when, in which
-- format, with the record hashes. Written before the file is returned;
-- append-only.

CREATE TABLE IF NOT EXISTS session_records (
  id text PRIMARY KEY,
  runtime_session_id text NOT NULL UNIQUE,
  participant_id text NOT NULL,
  module_number smallint,
  session_number smallint,
  attempt_number integer,
  end_status text NOT NULL CHECK (end_status IN ('completed', 'terminated')),
  is_official_at_write boolean NOT NULL,
  schema_version text NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS session_records_participant_idx ON session_records (participant_id, module_number, attempt_number);

DROP TRIGGER IF EXISTS session_records_append_only ON session_records;
CREATE TRIGGER session_records_append_only BEFORE UPDATE OR DELETE ON session_records
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();

CREATE OR REPLACE FUNCTION finalize_session_record(
  p_id text, p_runtime_session_id text, p_schema_version text, p_content_sha256 text, p_snapshot jsonb
) RETURNS TABLE (record_id text, inserted boolean, is_official boolean) AS $$
-- The output column is_official shares its name with runtime_sessions's.
#variable_conflict use_column
DECLARE
  s runtime_sessions%ROWTYPE;
  official boolean;
  existing text;
BEGIN
  SELECT * INTO s FROM runtime_sessions WHERE id = p_runtime_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime session % not found', p_runtime_session_id; END IF;
  IF s.status NOT IN ('completed', 'terminated') THEN
    RAISE EXCEPTION 'session % has not ended (status %)', p_runtime_session_id, s.status;
  END IF;
  SELECT id INTO existing FROM session_records WHERE runtime_session_id = p_runtime_session_id;
  IF existing IS NOT NULL THEN
    RETURN QUERY SELECT existing, false, s.is_official;
    RETURN;
  END IF;
  official := s.is_official;
  IF s.status = 'completed' AND NOT s.is_official AND s.module_number IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(s.participant_id || ':' || s.module_number));
    IF NOT EXISTS (SELECT 1 FROM runtime_sessions WHERE participant_id = s.participant_id AND module_number = s.module_number AND is_official) THEN
      UPDATE runtime_sessions SET is_official = true WHERE id = s.id;
      official := true;
    END IF;
  END IF;
  UPDATE runtime_sessions SET ended_at = coalesce(ended_at, now()) WHERE id = s.id;
  INSERT INTO session_records (id, runtime_session_id, participant_id, module_number, session_number, attempt_number,
    end_status, is_official_at_write, schema_version, content_sha256, created_at, snapshot)
  VALUES (p_id, s.id, s.participant_id, s.module_number, s.session_number, s.attempt_number,
    s.status, official, p_schema_version, p_content_sha256, now(), p_snapshot);
  RETURN QUERY SELECT p_id, true, official;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS session_record_downloads (
  id text PRIMARY KEY,
  downloaded_by text NOT NULL,
  downloader_role text NOT NULL,
  participant_id text,
  module_number smallint,
  attempts text NOT NULL,
  format text NOT NULL,
  record_hashes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS session_record_downloads_participant_idx ON session_record_downloads (participant_id, created_at);

DROP TRIGGER IF EXISTS session_record_downloads_append_only ON session_record_downloads;
CREATE TRIGGER session_record_downloads_append_only BEFORE UPDATE OR DELETE ON session_record_downloads
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();

ALTER TABLE session_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_records_clinician_read ON session_records;
CREATE POLICY session_records_clinician_read ON session_records FOR SELECT USING (is_clinician());
ALTER TABLE session_record_downloads ENABLE ROW LEVEL SECURITY;
