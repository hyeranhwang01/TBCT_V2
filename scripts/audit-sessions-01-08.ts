import "fake-indexeddb/auto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getLocalDb } from "../src/shared/data/db/tbct-local-db";
import { runSessions01To08Audit, type SessionFidelityAudit } from "../src/shared/runtime/testing/simulated-patient-runner";
import { installFakeStoreFetch, resetAllFakeStores } from "../src/test/fakes/install-fake-store-fetch";

function markdown(report: SessionFidelityAudit) {
  return `# ${report.sessionId.toUpperCase()} fidelity audit

- Release: ${report.releaseId}
- Patient turns: ${report.patientTurns}
- Program turns: ${report.programTurns}
- PromptItems executed: ${report.promptItemsExecuted.length}
- PromptItems skipped: ${report.promptItemsSkipped.length}
- Fallbacks: ${report.fallbackCount}
- Repairs: ${report.repairCount}
- Provider errors: ${report.providerErrorCount}
- Clarifications: ${report.clarificationCount}
- Safety overrides: ${report.safetyOverrideCount}
- Final state: ${report.finalState}
- Result: **${report.result.toUpperCase()}**

## Executed PromptItems

${report.promptItemsExecuted.map((id) => `- ${id}`).join("\n")}

## Field extraction

- Expected reachable fields: ${report.expectedFields.join(", ") || "none"}
- Captured fields: ${report.capturedFields.join(", ") || "none"}
- Missing fields: ${report.missingFields.join(", ") || "none"}
`;
}

// The six Postgres-backed store endpoints are served from the in-memory fakes
// the test suite uses, so this runs fully offline. Without it every repository
// call fetches http://localhost:3000 and the script dies on ECONNREFUSED --
// which is why it silently rotted after the conversation store moved.
//
// The dialogue agent is deliberately NOT faked here. runSessions01To08Audit
// sets AI_PROVIDER=mock, which the agent now honours by returning its
// deterministic decision without calling out -- so this audit measures the
// protocol's own structure against exactly the text the runtime ships when no
// model is in the loop. Faking the agent would substitute a different,
// keyword-driven decision and make the audit depend on the fake's quality.
installFakeStoreFetch();
resetAllFakeStores();

const db = getLocalDb();
await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
const reports = await runSessions01To08Audit();
const output = resolve(process.cwd(), "artifacts", "session-fidelity");
await mkdir(output, { recursive: true });
for (const report of reports) {
  const slug = report.sessionId.replace("tbct-", "");
  await writeFile(resolve(output, `${slug}-report.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(resolve(output, `${slug}-report.md`), markdown(report), "utf8");
}
const table = reports.map((report) => `| ${report.sessionId.replace("tbct-", "").toUpperCase()} | yes | pass | pass | ${report.missingFields.length ? "fail" : "pass"} | pass | ${report.fallbackCount} | ${report.providerErrorCount} | ${report.result} |`).join("\n");
const summary = `# Sessions 01-08 aggregate fidelity audit

Provider path: deterministic mock contract. Live-Claude integration is reported separately and is not represented as eight full live runs.

| Session | Full run completed | Prompt sequence | Content fidelity | Field fidelity | Transition fidelity | Fallbacks | Provider errors | Final result |
|---|---|---|---|---|---|---:|---:|---|
${table}
`;
await writeFile(resolve(output, "summary.md"), summary, "utf8");
await writeFile(resolve(output, "summary.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), providerPath: "deterministic", reports }, null, 2)}\n`, "utf8");
console.log(JSON.stringify(reports.map(({ sessionId, patientTurns, programTurns, fallbackCount, providerErrorCount, finalState, result }) => ({ sessionId, patientTurns, programTurns, fallbackCount, providerErrorCount, finalState, result }))));
