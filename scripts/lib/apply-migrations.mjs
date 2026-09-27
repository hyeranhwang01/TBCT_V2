// Applies sql/*.sql in filename order and records each one in
// schema_migrations (filename, sha256, applied_at), so a deploy applies only
// new files (.claude/TASK_SCOPE.json note2026_09_28_rct_backend). Every file
// is still written to be safe to re-run (IF NOT EXISTS / CREATE OR REPLACE);
// `all` re-applies everything, which is what migrate-neon.mjs used to do on
// every run. A file whose contents changed after it was applied is reported
// and not re-applied: add a new migration instead (or run with `all`).
//
// `run(sql)` executes one multi-statement file; the caller supplies it so the
// same logic drives node-postgres (scripts/migrate-neon.mjs) and PGlite
// (the test database, src/test/pglite/pglite-db.ts).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function listMigrationFiles(sqlDir) {
  return readdirSync(sqlDir).filter((file) => file.endsWith(".sql")).sort();
}

export async function applyMigrations({ sqlDir, run, query, all = false, log = () => {} }) {
  await run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = new Map((await query("SELECT filename, sha256 FROM schema_migrations")).map((row) => [row.filename, row.sha256]));
  const result = { applied: [], skipped: [], changed: [] };
  for (const file of listMigrationFiles(sqlDir)) {
    const contents = readFileSync(path.join(sqlDir, file), "utf8");
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const previous = applied.get(file);
    if (previous && !all) {
      if (previous !== sha256) {
        result.changed.push(file);
        log(`CHANGED after it was applied (not re-applied): ${file}`);
      } else {
        result.skipped.push(file);
      }
      continue;
    }
    log(`Applying ${file}...`);
    await run(contents);
    await query(
      "INSERT INTO schema_migrations (filename, sha256, applied_at) VALUES ($1, $2, now()) ON CONFLICT (filename) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = EXCLUDED.applied_at",
      [file, sha256],
    );
    result.applied.push(file);
  }
  return result;
}
