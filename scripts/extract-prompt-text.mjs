// Prompt PDFs -> the text the model receives (.claude/TASK_SCOPE.json
// note2026_09_25_session_prompt_documents). docs/prompts/README.md has the
// whole pipeline.
//
// Reads docs/prompts/pdf/*_prompt_v<ver>.pdf (English only), rebuilds lines
// and blocks from the text positions, and writes artifacts/prompts/<id>.txt
// plus artifacts/prompts/manifest.json. Headings are recovered from the font
// size and written back as "#", "##", "###", so the model sees the document's
// structure. Bold and italic do not survive, on purpose -- the prompt is plain
// text.
//
// Every extraction is checked against its manuscript: the words of the PDF
// text must equal the words of the manuscript's prompt edition, in order.
// A mismatch fails the run, so what the model reads is exactly what was
// reviewed.
//
// Usage: node scripts/extract-prompt-text.mjs

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { editionBody, parseManuscript, pdfName } from "./render-prompt-pdf.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promptDir = resolve(projectRoot, "docs", "prompts");
const pdfDir = resolve(promptDir, "pdf");
const outDir = resolve(projectRoot, "artifacts", "prompts");

// Font sizes set in render-prompt-pdf.mjs's stylesheet.
const HEADING_BY_SIZE = [
  { min: 16, prefix: "# " },
  { min: 12.5, prefix: "## " },
  { min: 11.2, prefix: "### " },
];
const META_MAX_SIZE = 9.5;
const LINE_STEP_MAX = 16.5; // body line-height is ~15pt; a larger gap starts a new block

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function headingPrefix(size) {
  return HEADING_BY_SIZE.find((row) => size >= row.min)?.prefix ?? "";
}

async function pdfLines(path) {
  const doc = await getDocument({ url: path, useSystemFonts: true, verbosity: 0 }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const content = await (await doc.getPage(pageNumber)).getTextContent();
    let current = null;
    for (const item of content.items) {
      const y = item.transform[5];
      if (item.str === "" && item.height === 0) continue;
      if (!current || Math.abs(current.y - y) > 1) {
        current = { page: pageNumber, y, x: item.transform[4], size: 0, text: "" };
        lines.push(current);
      }
      current.text += item.str;
      if (item.height > current.size) current.size = item.height;
    }
  }
  return lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() })).filter((line) => line.text);
}

/** Lines -> blocks. A new block starts at a heading, a list marker, a font-size
 * change, or a vertical gap wider than one line. Across a page break a line
 * continues the previous block unless it is itself a heading or list item. */
function linesToText(lines) {
  const body = lines.filter((line, index) => !(index === 0 && line.size <= META_MAX_SIZE));
  const blocks = [];
  let previous = null;
  for (const line of body) {
    const prefix = headingPrefix(line.size);
    const isListStart = /^(\d+\.|•)\s/.test(line.text);
    const samePage = previous && previous.page === line.page;
    // A heading that wrapped onto a second line: same size, directly below.
    const headingWraps = previous && prefix && headingPrefix(previous.size) === prefix && samePage && previous.y - line.y <= line.size * 1.6;
    const continues =
      headingWraps ||
      previous &&
      !prefix &&
      !isListStart &&
      !headingPrefix(previous.size) &&
      Math.abs(previous.size - line.size) < 0.5 &&
      (samePage ? previous.y - line.y <= LINE_STEP_MAX : !/[.:;?!"”)]$/.test(previous.text));
    // Chrome wraps a compound at its hyphen ("one-" / "line"): join those without a space.
    if (continues) blocks[blocks.length - 1] += /\p{L}-$/u.test(blocks[blocks.length - 1]) ? line.text : ` ${line.text}`;
    else blocks.push(`${prefix}${line.text}`);
    previous = line;
  }
  return blocks.join("\n\n") + "\n";
}

/** The manuscript's prompt edition reduced to what a PDF can carry: no
 * emphasis markers, list dashes shown as bullets. */
export function manuscriptPlainText(body) {
  return editionBody(body, "prompt")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^-\s+/gm, "• ");
}

const words = (text) => text.replace(/^#+\s/gm, "").split(/\s+/).filter(Boolean);

function firstDifference(a, b) {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : limit;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const manuscripts = readdirSync(promptDir).filter((file) => /^TBCT_AI_Prompt_.*\.md$/.test(file) && !file.includes("Template"));
  const manifest = { generatedFrom: "docs/prompts/pdf/*_prompt_v*.pdf", entries: [] };
  for (const file of manuscripts.sort()) {
    const source = readFileSync(resolve(promptDir, file), "utf8");
    const { meta, body } = parseManuscript(source);
    const pdf = pdfName(meta, "prompt");
    const text = linesToText(await pdfLines(resolve(pdfDir, pdf)));

    const got = words(text);
    const expected = words(manuscriptPlainText(body));
    const at = firstDifference(got, expected);
    if (at >= 0) {
      const show = (list) => list.slice(Math.max(0, at - 6), at + 6).join(" ");
      throw new Error(`${pdf}: PDF text differs from ${file} at word ${at}\n  pdf:        ${show(got)}\n  manuscript: ${show(expected)}`);
    }

    const txtName = `${meta.id}.txt`;
    writeFileSync(resolve(outDir, txtName), text, "utf8");
    manifest.entries.push({
      id: meta.id,
      title: meta.title,
      version: meta.version,
      date: meta.date,
      manuscript: `docs/prompts/${file}`,
      manuscriptSha256: sha256(source),
      pdf: `docs/prompts/pdf/${pdf}`,
      text: `artifacts/prompts/${txtName}`,
      textSha256: sha256(text),
      textLineCount: text.split("\n").length,
      wordCount: got.length,
    });
    console.log(`${meta.id}: ${got.length} words, verified against ${file}`);
  }
  writeFileSync(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

await main();
