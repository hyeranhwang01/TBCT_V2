-- Extends sql/009_row_level_security.sql's RLS coverage to
-- participant_memory_chunks (sql/027). Same reasoning as the rest of the
-- series: closes the Realtime/direct-client gap only; the app's server code
-- bypasses RLS. Clinicians only. Chunks are written by the server and read by
-- the server and by clinicians; a participant's own words are already
-- available to them through their sessions, so no patient policy is granted.

ALTER TABLE participant_memory_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS participant_memory_chunks_clinician_read ON participant_memory_chunks;
CREATE POLICY participant_memory_chunks_clinician_read ON participant_memory_chunks
  FOR SELECT USING (is_clinician());
DROP POLICY IF EXISTS participant_memory_chunks_clinician_suppress ON participant_memory_chunks;
CREATE POLICY participant_memory_chunks_clinician_suppress ON participant_memory_chunks
  FOR UPDATE USING (is_clinician()) WITH CHECK (is_clinician());
