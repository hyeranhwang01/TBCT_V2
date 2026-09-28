// One-off: moves existing accounts' roles from user_metadata (user-editable,
// no longer trusted) to app_metadata (.claude/TASK_SCOPE.json
// note2026_09_27_roles_from_app_metadata). Run it BEFORE deploying the change,
// or every existing clinician and admin is locked out until approved.
//
//   npx vite-node -c vitest.config.ts scripts/migrate-roles-to-app-metadata.ts                         # list only
//   npx vite-node -c vitest.config.ts scripts/migrate-roles-to-app-metadata.ts --apply                 # patients; clinician/admin -> pending
//   npx vite-node -c vitest.config.ts scripts/migrate-roles-to-app-metadata.ts --apply --grant-staff   # also grant clinician/admin as recorded
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Review the
// listed clinician/admin accounts before --grant-staff: before this fix any
// patient could have set their own role to clinician, and those accounts are
// in the list too. Without --grant-staff, clinicians become pending requests
// that an admin approves on the account page (admins must be granted by
// --grant-staff or by another admin).
import { grantUserRole, listUsersForRoleMigration, requestClinicianRole } from "../src/shared/supabase/admin";

async function main() {
  const apply = process.argv.includes("--apply");
  const grantStaff = process.argv.includes("--grant-staff");
  const users = await listUsersForRoleMigration();
  const todo = users.filter((user) => !user.granted && user.recorded);
  console.log(`${users.length} accounts, ${todo.length} without a granted role but with a recorded one.${apply ? "" : "  (listing only -- pass --apply)"}`);
  const staff = todo.filter((user) => user.recorded !== "patient");
  if (staff.length) {
    console.log("\nClinician/admin accounts to review:");
    for (const user of staff) console.log(`  ${user.recorded!.padEnd(9)} ${user.email ?? user.id}  (created ${user.createdAt.slice(0, 10)})`);
  }
  if (!apply) return;
  let patients = 0;
  let granted = 0;
  let pending = 0;
  for (const user of todo) {
    if (user.recorded === "patient") {
      await grantUserRole(user.id, "patient");
      patients += 1;
    } else if (grantStaff) {
      await grantUserRole(user.id, user.recorded);
      granted += 1;
    } else if (user.recorded === "clinician") {
      await requestClinicianRole(user.id);
      pending += 1;
    }
  }
  console.log(`\nDone. patients granted ${patients}, clinician/admin granted ${granted}, clinician requests pending ${pending}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
