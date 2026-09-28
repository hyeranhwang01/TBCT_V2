-- Extends sql/009_row_level_security.sql's RLS coverage to
-- memory_chunk_retrievals (sql/029). Clinicians read; the server writes
-- (bypassing RLS). Append-only, so no UPDATE/DELETE policy.

ALTER TABLE memory_chunk_retrievals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_chunk_retrievals_clinician_read ON memory_chunk_retrievals;
CREATE POLICY memory_chunk_retrievals_clinician_read ON memory_chunk_retrievals
  FOR SELECT USING (is_clinician());
