// Applies new sql/*.sql migration files (in filename order) to the database
// pointed at by DATABASE_URL, recording each in schema_migrations
// (scripts/lib/apply-migrations.mjs). `--all` re-applies every file -- each is
// written to be safe to re-run -- which is what this script did on every run
// before migrations were tracked.
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { applyMigrations } from "./lib/apply-migrations.mjs";

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` or check .env.local.");
  process.exit(1);
}

// Multi-statement raw SQL files need the full Postgres wire protocol
// (a plain TCP client), not a single-statement HTTP driver.
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "sql");
try {
  const result = await applyMigrations({
    sqlDir,
    all: process.argv.includes("--all"),
    run: (sql) => client.query(sql),
    query: async (sql, params) => (await client.query(sql, params)).rows,
    log: (line) => console.log(line),
  });
  console.log(`Done. Applied ${result.applied.length}, already applied ${result.skipped.length}, changed-after-apply ${result.changed.length}.`);
  if (result.changed.length) process.exitCode = 2;
} finally {
  await client.end();
}
