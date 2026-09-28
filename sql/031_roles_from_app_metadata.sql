-- Who counts as a clinician for row-level security
-- (.claude/TASK_SCOPE.json note2026_09_27_roles_from_app_metadata).
-- sql/009 read the role from the JWT's user_metadata, which the user can edit
-- themselves (supabase.auth.updateUser) -- so any patient could make
-- themselves a clinician and, through the Supabase API, read every
-- participant's rows. The role now comes from app_metadata, which only the
-- server (service-role key) can write; see src/shared/auth/roles.ts.
-- Every policy that calls is_clinician() picks this up; none is changed.

CREATE OR REPLACE FUNCTION is_clinician() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'clinician', false);
$$;
