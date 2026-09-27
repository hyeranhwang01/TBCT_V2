// One-off backfill: memory chunks (sql/027) for sessions completed before
// chunking existed (.claude/TASK_SCOPE.json note2026_09_27_memory_rag_m2_chunks),
// plus every homework entry written so far. The same code path as a live
// completion (indexAtCompletion); chunk ids are stable, so running it twice
// adds nothing.
//
// Talks to the database in DATABASE_URL directly, through the in-process
// store dispatch -- no running server. Without --apply it only lists what it
// would index.
//
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/backfill-memory-chunks.ts            # list
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/backfill-memory-chunks.ts --apply    # write
import "../src/shared/data/server/runtime-request-context";
import { listRuntimeSessions } from "../src/shared/api/runtime-session-api";
import { indexAtCompletion } from "../src/shared/memory/memory-indexer";

async function main() {
  const apply = process.argv.includes("--apply");
  const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : undefined;
  if (!target) throw new Error("DATABASE_URL is not set.");
  console.log(`Database: ${target}${apply ? "" : "  (listing only -- pass --apply to write)"}`);

  const completed = (await listRuntimeSessions()).filter((session) => session.status === "completed" && session.participantId);
  console.log(`${completed.length} completed sessions.`);
  let inserted = 0;
  for (const session of completed) {
    if (!apply) {
      console.log(`would index ${session.id} (${session.sessionDefinitionId}, participant ${session.participantId})`);
      continue;
    }
    const result = await indexAtCompletion(session.id);
    inserted += result.session.inserted + result.homework.inserted;
    console.log(`${session.id} (${session.sessionDefinitionId}): session ${result.session.inserted}/${result.session.built} new, homework ${result.homework.inserted}/${result.homework.built} new`);
  }
  if (apply) console.log(`\nDone. ${inserted} new chunks.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
