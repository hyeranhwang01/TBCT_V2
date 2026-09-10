import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const sourcePath = resolve(projectRoot, "artifacts", "tbct-source-text.txt");
const manifestPath = resolve(projectRoot, "artifacts", "tbct-source-ingestion.json");
const outputPath = resolve(projectRoot, "src", "shared", "protocol", "tbct-source-text.generated.ts");

const [sourceText, manifestText] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
const manifest = JSON.parse(manifestText);
const sourceHash = createHash("sha256").update(sourceText, "utf8").digest("hex");

if (sourceHash !== manifest.sourceTextHash) {
  throw new Error(`Source hash mismatch: expected ${manifest.sourceTextHash}, received ${sourceHash}`);
}

const sourceLines = sourceText.split(/\r?\n/);
if (sourceLines.length !== manifest.sourceLineCount) {
  throw new Error(`Source line-count mismatch: expected ${manifest.sourceLineCount}, received ${sourceLines.length}`);
}

const output = `/* This file is generated from artifacts/tbct-source-text.txt. Do not hand-edit. */
export const TBCT_SOURCE_TEXT_HASH = ${JSON.stringify(sourceHash)};
export const TBCT_SOURCE_LINE_COUNT = ${sourceLines.length};
export const TBCT_SOURCE_LINES = ${JSON.stringify(sourceLines, null, 2)} as const;

export function getTbctSourceLine(lineNumber: number) {
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > TBCT_SOURCE_LINES.length) {
    throw new Error(\`Source line out of range: \${lineNumber}\`);
  }
  return TBCT_SOURCE_LINES[lineNumber - 1];
}

export function getTbctSourceExcerpt(sourceLineStart: number, sourceLineEnd: number) {
  if (!Number.isInteger(sourceLineStart) || !Number.isInteger(sourceLineEnd) || sourceLineStart < 1 || sourceLineEnd < sourceLineStart || sourceLineEnd > TBCT_SOURCE_LINES.length) {
    throw new Error(\`Invalid source range: \${sourceLineStart}-\${sourceLineEnd}\`);
  }
  return TBCT_SOURCE_LINES.slice(sourceLineStart - 1, sourceLineEnd).join("\\n");
}

export function getTbctSourceQuotedText(sourceLineStart: number, sourceLineEnd: number, occurrence = 0) {
  const matches = [...getTbctSourceExcerpt(sourceLineStart, sourceLineEnd).matchAll(/"([^"\\n]+)"/g)];
  const match = matches[occurrence];
  if (!match) {
    throw new Error(\`No quoted source text at \${sourceLineStart}-\${sourceLineEnd}, occurrence \${occurrence}\`);
  }
  return match[1];
}

export function getTbctSourceFragment(sourceLineStart: number, sourceLineEnd: number, startMarker: string, endMarker?: string) {
  const excerpt = getTbctSourceExcerpt(sourceLineStart, sourceLineEnd);
  const start = excerpt.indexOf(startMarker);
  if (start < 0) throw new Error(\`Source start marker not found: \${startMarker}\`);
  const fromStart = excerpt.slice(start + startMarker.length);
  if (!endMarker) return fromStart;
  const end = fromStart.indexOf(endMarker);
  if (end < 0) throw new Error(\`Source end marker not found: \${endMarker}\`);
  return fromStart.slice(0, end);
}
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");
console.log(`Generated ${outputPath} from ${sourceLines.length} source lines with SHA-256 ${sourceHash}.`);