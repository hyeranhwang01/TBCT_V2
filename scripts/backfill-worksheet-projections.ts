// One-off backfill: projects every existing runtime session's already-
// canonical RuntimeContext.fields into worksheet_field_values. Needed
// because projectRuntimeFieldsToWorksheet only runs on the turn-commit
// path (see worksheet-projection.ts) -- any session played through before
// its sessionDefinitionId had a worksheet-binding registry entry (i.e.
// every S01/S02/S04-S08 session run before that registry was extended)
// never got projected, even though the canonical answers themselves were
// always saved. This does not touch RuntimeContext.fields at all -- it
// only re-derives worksheet_field_values from what's already there, the
// same write path a real turn would have used.
import { listRuntimeSessions } from "../src/shared/api/runtime-session-api";
import { projectRuntimeFieldsToWorksheet } from "../src/shared/worksheet/worksheet-projection";
import { hasWorksheetBindings } from "../src/shared/worksheet/worksheet-binding-registry";

const BASE_URL = process.env.RUNTIME_BASE_URL ?? "http://localhost:3011";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith("/")) return realFetch(`${BASE_URL}${url}`, init);
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  const sessions = await listRuntimeSessions();
  console.log(`Found ${sessions.length} runtime sessions total.`);
  let projected = 0;
  let skippedNoBinding = 0;
  let skippedNoFields = 0;
  for (const session of sessions) {
    if (!hasWorksheetBindings(session.sessionDefinitionId)) {
      skippedNoBinding += 1;
      continue;
    }
    const fields = session.runtimeContext?.fields ?? {};
    if (Object.keys(fields).length === 0) {
      skippedNoFields += 1;
      continue;
    }
    await projectRuntimeFieldsToWorksheet({
      runtimeSessionId: session.id,
      sessionDefinitionId: session.sessionDefinitionId,
      fields,
    });
    projected += 1;
    console.log(`projected ${session.id} (${session.sessionDefinitionId}) -- ${Object.keys(fields).length} fields`);
  }
  console.log(`\nDone. Projected ${projected} sessions, skipped ${skippedNoBinding} (no binding), skipped ${skippedNoFields} (no fields yet).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
