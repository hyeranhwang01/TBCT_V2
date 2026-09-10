TBCT Session Manual — Mandatory Editing Rules

HARNESS VERSION: 2026-08-13-manual-v2
Source: TBCT STUDIO | 세션 담당자 매뉴얼 (S01~S08)
This rule is mandatory for every TBCT session implementation task.

0. Core principle

In principle, do not modify shared files.

Most changes must be solved inside the files carrying the target session number (s0N).

A shared-file edit is an exception. It requires proving that the requested behavior cannot be implemented with the existing session-local mechanisms, explaining blast radius, expanding .claude/TASK_SCOPE.json, and running regression tests.

For current enhancement work, S01~S03 are the default allowed functional scope. Do not modify S04~S08 unless the user explicitly expands scope or a verified shared dependency makes inspection unavoidable.

1. Session-local edit map

For target session S0N, use these locations first:

Conversation content / flow: src/lib/protocol/sessions/s0N.ts

Fully fixed AI utterances: src/lib/runtime/static-messages/s0N.ts

Worksheet UI: src/components/runtime/worksheet-renderers/s0N-worksheet.tsx

Worksheet binding: src/lib/worksheet/worksheet-bindings/tbct-s0N.ts

Homework UI: session-specific src/components/pages/homework/s0N-*.tsx

Do not touch a shared file merely because it is easier.

2. AI utterance precedence — check in this exact order

When the user asks to change what the AI says, determine which layer actually controls the utterance before editing.

Fixed text / strongest precedence
src/lib/runtime/static-messages/s0N.ts -> resolveStaticText()
If a matching fixed message exists here, it overrides the lower-priority wording sources and is emitted as defined.

LLM wording material
src/lib/protocol/sessions/s0N.ts -> PromptSpec.patientText
If no fixed message overrides it, this is the wording material the model uses to naturally phrase the question. When the Claude/model call is unavailable, this text may be used directly.

Supporting rationale
src/lib/protocol/sessions/s0N.ts -> NodeSpec.participantRationale
This supports explanations of why a step is being performed and is not necessarily used every turn.

Do not edit roleRange, languageRange, safetyRange, or similar metadata expecting them to change the actual patient-facing utterance unless current runtime code proves that behavior.

3. Absolute prohibition — generated source file

Never hand-edit:

src/lib/protocol/tbct-source-text.generated.ts

It is generated from the source manual and tied to source-line/hash verification. Manual edits can invalidate references and verification across all eight sessions.

If a task appears to require changing this file, stop and report why before proceeding. Find the generator/source path instead.

4. Protected identifiers — do not rename

Some output field names/slugs are consumed by shared screens or runtime logic as string identifiers. A rename can silently break behavior without a compile error.

S01

No protected output field names are specified in the manual.

Still avoid renames unless the task requires them.

S02 — Problem and Goal

Never rename:

problems

problemRatings

goals

goalRatings

These are referenced by clinician progress UI, homework UI, and score aggregation.

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

src/mocks/data.ts, runtime-context.ts

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

S01 — TBCT model introduction

Flow/content: src/lib/protocol/sessions/s01.ts

Fixed AI text: src/lib/runtime/static-messages/s01.ts

Worksheet: src/components/runtime/worksheet-renderers/s01-worksheet.tsx

Binding: src/lib/worksheet/worksheet-bindings/tbct-s01.ts

Homework: src/components/pages/homework/s01-weekly-examples.tsx

S02 — Problems and goals

Flow/content: src/lib/protocol/sessions/s02.ts

Fixed AI text: src/lib/runtime/static-messages/s02.ts

Worksheet: src/components/runtime/worksheet-renderers/s02-worksheet.tsx

Binding: src/lib/worksheet/worksheet-bindings/tbct-s02.ts

Homework: src/components/pages/homework/s02-checkin.tsx

Protected: problems, problemRatings, goals, goalRatings

S03 — Intra-personal Thought Record (Intra-TR)

Flow/content: src/lib/protocol/sessions/s03.ts

Fixed AI text: src/lib/runtime/static-messages/s03.ts

Worksheet: src/components/runtime/worksheet-renderers/s03-worksheet.tsx

Binding: src/lib/worksheet/worksheet-bindings/tbct-s03.ts

Homework: src/components/pages/homework/s03-review-intra-tr.tsx

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

Confirm whether the requested AI wording is controlled by static text, patientText, or rationale.

Confirm no protected field/slug rename is required.

Confirm tbct-source-text.generated.ts will not be hand-edited.

10. Required post-edit checklist

Before declaring a TBCT task complete:

Run the narrowest relevant tests first.

If shared code changed, run regression tests for affected sessions/features.

Review git diff --stat and git diff.

Confirm no unrelated session file was modified.

Confirm protected identifiers remain intact.

Confirm no generated-source file was hand-edited.

Before any git push, verify local-only DB/LLM endpoints, localhost URLs, credentials, ports, paths, .env values, and development-only settings are not committed and cannot override deployment configuration.

Report changed files, behavioral changes, tests/results, manual/code mismatches, and remaining local prerequisites.