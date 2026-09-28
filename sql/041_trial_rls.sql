-- Row-level security for the trial tables (sql/032-040). Same reasoning as
-- sql/009: the app's server code bypasses RLS; this closes direct access
-- through the Supabase API. Clinicians (is_clinician, app_metadata since
-- sql/031) may read the trial tables. Nobody reads randomization_lists (RLS
-- on, no policy: the allocation function is the only reader). Assessors and
-- coordinators work through the app's trial store, which enforces blinding;
-- patients read nothing here directly.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trial_history', 'studies', 'study_arms', 'sites', 'therapists', 'study_participants', 'screenings',
    'eligibility_decisions', 'study_consents', 'withdrawals', 'protocol_deviations', 'ai_releases', 'allocations',
    'study_visits', 'homework_logs', 'instruments', 'assessment_timepoints', 'assessment_tasks', 'assessment_responses',
    'adverse_events', 'review_tasks', 'study_locks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_clinician_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (is_clinician())', t || '_clinician_read', t);
  END LOOP;
END $$;

ALTER TABLE randomization_lists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON randomization_lists FROM anon, authenticated;
