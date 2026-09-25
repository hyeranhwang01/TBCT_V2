# Session prompt documents

The session prompts that will run Sessions 1 and 2 end to end (.claude/TASK_SCOPE.json
`note2026_09_25_session_prompt_documents`). The Markdown files here are the manuscripts;
the PDFs are what people review; the extracted text is what the model receives.

```
docs/prompts/*.md                         manuscript (English, then Korean, per paragraph)
  -> scripts/render-prompt-pdf.mjs        docs/prompts/pdf/<name>_bilingual_v<ver>.pdf   review copy
                                          docs/prompts/pdf/<name>_prompt_v<ver>.pdf      English only
  -> scripts/extract-prompt-text.mjs      artifacts/prompts/<id>.txt + manifest.json     text from the prompt PDF, sha256
  -> scripts/generate-session-prompts.mjs src/shared/protocol/session-prompts.generated.ts  (never hand-edit)
```

## Files

| File | Layer | Reviewed by |
|---|---|---|
| `TBCT_AI_Prompt_Template.md` | how a session document is laid out | team |
| `TBCT_AI_Prompt_Common.md` | app layer: persona, language, output contract, safety cooperation, screen | team |
| `TBCT_AI_Prompt_S01.md` | clinical layer, Session 1 | team, then Prof. de Oliveira |
| `TBCT_AI_Prompt_S02.md` | clinical layer, Session 2 | team, then Prof. de Oliveira |

The clinical layer is written so that it makes sense without the app: no field names, no JSON,
no screen mechanics. Everything the app needs is in the common document, which every session shares.

## Manuscript conventions

- Front matter at the top: `id`, `title`, `version`, `date`, `status`. The manifest and the
  generated file read these.
- Korean follows its English paragraph inside a fenced block:

  ```
  Ask for one recent moment when the difficulty showed up.

  ::: ko
  그 어려움이 드러났던 최근의 한 순간을 물어본다.
  :::
  ```

  The bilingual PDF shows both; the prompt PDF drops every `::: ko` block.
- No tables in the body. Table cells come out of a PDF in an unreliable order, and the
  prompt text is extracted from the PDF. Use numbered or bulleted lists.
- Quoted example wording is in double quotes. It is an example of the shape of a question,
  not a script; the common document says so.
- A `## Notes for review` section at the end lists what the document deliberately leaves out
  or changes relative to the book, for the reviewer. It is rendered in the bilingual PDF only
  (it is not part of the prompt).

## Versioning

`version` in the front matter: `0.1.0` first draft, `0.2.0` after team review, `1.0.0` when sent
to Prof. de Oliveira and frozen. The sha256 of the extracted prompt text is written to the
manifest and to the generated TypeScript. Once the runtime runs these prompts (the engine change
that follows this document work), it records the version and hash in every trace.

## Commands

```
npm run prompts:build                         # all three steps below, in order
node scripts/render-prompt-pdf.mjs            # all manuscripts, both PDFs each
node scripts/extract-prompt-text.mjs          # prompt PDFs -> artifacts/prompts/*.txt + manifest.json, verified against the manuscript
node scripts/generate-session-prompts.mjs     # manifest + txt -> src/shared/protocol/session-prompts.generated.ts
```

Rendering needs Google Chrome (headless). Extraction uses `pdfjs-dist`, already a dependency.
