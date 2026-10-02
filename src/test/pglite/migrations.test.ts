// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/test/pglite/pglite-db";
import { rowCounts, truncateAppTables } from "../../../scripts/lib/reset-data";

describe("migrations on a real Postgres", () => {
  it("apply once, are recorded, and a second run applies nothing; --all re-applies everything cleanly", async () => {
    const { db, migrate } = await createTestDatabase();
    const recorded = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n;
    expect(recorded).toBeGreaterThan(30);
    expect((await migrate()).applied).toEqual([]);
    const again = await migrate(true);
    expect(again.applied.length).toBe(recorded);
    await db.close();
  }, 60_000);

  it("leave the unused tables dropped (sql/042)", async () => {
    const { db } = await createTestDatabase();
    const { rows } = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const names = rows.map((row) => row.table_name);
    for (const dropped of ["conversation_sessions", "conversation_messages", "memory_candidates", "memory_review_decisions", "memory_retrieval_runs", "memory_usage_logs"]) expect(names).not.toContain(dropped);
    for (const kept of ["runtime_sessions", "runtime_messages", "runtime_session_summaries", "goal_tracking_records", "homework_tracking_records", "longitudinal_memories"]) expect(names).toContain(kept);
    await db.close();
  }, 60_000);

  it("empty every app table on reset, append-only ones included, and keep the migration record", async () => {
    const { db, pool } = await createTestDatabase();
    await db.query("INSERT INTO runtime_sessions (id, participant_id, protocol_id, release_id, status, updated_at, created_at, data) VALUES ('RS-1','P-1','p','r','completed',now(),now(),'{}')");
    await db.query("INSERT INTO runtime_messages (id, runtime_session_id, role, created_at, data) VALUES ('M-1','RS-1','patient',now(),'{}')");
    // Append-only (sql/043): emptied by TRUNCATE like the rest.
    await db.query("INSERT INTO memory_chunk_validity_events (id, chunk_id, participant_id, state, reason) VALUES ('MCV-1','MCH-1','P-1','invalid','x')");
    const tables = await truncateAppTables(pool as never);
    expect(tables).not.toContain("schema_migrations");
    expect(Object.values(await rowCounts(pool as never)).every((count) => count === 0)).toBe(true);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n).toBeGreaterThan(40);
    await db.close();
  }, 60_000);
});
