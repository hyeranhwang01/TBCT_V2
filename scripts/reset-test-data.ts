// Deletes ALL data in the app database (every table in the public schema
// except schema_migrations); the tables stay. Only for a database that holds
// nothing but test data. Supabase login accounts (auth schema) are not
// touched. Without --apply it only shows row counts; --apply also needs
// --confirm <database host>, exactly as shown in the listing. --backup <dir>
// first writes every table's rows to <dir>/<table>.json (keep it out of git).
//
//   npx vite-node -c vitest.config.ts scripts/reset-test-data.ts
//   npx vite-node -c vitest.config.ts scripts/reset-test-data.ts --apply --confirm <host> --backup ~/tbct-backup-2026-09-28
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPgPool } from "../src/shared/data/db/pg-pool";
import { appTables, rowCounts, truncateAppTables } from "./lib/reset-data";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : undefined;
  if (!host) throw new Error("DATABASE_URL is not set.");
  const pool = getPgPool();
  const before = await rowCounts(pool as never);
  const filled = Object.entries(before).filter(([, count]) => count > 0);
  console.log(`Database: ${host}${apply ? "" : "  (listing only)"}`);
  console.log(`${Object.keys(before).length} tables, ${filled.length} with rows:`);
  for (const [table, count] of filled) console.log(`  ${table}: ${count}`);
  if (!apply) return;
  if (argument("--confirm") !== host) throw new Error(`--confirm ${host} is required.`);
  const backup = argument("--backup");
  if (backup) {
    mkdirSync(backup, { recursive: true });
    for (const table of await appTables(pool as never)) {
      const { rows } = await pool.query(`SELECT * FROM "${table}"`);
      writeFileSync(path.join(backup, `${table}.json`), JSON.stringify(rows, null, 1));
    }
    console.log(`Backup written to ${path.resolve(backup)}.`);
  }
  await truncateAppTables(pool as never);
  const after = Object.values(await rowCounts(pool as never)).reduce((sum, count) => sum + count, 0);
  console.log(`\nDone. Rows left: ${after}.`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
