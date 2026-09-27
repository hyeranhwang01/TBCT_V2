-- Participant memory-consent events (.claude/TASK_SCOPE.json
-- note2026_09_27_memory_rag_m1_consent). Until now consent changes were
-- written to the browser's IndexedDB only (participant-repository.ts), so
-- the server -- where every patient turn runs -- could not see them and
-- there was no trial record of who agreed to what, when, under which
-- wording. One row per decision; the participant's current decision is also
-- kept on runtime_participants.data.memoryConsent for the runtime to read.
--
-- Append-only: an RCT consent record must not be rewritten. UPDATE and
-- DELETE are refused by trigger, except inside a transaction that sets
-- tbct.allow_erasure = 'on' (an approved data-deletion request, sql/018).

CREATE TABLE IF NOT EXISTS participant_consent_events (
  id text PRIMARY KEY,
  participant_id text NOT NULL,
  consent_kind text NOT NULL,
  decision text NOT NULL,
  text_version text NOT NULL,
  source text NOT NULL,
  decided_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS participant_consent_events_participant_idx ON participant_consent_events (participant_id, decided_at);

CREATE OR REPLACE FUNCTION tbct_refuse_rewrite() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('tbct.allow_erasure', true), '') = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS participant_consent_events_append_only ON participant_consent_events;
CREATE TRIGGER participant_consent_events_append_only
  BEFORE UPDATE OR DELETE ON participant_consent_events
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();
