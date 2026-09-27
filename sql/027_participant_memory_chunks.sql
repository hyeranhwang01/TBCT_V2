-- Participant memory chunks (.claude/TASK_SCOPE.json
-- note2026_09_27_memory_rag_m2_chunks): what a participant said and wrote in
-- earlier sessions, cut into small pieces the runtime can retrieve in later
-- sessions (src/shared/memory/chunk-builder.ts). Built when a session
-- completes; homework is chunked when the next session starts.
--
-- Unlike the document-row tables (a few columns + data jsonb), every field
-- here is its own column: the columns are what the append-only guard below
-- checks, and an RCT record of what the model could have been shown must not
-- change after the fact.
--
-- What may change after insert:
--  - the tags (tags, tagged_at, tag_model, tag_prompt_version), once, from
--    empty -- the tagger (M3) fills them after the chunk exists;
--  - suppression (suppressed*), which a clinician sets to keep a chunk out of
--    retrieval.
-- Everything else is refused, and so is DELETE, except under
-- tbct.allow_erasure = 'on' (an approved data-deletion request, sql/018).

CREATE TABLE IF NOT EXISTS participant_memory_chunks (
  id text PRIMARY KEY,
  participant_id text NOT NULL,
  runtime_session_id text NOT NULL,
  session_definition_id text NOT NULL,
  session_index integer NOT NULL,
  chunk_kind text NOT NULL,
  element_kind text NOT NULL,
  field_names text[] NOT NULL DEFAULT '{}',
  source_message_ids text[] NOT NULL DEFAULT '{}',
  source_ref text,
  content text NOT NULL,
  distortion_ids text[] NOT NULL DEFAULT '{}',
  source_created_at timestamptz NOT NULL,
  index_version text NOT NULL,
  tags jsonb,
  tagged_at timestamptz,
  tag_model text,
  tag_prompt_version text,
  suppressed boolean NOT NULL DEFAULT false,
  suppressed_at timestamptz,
  suppressed_by text,
  suppressed_reason text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS participant_memory_chunks_participant_idx ON participant_memory_chunks (participant_id, session_index);
CREATE INDEX IF NOT EXISTS participant_memory_chunks_session_idx ON participant_memory_chunks (runtime_session_id);

CREATE OR REPLACE FUNCTION tbct_memory_chunk_guard() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('tbct.allow_erasure', true), '') = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'participant_memory_chunks is append-only (DELETE refused)';
  END IF;
  IF (NEW.id, NEW.participant_id, NEW.runtime_session_id, NEW.session_definition_id, NEW.session_index,
      NEW.chunk_kind, NEW.element_kind, NEW.field_names, NEW.source_message_ids, NEW.source_ref,
      NEW.content, NEW.distortion_ids, NEW.source_created_at, NEW.index_version, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.participant_id, OLD.runtime_session_id, OLD.session_definition_id, OLD.session_index,
      OLD.chunk_kind, OLD.element_kind, OLD.field_names, OLD.source_message_ids, OLD.source_ref,
      OLD.content, OLD.distortion_ids, OLD.source_created_at, OLD.index_version, OLD.created_at) THEN
    RAISE EXCEPTION 'participant_memory_chunks content is immutable (UPDATE refused)';
  END IF;
  IF OLD.tagged_at IS NOT NULL AND (NEW.tags, NEW.tagged_at, NEW.tag_model, NEW.tag_prompt_version)
     IS DISTINCT FROM (OLD.tags, OLD.tagged_at, OLD.tag_model, OLD.tag_prompt_version) THEN
    RAISE EXCEPTION 'participant_memory_chunks tags are set once (UPDATE refused)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS participant_memory_chunks_guard ON participant_memory_chunks;
CREATE TRIGGER participant_memory_chunks_guard
  BEFORE UPDATE OR DELETE ON participant_memory_chunks
  FOR EACH ROW EXECUTE FUNCTION tbct_memory_chunk_guard();
