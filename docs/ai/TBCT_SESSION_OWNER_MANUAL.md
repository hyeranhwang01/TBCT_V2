> 경로 표기는 2026-09-10 트리 재편(`src/patient` · `src/clinician` · `src/shared`) 기준으로 기계 치환되었습니다. 본문 내용 자체는 작성 당시 기준입니다.

TBCT STUDIO — Session Owner Manual (Claude Reference)

Internal reference converted to Markdown for Claude Code. This file preserves the operational rules and file mappings of the supplied TBCT STUDIO | 세션 담당자 매뉴얼 (S01~S08).
Do not silently reinterpret this document from general software-engineering preferences. If repository code conflicts with it, report the mismatch and verify before changing behavior.

1. How to use this manual

Each session owner normally needs only the files associated with that session number. This is a quick reference for finding what to edit, not a document that must be reread end-to-end for every task.

2. Core principle

Most changes should be solvable within the session's own:

src/patient/sessions/s0N/spec.ts

src/patient/sessions/s0N/messages.ts

Changes to shared types, shared patient input UI, shared runtime actions, or shared safety logic can affect multiple sessions and require coordination / explicit scope expansion.

3. Quick reference

Goal

Primary edit point

Manual guidance

Force the AI to say an exact fixed phrase

static-messages/s0N.ts -> resolveStaticText()

Session-local freedom

Give the AI wording/content to express naturally

sessions/s0N.ts -> PromptSpec.patientText

Session-local freedom

Explain why a step is being done

sessions/s0N.ts -> NodeSpec.participantRationale

Session-local freedom

Change question/step order

sessions/s0N.ts nodes order, nextSlug, terminal

Session-local freedom

Ask a question only for a particular answer/condition

activationCondition

Session-local freedom

Branch to different paths based on an answer

extraEdges

Session-local freedom

Repeat a question per list item

executionMode: "repeat_until" + maxIterations

Session-local freedom

End/pause session or copy/set a field

existing completionEffect: complete_session, pause_session, copy_field, set_field

Reuse existing values freely

Choose slider/button/yes-no etc.

validation.kind

Reuse existing types freely

Change worksheet items/UI

worksheet-renderers/s0N-worksheet.tsx + worksheet-bindings/tbct-s0N.ts

Allowed; protect field names

Change homework UI

homework/s0N-*.tsx

Session-local freedom

Attach an existing safety rule

safetyRuleIds

Session-local freedom

Add a completely new question type

source-fidelity-types.ts

Shared file; coordination required

Add a completely new patient input UI type

patient-input-controls.tsx

Shared file; coordination required

Add a completely new safety/risk-detection rule

src/shared/mocks/data.ts, runtime-context.ts

Shared file; coordination required

4. Where AI wording actually changes

Fields such as source, marker, and verbatimText in session definitions are largely source/manual location information. For actual AI utterance behavior, use this precedence:

Priority 1 — exact fixed wording

src/patient/sessions/s0N/messages.ts -> resolveStaticText()

When a matching static message is defined, it wins over the other wording instructions and is emitted as defined.

Priority 2 — LLM wording material

src/patient/sessions/s0N/spec.ts -> PromptSpec.patientText

If no priority-1 static phrase applies, this is material supplied for the AI to phrase naturally. If the Claude/model call cannot be made, this text can be presented directly to the patient.

Priority 3 — supporting explanation

src/patient/sessions/s0N/spec.ts -> NodeSpec.participantRationale

Used as supporting context when the AI needs to explain why the step is being performed; not necessarily used on every turn.

Avoid wasted edits

Do not assume metadata fields such as roleRange, languageRange, or safetyRange alter the real model utterance. The manual states they are not passed into the actual AI call. If repository code has changed since the manual, verify before relying on them.

5. Absolute prohibitions / high-risk changes

Never hand-edit generated source text

Do not manually edit:
src/shared/protocol/tbct-source-text.generated.ts

The manual states this file is generated from the source manual and hash-locked. Manual edits can break source-line references and hash verification across all eight sessions.

Preserve referenced output-field names

Some output-field names are referenced by progress views, homework screens, score calculation, or shared runtime logic as raw strings. Renaming them can silently break only part of the application without a compile-time error.

Default rule: if a field is protected or ambiguous, preserve the existing name and add a new field instead of renaming it.

6. When a shared file is genuinely required

Desired behavior

Why session-local code is insufficient

Shared file(s)

Completely new question type

TypeScript type system does not know it

source-fidelity-types.ts

Completely new input UI

Unknown type falls back to ordinary text input

patient-input-controls.tsx

Completely new completion action, e.g. auto-jump to another session

Unsupported action is ignored

runtime-execution-api.ts

New risk-detection wording / safety rule

Risk detection is shared across sessions

src/shared/mocks/data.ts, runtime-context.ts

Node-level entry condition / repeat-limit capability not already implemented

Capability is not session-local

source-fidelity-catalog.ts

Shared files should not be edited by default. Demonstrate the need, explain cross-session impact, expand task scope, then edit.

7. Session-specific reference

S01 — TBCT model introduction

Content / flow: src/patient/sessions/s01/spec.ts

AI wording: src/patient/sessions/s01/messages.ts

Worksheet: src/patient/sessions/s01/worksheet.tsx

Field binding: src/patient/sessions/s01/worksheet-binding.ts

Homework: src/patient/sessions/s01/homework.tsx

Protected field names: none identified by the manual.

Primary edit rule: dialogue/flow in s01.ts, exact fixed wording in static-messages/s01.ts; worksheet/homework changes in their session-specific files.

S02 — Problems and goals

Content / flow: src/patient/sessions/s02/spec.ts

AI wording: src/patient/sessions/s02/messages.ts

Worksheet: src/patient/sessions/s02/worksheet.tsx

Field binding: src/patient/sessions/s02/worksheet-binding.ts

Homework: src/patient/sessions/s02/homework.tsx

DO NOT RENAME: problems, problemRatings, goals, goalRatings.

Reason: the clinician progress view, homework UI, and score-total logic reference these names directly.

S03 — Intra-TR

Content / flow: src/patient/sessions/s03/spec.ts

AI wording: src/patient/sessions/s03/messages.ts

Worksheet: src/patient/sessions/s03/worksheet.tsx

Field binding: src/patient/sessions/s03/worksheet-binding.ts

Homework: src/patient/sessions/s03/homework.tsx

DO NOT RENAME: automaticThought, evidenceFor, evidenceAgainst.

Reason: shared runtime logic gives these field names special handling.

S04 — Inter-TR

Content / flow: src/patient/sessions/s04/spec.ts

AI wording: src/patient/sessions/s04/messages.ts

Worksheet: src/patient/sessions/s04/worksheet.tsx

Field binding: src/patient/sessions/s04/worksheet-binding.ts

Homework: src/patient/sessions/s04/homework.tsx

Caution: automaticThought-family fields overlap with S03 and receive special shared handling. Prefer adding a field instead of renaming an ambiguous existing one.

S05 — Participation Grid

Content / flow: src/patient/sessions/s05/spec.ts

AI wording: src/patient/sessions/s05/messages.ts

Worksheet: src/patient/sessions/s05/worksheet.tsx

Field binding: src/patient/sessions/s05/worksheet-binding.ts

Homework: src/patient/sessions/s05/homework.tsx

Test: src/patient/sessions/s05/spec.test.ts

DO NOT RENAME: contributors, participationRatingsRound1.

Reason: runtime-context.ts uses the names to advance rounds.

S06 — Color-Coded Symptom Hierarchy (CCSH)

Content / flow: src/patient/sessions/s06/spec.ts

AI wording: src/patient/sessions/s06/messages.ts

Worksheet: src/patient/sessions/s06/worksheet.tsx

Field binding: src/patient/sessions/s06/worksheet-binding.ts

Homework: src/patient/sessions/s06/homework.tsx

Test: src/patient/sessions/s06/spec.test.ts

DO NOT RENAME: symptomItems, symptomItemScores.

Reason: clinician progress and homework screens use these names directly.

S07 — Consensual Role-Play (CRP)

Content / flow: src/patient/sessions/s07/spec.ts

AI wording: src/patient/sessions/s07/messages.ts

Worksheet: src/patient/sessions/s07/worksheet.tsx

Field binding: src/patient/sessions/s07/worksheet-binding.ts

Homework: src/patient/sessions/s07/homework.tsx

Test: src/patient/sessions/s07/spec.test.ts

DO NOT delete or rename the crp-consent prompt slug.

Reason: automatic language-detection logic references that exact ID.

patientText for this prompt may be modified.

S08 — Trial One

Content / flow: src/patient/sessions/s08/spec.ts

AI wording: src/patient/sessions/s08/messages.ts

Worksheet: src/patient/sessions/s08/worksheet.tsx

Field binding: src/patient/sessions/s08/worksheet-binding.ts

Homework: src/patient/sessions/s08/homework.tsx

Test: src/patient/sessions/s08/spec.test.ts

No generally protected fields identified, but coreBelief is reused to generate the “charge statement” wording in static-messages/s08.ts. Preserve its name by default; if it must change, inspect the message-generation logic together.

8. Final principle

As a rule, do not modify shared files. A session owner should normally be able to work within files associated with their own session number. Touch shared files only when the requested feature falls into a documented shared-file case, and only after cross-session impact is understood.