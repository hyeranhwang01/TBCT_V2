// Sets up the study in one country's database (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend): Protocol V9 arms, 12-week schedules, the
// country's site, assessment timepoints and instruments
// (src/shared/trial/default-study-config.ts). Safe to run again: it updates
// the configuration in place and never touches participants.
//
// Optional:
//   --release-model <model id> --release-label <label>   create and freeze an AI release
//                                                         from the prompts deployed now
//   --activate                                            set the study active (the session
//                                                         gate is enforced from then on)
//   --dev-list <n per stratum>                            a development randomization list
//                                                         (permuted blocks of 6). Refused for
//                                                         an active study: the real list comes
//                                                         from the independent statistician.
//
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/seed-trial.ts --country KR            # show
//   DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/seed-trial.ts --country KR --apply    # write
import { randomInt } from "node:crypto";
import "../src/shared/data/server/runtime-request-context";
import { dispatchTrialStoreOp } from "../src/shared/data/server/trial-store";
import { COUNTRY_SITES, defaultStudyConfig } from "../src/shared/trial/default-study-config";
import type { TrialStoreOp } from "../src/shared/trial/trial-store-ops";

const ARMS = ["CLINICIAN_ONLY", "AI_CLINICIAN", "AI_LED"];

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function devList(sites: string[], perStratum: number) {
  const lines = ["stratum,sequence,arm"];
  for (const site of sites) {
    for (const diagnosis of ["MDD", "ANXIETY"]) {
      let sequence = 1;
      while (sequence <= perStratum) {
        const block = [...ARMS, ...ARMS];
        for (let index = block.length - 1; index > 0; index -= 1) {
          const swap = randomInt(index + 1);
          [block[index], block[swap]] = [block[swap], block[index]];
        }
        for (const arm of block) if (sequence <= perStratum) lines.push(`${site}|${diagnosis},${sequence++},${arm}`);
      }
    }
  }
  return lines.join("\n");
}

async function run(op: TrialStoreOp) {
  return dispatchTrialStoreOp({ ...op, actor: { userId: "seed-trial", role: "admin" } });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const country = (argument("--country") ?? process.env.STUDY_COUNTRY ?? "").toUpperCase();
  if (!COUNTRY_SITES[country]) throw new Error(`--country must be one of ${Object.keys(COUNTRY_SITES).join(", ")}`);
  const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : undefined;
  if (!target) throw new Error("DATABASE_URL is not set.");
  const activate = process.argv.includes("--activate");
  const config = defaultStudyConfig(country, activate ? "active" : "draft");
  console.log(`Database: ${target}${apply ? "" : "  (showing only -- pass --apply to write)"}`);
  console.log(`Study ${config.study.code} (${config.study.status}): ${config.arms.length} arms, sites ${config.sites.map((site) => site.code).join(", ")}, ${config.timepoints.length} timepoints.`);
  const releaseModel = argument("--release-model");
  const devPerStratum = argument("--dev-list");
  if (devPerStratum && activate) throw new Error("A development list is not for an active study.");
  if (!apply) return;

  await run({ op: "configureStudy", config });
  console.log("Study configured.");
  if (releaseModel) {
    const release = (await run({ op: "createAiRelease", release: { label: argument("--release-label") ?? releaseModel, modelId: releaseModel } })) as { id: string };
    await run({ op: "freezeAiRelease", releaseId: release.id });
    console.log(`AI release ${release.id} (${releaseModel}) created and frozen.`);
  }
  if (devPerStratum) {
    const csv = devList(config.sites.map((site) => site.code), Number(devPerStratum));
    await run({ op: "uploadRandomizationList", listVersion: `dev-${Date.now()}`, csv });
    console.log(`Development randomization list uploaded (${devPerStratum} per stratum).`);
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
