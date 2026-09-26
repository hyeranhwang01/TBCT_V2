// artifacts/prompts -> src/shared/protocol/session-prompts.generated.ts
// (.claude/TASK_SCOPE.json note2026_09_25_session_prompt_documents), the same
// way scripts/generate-tbct-source-text.mjs turns the source manual into
// tbct-source-text.generated.ts: every text is re-hashed and must match the
// manifest written by scripts/extract-prompt-text.mjs, so the generated file
// can only hold text that came out of a reviewed PDF.
//
// Usage: node scripts/generate-session-prompts.mjs

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(projectRoot, "artifacts", "prompts", "manifest.json");
const outputPath = resolve(projectRoot, "src", "shared", "protocol", "session-prompts.generated.ts");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entries = manifest.entries.map((entry) => {
  const text = readFileSync(resolve(projectRoot, entry.text), "utf8");
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  if (hash !== entry.textSha256) throw new Error(`${entry.text}: hash ${hash} does not match the manifest (${entry.textSha256}); re-run scripts/extract-prompt-text.mjs`);
  return { id: entry.id, title: entry.title, version: entry.version, date: entry.date, pdf: entry.pdf, sha256: hash, text };
});

const common = entries.find((entry) => entry.id === "common");
if (!common) throw new Error("The manifest has no common prompt");
const sessions = entries.filter((entry) => entry.id !== "common");

const literal = (entry) => `{
    id: ${JSON.stringify(entry.id)},
    title: ${JSON.stringify(entry.title)},
    version: ${JSON.stringify(entry.version)},
    date: ${JSON.stringify(entry.date)},
    pdf: ${JSON.stringify(entry.pdf)},
    sha256: ${JSON.stringify(entry.sha256)},
    text: ${JSON.stringify(entry.text)},
  }`;

const output = `/* This file is generated from artifacts/prompts by scripts/generate-session-prompts.mjs. Do not hand-edit. */
export type SessionPromptDocument = {
  id: string;
  title: string;
  version: string;
  date: string;
  pdf: string;
  sha256: string;
  text: string;
};

export const COMMON_PROMPT: SessionPromptDocument = ${literal(common)};

export const SESSION_PROMPTS: Readonly<Record<string, SessionPromptDocument>> = {
${sessions.map((entry) => `  ${JSON.stringify(entry.id)}: ${literal(entry)},`).join("\n")}
};

/** The full system prompt for a session: the common rules, then the session document. */
export function sessionSystemPrompt(sessionDefinitionId: string): string | undefined {
  const session = SESSION_PROMPTS[sessionDefinitionId];
  return session ? \`\${COMMON_PROMPT.text}\\n\${session.text}\` : undefined;
}
`;

writeFileSync(outputPath, output, "utf8");
console.log(`Generated ${outputPath}: common v${common.version} + ${sessions.map((entry) => `${entry.id} v${entry.version}`).join(", ")}`);
