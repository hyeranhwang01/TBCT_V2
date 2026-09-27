// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/test/pglite/pglite-db";

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
});
