-- One row per model call in a prompt-driven session: what the retrieval step
-- considered and what it put in front of the model (.claude/TASK_SCOPE.json
-- note2026_09_27_memory_rag_m3_m7). Written for every call, including when
-- nothing was sent because the participant has not agreed -- the record of
-- "nothing from earlier sessions reached the model here" matters as much.
-- With the chunk ids, the algorithm and index versions, and the prompt hash on
-- the message, what the model was shown can be reconstructed.
--
-- Append-only, same guard as sql/025 (tbct_refuse_rewrite).

CREATE TABLE IF NOT EXISTS memory_chunk_retrievals (
  id text PRIMARY KEY,
  participant_id text NOT NULL,
  runtime_session_id text NOT NULL,
  message_id text,
  consent_state text NOT NULL,
  algorithm_version text NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_chunk_retrievals_session_idx ON memory_chunk_retrievals (runtime_session_id, created_at);
CREATE INDEX IF NOT EXISTS memory_chunk_retrievals_participant_idx ON memory_chunk_retrievals (participant_id, created_at);

DROP TRIGGER IF EXISTS memory_chunk_retrievals_append_only ON memory_chunk_retrievals;
CREATE TRIGGER memory_chunk_retrievals_append_only
  BEFORE UPDATE OR DELETE ON memory_chunk_retrievals
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();
