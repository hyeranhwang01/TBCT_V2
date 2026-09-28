// Empties every table of the app database, keeping the tables themselves and
// the migration record (scripts/reset-test-data.ts). For a database that only
// ever held test data. .claude/TASK_SCOPE.json note2026_09_28_drop_unused_tables.

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

const KEEP = new Set(["schema_migrations"]);

export async function appTables(db: Queryable) {
  const { rows } = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
  return rows.map((row) => String(row.table_name)).filter((name) => !KEEP.has(name));
}

export async function rowCounts(db: Queryable) {
  const counts: Record<string, number> = {};
  for (const table of await appTables(db)) counts[table] = Number((await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
  return counts;
}

/** One TRUNCATE of every app table (row triggers, including the append-only
 * ones, do not fire on TRUNCATE; all rows go at once or none do). */
export async function truncateAppTables(db: Queryable) {
  const tables = await appTables(db);
  if (tables.length) await db.query(`TRUNCATE ${tables.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`);
  return tables;
}
