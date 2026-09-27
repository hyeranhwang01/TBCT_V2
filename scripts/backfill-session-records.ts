// Seals every ended session that has no record yet (sql/034, .claude/
// TASK_SCOPE.json note2026_09_28_rct_backend): sessions that ended before
// sealing existed, and any whose sealing failed (RECORD_FINALIZE_FAILED in
// runtime_events). Oldest first, so the first completed attempt of each
// session is the one marked official. Idempotent.
//
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/backfill-session-records.ts            # list
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/backfill-session-records.ts --apply    # write
import "../src/shared/data/server/runtime-request-context";
import { getPgPool } from "../src/shared/data/db/pg-pool";
import { dispatchTrialStoreOp } from "../src/shared/data/server/trial-store";

async function main() {
  const apply = process.argv.includes("--apply");
  const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : undefined;
  if (!target) throw new Error("DATABASE_URL is not set.");
  console.log(`Database: ${target}${apply ? "" : "  (listing only -- pass --apply to write)"}`);
  const { rows } = await getPgPool().query<{ id: string; status: string; module_number: number | null; attempt_number: number | null }>(
    `SELECT s.id, s.status, s.module_number, s.attempt_number FROM runtime_sessions s
     WHERE s.status IN ('completed', 'terminated') AND NOT EXISTS (SELECT 1 FROM session_records r WHERE r.runtime_session_id = s.id)
     ORDER BY coalesce(s.ended_at, (s.data ->> 'completedAt')::timestamptz, (s.data ->> 'terminatedAt')::timestamptz, s.updated_at), s.id`,
  );
  console.log(`${rows.length} ended sessions without a sealed record.`);
  let sealed = 0;
  for (const session of rows) {
    if (!apply) {
      console.log(`would seal ${session.id} (${session.status}, module ${session.module_number ?? "-"}, attempt ${session.attempt_number ?? "-"})`);
      continue;
    }
    try {
      const result = (await dispatchTrialStoreOp({ op: "finalizeSessionRecord", runtimeSessionId: session.id })) as { inserted: boolean; isOfficial: boolean };
      if (result.inserted) sealed += 1;
      console.log(`${session.id}: ${result.inserted ? "sealed" : "already sealed"}${result.isOfficial ? ", official" : ""}`);
    } catch (error) {
      console.error(`${session.id}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
  if (apply) console.log(`\nDone. ${sealed} records sealed.`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
