// Session prompt documents -> PDF (.claude/TASK_SCOPE.json
// note2026_09_25_session_prompt_documents). docs/prompts/README.md has the
// whole pipeline.
//
// Each manuscript renders twice:
//   <name>_bilingual_v<ver>.pdf  English and Korean, plus "Notes for review" -- for people
//   <name>_prompt_v<ver>.pdf     English only, no notes -- exactly the text the model gets
// scripts/extract-prompt-text.mjs reads the second one back.
//
// The Markdown handled here is only what the manuscripts use: front matter,
// headings, paragraphs, numbered and bulleted lists (one level, with wrapped
// continuation lines), **bold**, *italic*, `code`, and `::: ko` blocks. List
// markers are written as literal text rather than <ol>/<ul>, so the numbers
// survive PDF text extraction.
//
// Needs Google Chrome (headless). Usage: node scripts/render-prompt-pdf.mjs [file.md ...]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promptDir = resolve(projectRoot, "docs", "prompts");
const pdfDir = resolve(promptDir, "pdf");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const REVIEW_ONLY_HEADING = "## Notes for review";

export function parseManuscript(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) throw new Error("Manuscript has no front matter");
  const meta = Object.fromEntries(
    match[1].split("\n").filter(Boolean).map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
  for (const key of ["id", "title", "version", "date"]) if (!meta[key]) throw new Error(`Front matter is missing ${key}`);
  return { meta, body: source.slice(match[0].length) };
}

/** The body for one edition: "prompt" drops the Korean blocks and the review notes. */
export function editionBody(body, edition) {
  let text = body;
  if (edition === "prompt") {
    const notes = text.indexOf(`\n${REVIEW_ONLY_HEADING}`);
    if (notes >= 0) text = text.slice(0, notes + 1);
    text = text.replace(/^::: ko\n[\s\S]*?^:::[ \t]*\n?/gm, "");
  }
  return text.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

/** Blocks separated by blank lines; a list block keeps its items and their wrapped lines. */
function blocksToHtml(text) {
  const html = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (!lines.length) continue;
    const heading = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
    if (heading && lines.length === 1) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^(\d+\.|-)\s/.test(lines[0])) {
      const items = [];
      for (const line of lines) {
        const item = /^(\d+\.|-)\s+(.*)$/.exec(line);
        if (item) items.push({ marker: item[1] === "-" ? "•" : item[1], text: item[2] });
        else items[items.length - 1].text += ` ${line.trim()}`;
      }
      html.push(`<div class="list">${items.map((item) => `<p class="item"><span class="marker">${item.marker}</span> ${inline(item.text)}</p>`).join("")}</div>`);
      continue;
    }
    html.push(`<p>${inline(lines.map((line) => line.trim()).join(" "))}</p>`);
  }
  return html.join("\n");
}

function toHtml(meta, body, edition) {
  // Korean blocks become their own styled section in the bilingual edition.
  const parts = [];
  let rest = body;
  const re = /^::: ko\n([\s\S]*?)^:::[ \t]*$/m;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    parts.push(blocksToHtml(rest.slice(0, m.index)));
    parts.push(`<div class="ko">${blocksToHtml(m[1])}</div>`);
    rest = rest.slice(m.index + m[0].length);
  }
  parts.push(blocksToHtml(rest));
  const label = edition === "prompt" ? "Prompt text" : "Review copy (English / 한국어)";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title>
<style>
  @page { size: A4; margin: 18mm 17mm; }
  body { font-family: "Helvetica Neue", "Apple SD Gothic Neo", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; word-break: keep-all; overflow-wrap: anywhere; }
  .docmeta { font-size: 9pt; color: #444; margin-bottom: 8pt; }
  h1 { font-size: 17pt; margin: 0 0 6pt; } h2 { font-size: 13pt; margin: 16pt 0 5pt; } h3 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 6pt; } .list { margin: 0 0 6pt; } .item { margin: 0 0 3pt 14pt; text-indent: -14pt; }
  code { font-family: Menlo, monospace; font-size: 9.5pt; }
  .ko { border-left: 3px solid #b8c7e0; background: #f4f7fb; padding: 4pt 8pt; margin: 2pt 0 10pt; color: #22324d; }
  h2, h3 { break-after: avoid; }
</style></head><body>
<div class="docmeta">TBCT AI session prompt · ${escapeHtml(meta.id)} · version ${escapeHtml(meta.version)} · ${escapeHtml(meta.date)} · ${label}</div>
${parts.join("\n")}
</body></html>`;
}

export function pdfName(meta, edition) {
  const base = meta.id === "common" ? "TBCT_AI_Prompt_Common" : meta.id === "template" ? "TBCT_AI_Prompt_Template" : `TBCT_AI_Prompt_${meta.id.replace(/^tbct-/, "").toUpperCase()}`;
  return `${base}_${edition === "prompt" ? "prompt" : "bilingual"}_v${meta.version}.pdf`;
}

function renderPdf(html, outPath) {
  const work = resolve(tmpdir(), `tbct-prompt-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const htmlPath = resolve(work, `${basename(outPath, ".pdf")}.html`);
  writeFileSync(htmlPath, html, "utf8");
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${outPath}`, `file://${htmlPath}`], { stdio: "ignore" });
  rmSync(work, { recursive: true, force: true });
  if (!existsSync(outPath)) throw new Error(`Chrome produced no PDF for ${outPath}`);
}

function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  const args = process.argv.slice(2);
  const files = args.length ? args.map((file) => resolve(file)) : readdirSync(promptDir).filter((file) => /^TBCT_AI_Prompt_.*\.md$/.test(file)).map((file) => resolve(promptDir, file));
  mkdirSync(pdfDir, { recursive: true });
  for (const file of files) {
    const { meta, body } = parseManuscript(readFileSync(file, "utf8"));
    const editions = meta.id === "template" ? ["bilingual"] : ["bilingual", "prompt"];
    for (const edition of editions) {
      const out = resolve(pdfDir, pdfName(meta, edition));
      renderPdf(toHtml(meta, editionBody(body, edition), edition), out);
      console.log(`rendered ${basename(out)}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
