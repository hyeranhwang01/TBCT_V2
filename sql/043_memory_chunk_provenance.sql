-- Memory RAG v2, Phase A (.claude/TASK_SCOPE.json
-- note2026_10_02_memory_rag_v2_phase_a): where each memory chunk came from,
-- and whether a clinician still holds it to be valid.
--
-- Provenance, on participant_memory_chunks (sql/027):
--  - author: who wrote the words -- 'participant' (their answers, worksheet
--    values and homework), 'clinician' (a counsellor's note) or 'system'
--    (reserved for interpretations the program derives, Phase B);
--  - layer: what kind of memory it is -- 'raw' (an episode of the
--    conversation), 'record' (a worksheet or homework value), 'interpretation'
--    (reserved for Phase B: a derived reading, never the participant's words)
--    or 'clinician_note'. Retrieval gives each layer its own quota;
--  - cognitive_level: the TBCT level (1 automatic thoughts, 2 underlying
--    assumptions, 3 core beliefs) of an interpretation. Null for everything
--    else -- the participant's own words are never gated by level;
--  - sensitivity_flags: set by the safety code; a flagged chunk is never
--    retrieved. Today any risk signal keeps a chunk from being stored at all
--    (chunk-builder.ts), so the column is the slot for later safety work.
-- All four are part of what was stored and join the immutable tuple of the
-- guard: an RCT record of what the model could have been shown must not
-- change after the fact.
--
-- Existing rows are backfilled from chunk_kind (the only kinds so far are
-- worksheet, homework, episode and clinician_note).
--
-- Validity, in memory_chunk_validity_events: a clinician can mark a chunk as
-- no longer holding ('invalid', e.g. the participant has since said it was a
-- misunderstanding) and later as holding again ('valid' -- the book has
-- earlier material come back in later sessions, de Oliveira 2015 p.143). The
-- chunk row itself stays as it was; the latest event decides, so the history
-- of every decision is kept. Append-only (tbct_refuse_rewrite, sql/025).

ALTER TABLE participant_memory_chunks ADD COLUMN IF NOT EXISTS author text NOT NULL DEFAULT 'participant';
ALTER TABLE participant_memory_chunks ADD COLUMN IF NOT EXISTS layer text NOT NULL DEFAULT 'raw';
ALTER TABLE participant_memory_chunks ADD COLUMN IF NOT EXISTS cognitive_level smallint;
ALTER TABLE participant_memory_chunks ADD COLUMN IF NOT EXISTS sensitivity_flags text[] NOT NULL DEFAULT '{}';

-- The backfill runs before the guard below is replaced: sql/027's guard does
-- not know the new columns yet, so it lets this UPDATE through without any
-- bypass. Only rows whose kind says otherwise than the defaults are touched,
-- so a re-run (with the new guard in place) matches no row and fires nothing.
UPDATE participant_memory_chunks SET author = 'clinician', layer = 'clinician_note'
  WHERE chunk_kind = 'clinician_note' AND (author, layer) IS DISTINCT FROM ('clinician', 'clinician_note');
UPDATE participant_memory_chunks SET layer = 'record'
  WHERE chunk_kind IN ('worksheet', 'homework') AND layer = 'raw';

DO $$ BEGIN
  ALTER TABLE participant_memory_chunks ADD CONSTRAINT participant_memory_chunks_author_check CHECK (author IN ('participant', 'system', 'clinician'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE participant_memory_chunks ADD CONSTRAINT participant_memory_chunks_layer_check CHECK (layer IN ('raw', 'record', 'interpretation', 'clinician_note'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE participant_memory_chunks ADD CONSTRAINT participant_memory_chunks_level_check CHECK (cognitive_level IS NULL OR cognitive_level BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sql/027's guard with the four new columns in the immutable tuple.
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
      NEW.content, NEW.distortion_ids, NEW.source_created_at, NEW.index_version, NEW.created_at,
      NEW.author, NEW.layer, NEW.cognitive_level, NEW.sensitivity_flags)
     IS DISTINCT FROM
     (OLD.id, OLD.participant_id, OLD.runtime_session_id, OLD.session_definition_id, OLD.session_index,
      OLD.chunk_kind, OLD.element_kind, OLD.field_names, OLD.source_message_ids, OLD.source_ref,
      OLD.content, OLD.distortion_ids, OLD.source_created_at, OLD.index_version, OLD.created_at,
      OLD.author, OLD.layer, OLD.cognitive_level, OLD.sensitivity_flags) THEN
    RAISE EXCEPTION 'participant_memory_chunks content is immutable (UPDATE refused)';
  END IF;
  IF OLD.tagged_at IS NOT NULL AND (NEW.tags, NEW.tagged_at, NEW.tag_model, NEW.tag_prompt_version)
     IS DISTINCT FROM (OLD.tags, OLD.tagged_at, OLD.tag_model, OLD.tag_prompt_version) THEN
    RAISE EXCEPTION 'participant_memory_chunks tags are set once (UPDATE refused)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS memory_chunk_validity_events (
  id text PRIMARY KEY,
  chunk_id text NOT NULL,
  participant_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('invalid', 'valid')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  actor text,
  -- A chunk that replaces this one (Phase B: a revised interpretation).
  superseded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_chunk_validity_events_chunk_idx ON memory_chunk_validity_events (chunk_id, created_at);
CREATE INDEX IF NOT EXISTS memory_chunk_validity_events_participant_idx ON memory_chunk_validity_events (participant_id, created_at);

DROP TRIGGER IF EXISTS memory_chunk_validity_events_append_only ON memory_chunk_validity_events;
CREATE TRIGGER memory_chunk_validity_events_append_only
  BEFORE UPDATE OR DELETE ON memory_chunk_validity_events
  FOR EACH ROW EXECUTE FUNCTION tbct_refuse_rewrite();
