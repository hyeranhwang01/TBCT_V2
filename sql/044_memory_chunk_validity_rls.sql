-- Extends sql/009_row_level_security.sql's RLS coverage to
-- memory_chunk_validity_events (sql/043). Same pattern as sql/030: clinicians
-- read; the server writes (bypassing RLS) on a clinician's request through the
-- participant store route, which refuses a patient. Append-only, so no
-- UPDATE/DELETE policy.

ALTER TABLE memory_chunk_validity_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_chunk_validity_events_clinician_read ON memory_chunk_validity_events;
CREATE POLICY memory_chunk_validity_events_clinician_read ON memory_chunk_validity_events
  FOR SELECT USING (is_clinician());
