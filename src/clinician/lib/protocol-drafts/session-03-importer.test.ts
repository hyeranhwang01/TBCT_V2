import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { importRealSession03 } from "@/clinician/lib/protocol-drafts/session-03-importer";

describe("importRealSession03", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("is idempotent across repeated runs", async () => {
    const first = await importRealSession03(true);
    const second = await importRealSession03();
    const db = getLocalDb();

    expect(first.createdNodeIds.length).toBeGreaterThan(0);
    expect(second.createdNodeIds).toHaveLength(0);
    expect(await db.protocolGraphNodes.where({ protocolId: "tbct-br-001", sessionId: "tbct-br-001-session-03" }).count()).toBeGreaterThan(0);
    expect(await db.protocolGraphEdges.where({ protocolId: "tbct-br-001", sessionId: "tbct-br-001-session-03" }).count()).toBeGreaterThan(0);
  });
});