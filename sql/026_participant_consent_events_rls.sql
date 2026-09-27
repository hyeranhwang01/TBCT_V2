-- Extends sql/009_row_level_security.sql's RLS coverage to
-- participant_consent_events (sql/025). Same reasoning as every other
-- migration in this series -- closes the Realtime/direct-client gap only,
-- the app's own server code bypasses RLS via the postgres superuser role.
-- Read only. Rows are written by the server (recordMemoryConsent), which
-- takes the actor from the session; a direct insert through the API would let
-- a caller write any actor or time into an append-only record, so no INSERT
-- policy is granted (the DROPs below also remove ones from an earlier draft).

ALTER TABLE participant_consent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS participant_consent_events_clinician_read ON participant_consent_events;
CREATE POLICY participant_consent_events_clinician_read ON participant_consent_events
  FOR SELECT USING (is_clinician());
DROP POLICY IF EXISTS participant_consent_events_clinician_insert ON participant_consent_events;
DROP POLICY IF EXISTS participant_consent_events_patient_read ON participant_consent_events;
CREATE POLICY participant_consent_events_patient_read ON participant_consent_events
  FOR SELECT USING (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text));
DROP POLICY IF EXISTS participant_consent_events_patient_insert ON participant_consent_events;
