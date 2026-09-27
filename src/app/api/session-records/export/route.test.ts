import { beforeEach, describe, expect, it, vi } from "vitest";

// The session-record download: clinician and admin only, and the download
// is on record before the file leaves the server.

const caller = vi.hoisted(() => ({ current: null as null | { userId: string; email: string | null; role: string } }));
const calls = vi.hoisted(() => [] as string[]);
const downloads = vi.hoisted(() => [] as unknown[]);
const failDownloadLog = vi.hoisted(() => ({ on: false }));

vi.mock("@/shared/supabase/server", () => ({ getStaffCaller: async () => caller.current }));
vi.mock("@/shared/data/server/trial/records-store", () => ({
  listSessionRecords: async () => {
    calls.push("list");
    return [
      { id: "REC-1", runtimeSessionId: "RS-1", participantId: "P-1", moduleNumber: 1, sessionNumber: 1, attemptNumber: 1, endStatus: "completed", isOfficialAtWrite: true, schemaVersion: "v1", contentSha256: "aaa", createdAt: "2026-09-28T00:00:00.000Z", snapshot: { conversation: [{ role: "assistant", content: "안녕하세요, \"오늘\"", createdAt: "2026-09-28T00:00:00.000Z", metadata: { step: 1 } }, { role: "patient", content: "=SUM(A1)", createdAt: "2026-09-28T00:01:00.000Z" }] } },
      { id: "REC-2", runtimeSessionId: "RS-2", participantId: "P-1", moduleNumber: 1, sessionNumber: null, attemptNumber: 2, endStatus: "completed", isOfficialAtWrite: false, schemaVersion: "v1", contentSha256: "bbb", createdAt: "2026-09-28T00:00:00.000Z", snapshot: { conversation: [] } },
    ];
  },
  recordRecordDownload: async (...args: unknown[]) => {
    calls.push("audit");
    if (failDownloadLog.on) throw new Error("audit write failed");
    downloads.push(args);
  },
}));

import { GET } from "@/app/api/session-records/export/route";

const get = (query: string) => GET(new Request(`http://test/api/session-records/export?${query}`));

beforeEach(() => {
  calls.length = 0;
  downloads.length = 0;
  failDownloadLog.on = false;
  caller.current = { userId: "clin-1", email: null, role: "clinician" };
});

describe("/api/session-records/export", () => {
  it("is refused to everyone but clinicians and admins", async () => {
    for (const role of ["patient", "assessor", "coordinator"]) {
      caller.current = { userId: "u", email: null, role };
      expect((await get("participantId=P-1")).status).toBe(403);
    }
    caller.current = null;
    expect((await get("participantId=P-1")).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("records the download, with the hashes, before returning the file", async () => {
    const response = await get("participantId=P-1&attempts=official&format=json");
    expect(response.status).toBe(200);
    expect(calls).toEqual(["list", "audit"]);
    expect(downloads[0]).toEqual([{ userId: "clin-1", role: "clinician" }, { participantId: "P-1", moduleNumber: null, attempts: "official", format: "json", recordHashes: ["aaa"] }]);
    const body = await response.json();
    expect(body.records.map((record: { id: string }) => record.id)).toEqual(["REC-1"]);
  });

  it("returns nothing when the download cannot be recorded", async () => {
    failDownloadLog.on = true;
    const response = await get("participantId=P-1");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("안녕하세요");
  });

  it("writes one CSV row per message, quoted, with spreadsheet formulas neutralised", async () => {
    const response = await get("participantId=P-1&format=csv");
    const text = await response.text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("participant_id,module_number,session_number,attempt_number,official,end_status,record_sha256,seq,role,created_at,step,focus_field,content");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"안녕하세요, ""오늘"""');
    expect(lines[2].endsWith(",'=SUM(A1)")).toBe(true);
  });
});
