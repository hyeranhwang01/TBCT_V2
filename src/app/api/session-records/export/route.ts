import { NextResponse } from "next/server";
import { listSessionRecords, recordRecordDownload } from "@/shared/data/server/trial/records-store";
import { getStaffCaller } from "@/shared/supabase/server";
import { sessionRecordsCsv } from "@/shared/trial/session-record-export";
import type { SessionRecordRow } from "@/types/trial";

export const runtime = "nodejs";

// Downloads a participant's sealed session records (sql/034) for the
// research team: JSON (the snapshots as sealed, with their hashes) or CSV
// (one row per message). Clinician and admin only. The download is written
// to session_record_downloads before the file is returned, so a download
// that is not on record never leaves the server.
// .claude/TASK_SCOPE.json note2026_09_28_rct_backend.

export async function GET(request: Request) {
  try {
    const caller = await getStaffCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    if (caller.role !== "clinician" && caller.role !== "admin") return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    const url = new URL(request.url);
    const participantId = url.searchParams.get("participantId")?.trim();
    if (!participantId) return NextResponse.json({ ok: false, error: "participantId is required." }, { status: 400 });
    const moduleParam = url.searchParams.get("module");
    const moduleNumber = moduleParam ? Number(moduleParam) : undefined;
    if (moduleNumber !== undefined && !(Number.isInteger(moduleNumber) && moduleNumber >= 1 && moduleNumber <= 8)) return NextResponse.json({ ok: false, error: "module must be 1-8." }, { status: 400 });
    const attempts = url.searchParams.get("attempts") === "official" ? "official" : "all";
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

    const records = (await listSessionRecords(participantId, moduleNumber)).filter((record: SessionRecordRow) => attempts === "all" || record.isOfficialAtWrite);
    await recordRecordDownload({ userId: caller.userId, role: caller.role }, { participantId, moduleNumber: moduleNumber ?? null, attempts, format, recordHashes: records.map((record) => record.contentSha256) });

    const name = `session-records_${participantId}${moduleNumber ? `_m${moduleNumber}` : ""}_${attempts}`.replace(/[^A-Za-z0-9_.-]/g, "_");
    if (format === "csv") {
      return new Response(sessionRecordsCsv(records), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" } });
    }
    return new Response(JSON.stringify({ participantId, moduleNumber: moduleNumber ?? null, attempts, exportedAt: new Date().toISOString(), records }, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}.json"`, "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Export failed." }, { status: 500 });
  }
}
