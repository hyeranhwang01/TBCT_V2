// A real Postgres for tests (PGlite, in process), with every migration applied
// by the same runner production uses (scripts/lib/apply-migrations.mjs) and a
// pg-Pool-shaped adapter, so server stores run unchanged against it:
//
//   // @vitest-environment node        <- PGlite needs the node environment
//   const db = vi.hoisted(() => ({ pool: null as unknown }));
//   vi.mock("@/shared/data/db/pg-pool", () => ({ getPgPool: () => db.pool }));
//   beforeAll(async () => { db.pool = (await createTestDatabase()).pool; });
//
// Supabase pieces the migrations reference are stubbed: the auth schema, with
// auth.uid() / auth.jwt() read from the request.jwt.claims setting (set it to
// act as a user in an RLS test), the anon/authenticated/service_role roles,
// and the supabase_realtime publication.
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
// @ts-expect-error -- plain .mjs shared with scripts/migrate-neon.mjs
import { applyMigrations } from "../../../scripts/lib/apply-migrations.mjs";

export type TestPool = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>;
  connect: () => Promise<{ query: TestPool["query"]; release: () => void }>;
  end: () => Promise<void>;
};

const SUPABASE_STUBS = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

export async function createTestDatabase(): Promise<{ db: PGlite; pool: TestPool; migrate: (all?: boolean) => Promise<{ applied: string[]; skipped: string[]; changed: string[] }> }> {
  // DATE as 'YYYY-MM-DD' text and NUMERIC as a number, like the production
  // pool (pg-pool.ts).
  const db = new PGlite({ parsers: { 1082: (value: string) => value, 1700: (value: string) => Number(value) } });
  await db.exec(SUPABASE_STUBS);
  const sqlDir = path.resolve(__dirname, "../../../sql");
  const migrate = (all = false) =>
    applyMigrations({
      sqlDir,
      all,
      run: (sql: string) => db.exec(sql),
      query: async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows,
    });
  await migrate();
  const query: TestPool["query"] = async (text, params) => {
    const result = await db.query(text, params as unknown[] | undefined);
    return { rows: result.rows as never[], rowCount: result.affectedRows ?? result.rows.length };
  };
  // PGlite is one connection: a "client" is the same connection, which is
  // enough for BEGIN/COMMIT used sequentially.
  const pool: TestPool = { query, connect: async () => ({ query, release: () => undefined }), end: async () => db.close() };
  return { db, pool, migrate };
}
