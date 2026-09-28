// De-identified analysis extract of one country's study database
// (.claude/TASK_SCOPE.json note2026_09_28_rct_backend). The countries' extracts
// are merged for analysis by concatenating the same-named files: every row
// carries the study code (TBCT-KR-001 ...), never an app account id, and dates
// are study days (days since enrolment), not calendar dates. Free text
// (conversations, AE descriptions, notes) is left out; the coded fields stay.
// Participants withdrawn with "exclude from analysis" or "erasure requested"
// are left out entirely.
//
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/export-deidentified.ts --out ./extract-KR
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPgPool } from "../src/shared/data/db/pg-pool";
import { csvCell } from "../src/shared/trial/session-record-export";
import { EXTRACT_QUERIES } from "./lib/trial-extract";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const out = argument("--out");
  if (!out) throw new Error("--out <directory> is required.");
  const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : undefined;
  if (!target) throw new Error("DATABASE_URL is not set.");
  mkdirSync(out, { recursive: true });
  const pool = getPgPool();
  for (const [name, sql] of Object.entries(EXTRACT_QUERIES)) {
    const { rows, fields } = await pool.query(sql);
    const columns = fields.map((field) => field.name);
    const lines = [columns.join(","), ...rows.map((row: Record<string, unknown>) => columns.map((column) => csvCell(row[column])).join(","))];
    writeFileSync(path.join(out, `${name}.csv`), `﻿${lines.join("\r\n")}\r\n`);
    console.log(`${name}.csv: ${rows.length} rows`);
  }
  console.log(`\nWritten to ${path.resolve(out)} from ${target}.`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
