import { Pool, types } from "pg";

// A DATE column (study visit windows, assessment windows) comes back as its
// 'YYYY-MM-DD' text. pg's default turns it into a Date at local midnight,
// which toISOString() moves to the previous day east of UTC. Only the trial
// tables read date columns back (sql/037, sql/038).
types.setTypeParser(1082, (value: string) => value);
// NUMERIC (assessment totals, monitoring averages) as a number, not a string.
// Scores and rounded averages are far inside double precision.
types.setTypeParser(1700, (value: string) => Number(value));

// Server-only Postgres connection pool (Neon, via the pooled DATABASE_URL).
// Never import this from client components -- DATABASE_URL is not exposed to
// the browser bundle, and this module is only reachable through Next.js
// route handlers running in the Node.js runtime.
let pool: Pool | null = null;

export function getPgPool() {
  if (pool) return pool;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not configured.");
  pool = new Pool({ connectionString: dbUrl, max: 3, ssl: { rejectUnauthorized: false } });
  return pool;
}
