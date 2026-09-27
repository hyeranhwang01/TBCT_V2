// Erases AI interaction data once the retention period has passed
// (Protocol V9 p.18: kept 5 years, then deleted; .claude/TASK_SCOPE.json
// note2026_09_28_rct_backend). The period runs from the study's database lock
// (study_locks) and is studies.retention_years long. Participants who gave
// the extended-retention consent are kept.
//
// What is erased, per participant: their runtime sessions and everything
// keyed to them (conversation, logs, checkpoints, model/validation events,
// traces, summaries, sealed records, memory retrievals, events), and their
// memory chunks and runtime events. The trial record itself -- allocation,
// visits, assessments, adverse events -- is kept: it is the study's data,
// not the AI's. Review this list with the research team before --apply.
//
// Without --apply it only lists. --apply also needs --confirm <study code>.
// It runs with tbct.allow_erasure on, the one way past the append-only and
// lock triggers.
//
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/purge-retention.ts
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/purge-retention.ts --apply --confirm TBCT-RCT-KR
import { getPgPool } from "../src/shared/data/db/pg-pool";
import { eraseStudyAiData, findExpiredStudies } from "./lib/trial-extract";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : undefined;
  if (!target) throw new Error("DATABASE_URL is not set.");
  const pool = getPgPool();
  console.log(`Database: ${target}${apply ? "" : "  (listing only)"}`);
  const studies = await findExpiredStudies(pool as never);
  if (!studies.length) {
    console.log("No study is past its retention period.");
    return;
  }
  for (const study of studies) {
    console.log(`${study.code}: locked ${study.lockedAt.slice(0, 10)}, retention ${study.retentionYears} years; ${study.participants.length} participants to erase.`);
    console.log(`  session-keyed tables: ${study.sessionTables.join(", ")}`);
    if (!apply) continue;
    if (argument("--confirm") !== study.code) throw new Error(`--confirm ${study.code} is required to erase this study's AI data.`);
    const counts = await eraseStudyAiData(pool as never, study);
    for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count} rows`);
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
