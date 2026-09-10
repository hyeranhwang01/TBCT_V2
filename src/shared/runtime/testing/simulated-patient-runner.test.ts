import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { runSessions01To08Audit } from "@/shared/runtime/testing/simulated-patient-runner";

describe("Sessions 01-08 simulated patient audit", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
  });

  it("completes every reachable normal path with source-specific Program turns", async () => {
    const reports = await runSessions01To08Audit();
    expect(reports).toHaveLength(8);
    expect(reports.map((report) => ({ session: report.sessionId, result: report.result, state: report.finalState, fallbacks: report.fallbackCount, errors: report.providerErrorCount, missing: report.missingFields })))
      .toEqual(reports.map((report) => ({ session: report.sessionId, result: "pass", state: "completed", fallbacks: 0, errors: 0, missing: [] })));
  }, 120_000);
});

