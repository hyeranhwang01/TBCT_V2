import { Pool } from "pg";

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
