-- Extends sql/009_row_level_security.sql's RLS coverage to the
-- longitudinal-memory pipeline tables added in sql/023. Same reasoning as
-- 009/012/014: the app's own server code bypasses RLS via the postgres
-- superuser role, so this only closes the Realtime/direct-client gap.
-- Every table here carries participant_id, so the patient policy is the
-- standard "rows that trace back to my own runtime_participants row".

ALTER TABLE runtime_session_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runtime_session_summaries_clinician_all ON runtime_session_summaries;
CREATE POLICY runtime_session_summaries_clinician_all ON runtime_session_summaries
  FOR ALL USING (is_clinician()) WITH CHECK (is_clinician());
DROP POLICY IF EXISTS runtime_session_summaries_patient_own ON runtime_session_summaries;
CREATE POLICY runtime_session_summaries_patient_own ON runtime_session_summaries
  FOR ALL USING (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text))
  WITH CHECK (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text));

ALTER TABLE memory_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_candidates_clinician_all ON memory_candidates;
CREATE POLICY memory_candidates_clinician_all ON memory_candidates
  FOR ALL USING (is_clinician()) WITH CHECK (is_clinician());
DROP POLICY IF EXISTS memory_candidates_patient_own ON memory_candidates;
CREATE POLICY memory_candidates_patient_own ON memory_candidates
  FOR ALL USING (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text))
  WITH CHECK (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text));

ALTER TABLE memory_review_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_review_decisions_clinician_all ON memory_review_decisions;
CREATE POLICY memory_review_decisions_clinician_all ON memory_review_decisions
  FOR ALL USING (is_clinician()) WITH CHECK (is_clinician());
DROP POLICY IF EXISTS memory_review_decisions_patient_own ON memory_review_decisions;
CREATE POLICY memory_review_decisions_patient_own ON memory_review_decisions
  FOR ALL USING (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text))
  WITH CHECK (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text));

ALTER TABLE memory_retrieval_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_retrieval_runs_clinician_all ON memory_retrieval_runs;
CREATE POLICY memory_retrieval_runs_clinician_all ON memory_retrieval_runs
  FOR ALL USING (is_clinician()) WITH CHECK (is_clinician());
DROP POLICY IF EXISTS memory_retrieval_runs_patient_own ON memory_retrieval_runs;
CREATE POLICY memory_retrieval_runs_patient_own ON memory_retrieval_runs
  FOR ALL USING (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text))
  WITH CHECK (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text));

ALTER TABLE memory_usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_usage_logs_clinician_all ON memory_usage_logs;
CREATE POLICY memory_usage_logs_clinician_all ON memory_usage_logs
  FOR ALL USING (is_clinician()) WITH CHECK (is_clinician());
DROP POLICY IF EXISTS memory_usage_logs_patient_own ON memory_usage_logs;
CREATE POLICY memory_usage_logs_patient_own ON memory_usage_logs
  FOR ALL USING (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text))
  WITH CHECK (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text));

ALTER TABLE goal_tracking_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS goal_tracking_records_clinician_all ON goal_tracking_records;
CREATE POLICY goal_tracking_records_clinician_all ON goal_tracking_records
  FOR ALL USING (is_clinician()) WITH CHECK (is_clinician());
DROP POLICY IF EXISTS goal_tracking_records_patient_own ON goal_tracking_records;
CREATE POLICY goal_tracking_records_patient_own ON goal_tracking_records
  FOR ALL USING (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text))
  WITH CHECK (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text));

ALTER TABLE homework_tracking_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS homework_tracking_records_clinician_all ON homework_tracking_records;
CREATE POLICY homework_tracking_records_clinician_all ON homework_tracking_records
  FOR ALL USING (is_clinician()) WITH CHECK (is_clinician());
DROP POLICY IF EXISTS homework_tracking_records_patient_own ON homework_tracking_records;
CREATE POLICY homework_tracking_records_patient_own ON homework_tracking_records
  FOR ALL USING (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text))
  WITH CHECK (participant_id IN (SELECT id FROM runtime_participants WHERE auth_user_id = auth.uid()::text));
