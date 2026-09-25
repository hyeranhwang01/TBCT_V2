TBCT Session Manual — Mandatory Editing Rules

HARNESS VERSION: 2026-08-13-manual-v2
Source: TBCT STUDIO | 세션 담당자 매뉴얼 (S01~S08)
Updated 2026-09-25: S01 and S02 are prompt-driven (.claude/TASK_SCOPE.json note2026_09_25_prompt_driven_s01_s02). Section 1b replaces sections 1, 2 and 7 for those two sessions; sections 3 and 4 were updated. Everything else, and every rule for S03~S08, is unchanged.
This rule is mandatory for every TBCT session implementation task.

0. Core principle

In principle, do not modify shared files.

Most changes must be solved inside the files carrying the target session number (s0N).

A shared-file edit is an exception. It requires proving that the requested behavior cannot be implemented with the existing session-local mechanisms, explaining blast radius, expanding .claude/TASK_SCOPE.json, and running regression tests.

For current enhancement work, S01~S03 are the default allowed functional scope. Do not modify S04~S08 unless the user explicitly expands scope or a verified shared dependency makes inspection unavoidable.

1. Session-local edit map

For target session S0N, use these locations first:

Conversation content / flow: src/patient/sessions/s0N/spec.ts

Fully fixed AI utterances: src/patient/sessions/s0N/messages.ts

Worksheet UI: src/patient/sessions/s0N/worksheet.tsx

Worksheet binding: src/patient/sessions/s0N/worksheet-binding.ts

Homework UI: session-specific src/patient/sessions/s0N/homework.tsx

Do not touch a shared file merely because it is easier.

This map is for S03~S08. S01 and S02 use section 1b.

1b. Prompt-driven sessions — S01 and S02

S01 and S02 have no step graph, turn rules, task intents or fixed messages. One system prompt runs each session end to end; code only handles safety, storage and arithmetic. Edit them here:

What the AI says and the order of the session: docs/prompts/TBCT_AI_Prompt_S01.md, docs/prompts/TBCT_AI_Prompt_S02.md (clinical layer, one per session)

Rules every prompt-driven session shares (persona, terms, how values are recorded, the per-turn output, safety cooperation): docs/prompts/TBCT_AI_Prompt_Common.md

Manuscripts are bilingual: change the English and the Korean (::: ko block) together. The English is what the model reads.

After any manuscript change: bump version in its front matter, then run npm run prompts:build. It renders the PDFs, extracts the prompt text from the English PDF, fails if that text differs from the manuscript, and regenerates src/shared/protocol/session-prompts.generated.ts. Run npx vitest run src/shared/protocol/session-prompts.test.ts afterwards.

Values the model may record: src/patient/sessions/s0N/prompt-fields.ts. A name must match the worksheet binding (s0N/worksheet-binding.ts) or the code that reads it. A name not listed there is rejected at runtime.

Arithmetic (never the model's): S02's CD-Quest scores, total and count of 4+ — src/patient/sessions/s02/cdquest-score.ts and the derive function in s02/prompt-fields.ts.

Worksheet and homework UI: unchanged, as in section 1.

Runtime (shared, affects both sessions): src/shared/api/prompt-session-api.ts, src/shared/dialogue-agent/prompt-session-agent.ts, src/shared/runtime/prompt-driven-sessions.ts.

src/patient/sessions/s0N/spec.ts is a three-node shell (opening → conversation (orientation) → closing) that safety records and clinician resume need. Do not put conversation content back into it, and do not re-create messages.ts, turn-rules.ts, task-intents.ts or dialogue-guidance.ts for S01/S02.

Safety stays in code for S01/S02 as for every session. Never write a crisis response, risk assessment or crisis resource into a prompt manuscript: the fixed safety message and the safety clarification come from code, and the prompt only tells the model to stop and set safetyConcern.

A change to the flow or wording that departs from the book (Oliveira 2015, ch.1-2) or from the recorded sessions is recorded in that manuscript's "Notes for review" section.

2. AI utterance precedence — check in this exact order

When the user asks to change what the AI says, determine which layer actually controls the utterance before editing. (S03~S08. For S01/S02 the manuscript in docs/prompts is the only layer — section 1b.)

Fixed text / strongest precedence
src/patient/sessions/s0N/messages.ts -> resolveStaticText()
If a matching fixed message exists here, it overrides the lower-priority wording sources and is emitted as defined.

LLM wording material
src/patient/sessions/s0N/spec.ts -> PromptSpec.patientText
If no fixed message overrides it, this is the wording material the model uses to naturally phrase the question. When the Claude/model call is unavailable, this text may be used directly.

Supporting rationale
src/patient/sessions/s0N/spec.ts -> NodeSpec.participantRationale
This supports explanations of why a step is being performed and is not necessarily used every turn.

Do not edit roleRange, languageRange, safetyRange, or similar metadata expecting them to change the actual patient-facing utterance unless current runtime code proves that behavior.

3. Absolute prohibition — generated source file

Never hand-edit:

src/shared/protocol/tbct-source-text.generated.ts

It is generated from the source manual and tied to source-line/hash verification. Manual edits can invalidate references and verification across all eight sessions.

src/shared/protocol/session-prompts.generated.ts and artifacts/prompts/*

They are generated from docs/prompts by npm run prompts:build and hash-checked. Edit the manuscript and rebuild instead.

If a task appears to require changing this file, stop and report why before proceeding. Find the generator/source path instead.

4. Protected identifiers — do not rename

Some output field names/slugs are consumed by shared screens or runtime logic as string identifiers. A rename can silently break behavior without a compile error.

S01 — prompt-driven

Never rename:

s01Problems

s01RepresentativeProblem

s01Goal

session-continuity.ts carries these into S02 (previousS01*). Every other name in s01/prompt-fields.ts is read by the S01 worksheet binding; keep them in step.

S02 — Cognitive distortions / CD-Quest, prompt-driven

Never rename:

distortionExamples

cdQuestScores

cdQuestFrequency

cdQuestIntensity

cdQuestTotal

distortionExamples and cdQuestScores are read by the clinician progress panel and the CD-Quest homework baseline; all five by the S02 worksheet. The rows stay in the order of src/shared/protocol/cognitive-distortions.ts.

The former S02 names problems, problemRatings, goals and goalRatings are no longer produced, but older clinician/homework code still reads them as strings: do not reuse those names for anything else.

S03 — Intra-TR

Never rename:

automaticThought

evidenceFor

evidenceAgainst

Shared logic gives these fields special treatment.

S04

automaticThought-family fields overlap with S03/shared logic.

Do not rename them without verifying all shared references. Prefer adding a field.

S05

Never rename:

contributors

participationRatingsRound1

runtime-context.ts uses these names for round progression.

S06

Never rename:

symptomItems

symptomItemScores

Clinician progress UI and homework consume these names.

S07

Never delete or rename the prompt slug crp-consent.

Its patientText may be edited when requested.

Language auto-detection references the exact slug.

S08

Preserve coreBelief by default.

It is reused when static messages generate the “charge statement” wording.

Safe extension rule: if uncertain, add a new field instead of renaming an existing protected field.

5. Session-local operations allowed by the manual

These operations can normally be done within the target session files, only when requested:

Fix wording completely: resolveStaticText()

Change LLM wording material: PromptSpec.patientText

Add/change “why this step” explanation: participantRationale

Reorder questions/nodes: nodes, nextSlug, terminal

Conditional question activation: activationCondition

Branching: extraEdges

Repeat a question per list item: executionMode: "repeat_until" + maxIterations

Reuse existing completion effects: complete_session, pause_session, copy_field, set_field

Reuse existing input/validation kinds: validation.kind

Modify the target session's worksheet UI/bindings

Modify the target session's homework UI

Attach an existing safety rule via safetyRuleIds

“Allowed” does not mean “change freely without review.” Follow the user request and smallest-change principle.

6. Shared-file escalation table

The following requests are not ordinary session-local edits.

Requested capability

Why session-only change is insufficient

Shared file(s) that may be required

Completely new question type

TypeScript/type catalog does not know it

source-fidelity-types.ts

Completely new patient input UI

Unknown type falls back to ordinary text input

patient-input-controls.tsx

Completely new completion action

Runtime does not implement the action and may silently ignore it

runtime-execution-api.ts

New safety rule with new risk-detection wording

Risk detection is shared across sessions

src/shared/mocks/data.ts, runtime-context.ts

Node-level entry condition/repeat-limit capability not already supported

Capability itself is not present in session schema/catalog

source-fidelity-catalog.ts

Before any such edit:

Verify existing session-local mechanisms cannot satisfy the request.

State the exact shared file(s) required and why.

Identify possible impact on other sessions.

Update .claude/TASK_SCOPE.json before editing.

Make the smallest compatible shared change.

Run narrow tests plus regression tests for impacted shared behavior.

7. S01~S03 authoritative file map

S01 — TBCT model introduction (prompt-driven)

Flow and wording: docs/prompts/TBCT_AI_Prompt_S01.md (+ TBCT_AI_Prompt_Common.md), then npm run prompts:build

Recordable values: src/patient/sessions/s01/prompt-fields.ts

Worksheet: src/patient/sessions/s01/worksheet.tsx

Binding: src/patient/sessions/s01/worksheet-binding.ts

Homework: src/patient/sessions/s01/homework.tsx

Shell only: src/patient/sessions/s01/spec.ts

Protected: s01Problems, s01RepresentativeProblem, s01Goal

S02 — Cognitive distortions / CD-Quest (prompt-driven)

Flow and wording: docs/prompts/TBCT_AI_Prompt_S02.md (+ TBCT_AI_Prompt_Common.md), then npm run prompts:build

Recordable values and arithmetic: src/patient/sessions/s02/prompt-fields.ts, src/patient/sessions/s02/cdquest-score.ts

Worksheet: src/patient/sessions/s02/worksheet.tsx

Binding: src/patient/sessions/s02/worksheet-binding.ts

Homework: src/patient/sessions/s02/homework.tsx, src/patient/sessions/s02/cdquest-form.tsx

Shell only: src/patient/sessions/s02/spec.ts

Protected: distortionExamples, cdQuestScores, cdQuestFrequency, cdQuestIntensity, cdQuestTotal

S03 — Intra-personal Thought Record (Intra-TR)

Flow/content: src/patient/sessions/s03/spec.ts

Fixed AI text: src/patient/sessions/s03/messages.ts

Worksheet: src/patient/sessions/s03/worksheet.tsx

Binding: src/patient/sessions/s03/worksheet-binding.ts

Homework: src/patient/sessions/s03/homework.tsx

Protected: automaticThought, evidenceFor, evidenceAgainst

8. Manual vs. repository mismatch protocol

The manual defines editing intent, but the repository is the runtime implementation. If they disagree:

Do not silently rewrite the manual.

Do not immediately refactor the code to match the manual.

Verify the exact code path and runtime behavior.

Report it as MANUAL/CODE MISMATCH with:

manual expectation;

current code behavior;

affected file/symbol;

likely impact;

proposed minimal resolution.

Wait for user direction if the resolution changes behavior or shared architecture.

9. Required pre-edit checklist

Before modifying a TBCT session:

Read CLAUDE.md.

Read this rule.

Read the relevant S0N section in docs/ai/TBCT_SESSION_OWNER_MANUAL.md.

Read docs/ai/CODEMAP.md if present/current.

Verify the current target files/symbols in code.

Check git status and preserve pre-existing user changes.

Create/update .claude/TASK_SCOPE.json with exact allowed paths.

Confirm whether the requested AI wording is controlled by static text, patientText, or rationale (S03~S08), or by the prompt manuscript (S01/S02).

Confirm no protected field/slug rename is required.

Confirm tbct-source-text.generated.ts will not be hand-edited.

10. Required post-edit checklist

Before declaring a TBCT task complete:

Run the narrowest relevant tests first.

If shared code changed, run regression tests for affected sessions/features.

Review git diff --stat and git diff.

Confirm no unrelated session file was modified.

Confirm protected identifiers remain intact.

Confirm no generated-source file was hand-edited (tbct-source-text.generated.ts, session-prompts.generated.ts, artifacts/prompts/*).

For S01/S02 manuscript changes: npm run prompts:build passed and session-prompts.test.ts passes.

Before any git push, verify local-only DB/LLM endpoints, localhost URLs, credentials, ports, paths, .env values, and development-only settings are not committed and cannot override deployment configuration.

Report changed files, behavioral changes, tests/results, manual/code mismatches, and remaining local prerequisites.