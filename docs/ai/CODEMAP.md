# TBCT Codebase Map (index, not source of truth)

Last verified: 2026-09-10, branch `refactor/tree-structure` (tree reorganised on top of main `1259dcc`; sections 1-8 path-rewritten mechanically, section 0 written fresh)

This file is an index for fast orientation. Verify any specific file/symbol
against the code before relying on it — see CLAUDE.md's context-economy rule.

## 0. Tree (2026-09-10 reorganisation)

Top level is split by **audience**; session content sits under the patient tree, one folder per session.

```
src/
├── app/               Next.js routes (fixed by the framework) + studio-app.tsx (route table) + providers.tsx
├── patient/           환자용
│   ├── sessions/s01..s08/   spec.ts · messages.ts · worksheet-binding.ts · worksheet.tsx · homework.tsx (+ tests, S01 extras)
│   ├── pages/         patient screens (session, check-in, homework, profile, messages, ...)
│   ├── components/    patient-shell, input controls, worksheet pane, streaming text, page fragments
│   └── lib/           speech, homework, audit, api/(homework-api, patient-locale-sync)
├── clinician/         의료진용 (no per-session code exists on this side)
│   ├── pages/         protocol-studio/ · monitoring/ · safety/ · pilot/ · admin/ · account/
│   ├── components/    app-shell
│   └── lib/           pilot, session-catalog, protocol-drafts/(session-03-*), api/(admin, clinical-assets, memory-review, mock, pilot-study, protocol)
├── shared/            양쪽 공통
│   ├── runtime/       session-agnostic turn engine + store-op contracts (static-messages/field-helpers.ts only)
│   ├── protocol/      catalog, types, adapter, tbct-source-text.generated.ts
│   ├── worksheet/     registries, projection
│   ├── dialogue-agent/ patient-renderer/ clinical-language/ assessment/   (LLM side of the engine — imported by shared/runtime)
│   ├── data/          repositories/ · server/ · db/
│   ├── api/           runtime-execution, runtime-session, participant, safety-operations, ...
│   ├── components/    ui/, onboarding/, auth/, crisis-resources, clinician-message-thread
│   └── auth/ supabase/ i18n/ memory/ safety-operations/ notifications/ onboarding/ motion/ theme/ mood-checkins/ standardized-assessments/ mocks/ stores/
├── types/             cross-cutting types (unchanged)
└── test/              vitest setup + in-memory fakes (unchanged)
```

**Placement rule.** A module lives in `patient/` or `clinician/` only if it is imported exclusively from that audience; anything imported from both — or from the shared engine — lives in `shared/`.

**Dependency direction.** `patient → shared`, `clinician → shared`, `clinician → patient` (clinicians view patient screens) are allowed. `patient → clinician` and `shared → patient|clinician` are not — with one exception: `shared/` may import **`patient/sessions/*`** because session content is leaf data (the same relationship as a route table importing pages). Files outside `patient/` that import session folders directly today (aggregators + pre-existing engine coupling, left untouched):
  - `src/app/api/distortion-candidates/route.ts`
  - `src/app/api/s01-generation/route.ts` (S01 scene, 2026-09-12)
  - `src/app/preview/worksheets/page.tsx`
  - `src/shared/api/runtime-execution-api.ts` (incl. the S01 turn-rules hook, 2026-09-12)
  - `src/shared/dialogue-agent/dialogue-contract-compiler.ts` (S01 dialogue guidance, 2026-09-12)
  - `src/shared/protocol/source-fidelity-catalog.ts`
  - `src/shared/runtime/runtime-orchestrator.ts`
  - `src/shared/runtime/runtime-release-normalizer.ts`
  - `src/shared/runtime/runtime-static-message.ts`
  - `src/shared/worksheet/composed-worksheet-registry.ts`
  - `src/shared/worksheet/worksheet-binding-registry.ts`

**Why no `clinician/sessions/`.** Clinician UI is session-agnostic; nothing session-specific exists on that side. Create it with the same rule if that changes.

## 1. Stack

- Next.js 15 (App Router) + React 19 + TypeScript, Tailwind. `package.json:1`
- Single catch-all route: [src/app/[[...slug]]/page.tsx](../../src/app/[[...slug]]/page.tsx) renders `<StudioApp />` ([src/app/studio-app.tsx](../../src/app/studio-app.tsx)) — the whole app (clinician Protocol Studio + patient runtime) is one client-routed SPA behind Next.
- Persistence: **Postgres** (Neon) is the runtime-of-record for patient sessions, safety events, worksheets, homework, participants, protocol-studio audit log. Connection: [src/shared/data/db/pg-pool.ts](../../src/shared/data/db/pg-pool.ts) (`DATABASE_URL`). Schema: `sql/001..010_*.sql`, applied via `scripts/migrate-neon.mjs`.
- **Dexie/IndexedDB** ([src/shared/data/db/tbct-local-db.ts](../../src/shared/data/db/tbct-local-db.ts)) is browser-local and now scoped to the clinician-side Protocol Studio content-authoring flow (clinical asset extraction, protocol graph drafts) — NOT the patient runtime conversation store, which was migrated to Postgres (see comment in [runtime-session-repository.ts:22](../../src/shared/data/repositories/runtime-session-repository.ts)).
- Auth: Supabase ([src/shared/supabase/](../../src/shared/supabase/)). Patients and clinicians are both Supabase-authenticated callers; role/ownership checks happen server-side in API routes.
- LLM: Anthropic Claude, called server-side only. No local/offline LLM path for the dialogue agent (see §5).
- Tests: Vitest (`vitest.config.ts`), jsdom env, **fully offline** — see §6.

## 2. Where things start (request flow)

```
Browser --SPA-- src/app/[[...slug]]/page.tsx -> StudioApp
                                                    |
                                    (patient runtime views under
                                     src/patient/pages/patient-*.tsx)
                                                    |
                     src/shared/api/runtime-execution-api.ts  <-- the engine
                     (submitPatientInput / executeCurrentNode / startRuntimeSession)
                                                    |
                +-----------------------------------+-----------------------------+
                |                    |                    |                       |
     runtime-context.ts    runtime-safety-orchestrator.ts   runtime-node-executor.ts
     (extractRuntimeState)  (runSafetyOrchestrator, rules    -> runtime-orchestrator.ts
                             from src/shared/mocks/data.ts)          -> dialogue-agent-orchestrator.ts
                                                               -> anthropic-dialogue-agent.ts
                                                    |
                     src/shared/data/repositories/runtime-session-repository.ts
                     -> fetch POST /api/runtime/session-store (src/app/api/runtime/session-store/route.ts)
                     -> src/shared/data/server/runtime-session-store.ts -> Postgres
```

Patient message submit entrypoint: `submitPatientInput()` in
[src/shared/api/runtime-execution-api.ts:948](../../src/shared/api/runtime-execution-api.ts).
Called from [src/patient/pages/patient-session-page.tsx:77](../../src/patient/pages/patient-session-page.tsx).

## 3. Protocol content model (what a "session" is made of)

- Static, per-session protocol scripts (source-of-truth clinical content, hand-transcribed from the TBCT source manual with line-range citations): [src/patient/sessions/s01/spec.ts](../../src/patient/sessions/s01/spec.ts) … `s08.ts`. Each exports a `SessionSpec` (metadata + `nodes[]` + `prompts[]`).
- S01 extras (2026-09-12 redesign, see [TBCT_SESSIONS_1_3.md](TBCT_SESSIONS_1_3.md) §Session 1): `s01/turn-rules.ts` (called once from `submitPatientInput` in runtime-execution-api.ts, right after `extractRuntimeState`), `s01/generation.ts` + `src/app/api/s01-generation/route.ts` (three-person scene), `s01/dialogue-guidance.ts` (wired in dialogue-contract-compiler.ts), `s01/worksheet-diagram.tsx` / `worksheet-labels.ts` / `distortion-table.tsx` (participant-visible worksheet and homework table).
- Compiled/merged into the canonical catalog: [src/shared/protocol/source-fidelity-catalog.ts](../../src/shared/protocol/source-fidelity-catalog.ts) (`CANONICAL_SESSION_DEFINITIONS`, `CANONICAL_STAGE_NODES`, `CANONICAL_PROMPT_ITEMS`, `CANONICAL_SESSION_PLAN`). Types: [source-fidelity-types.ts](../../src/shared/protocol/source-fidelity-types.ts).
- Runtime-facing wrapper/cache over the catalog (adds localStorage-persisted clinician edits, migration-conflict tracking): [src/clinician/lib/session-catalog.ts](../../src/clinician/lib/session-catalog.ts).
- Catalog -> immutable **release** (what the runtime engine actually executes against, so live edits never change a session mid-flight): `runtime-release-compiler.ts` / `runtime-release-normalizer.ts` / `runtime-release-loader.ts` in [src/shared/runtime/](../../src/shared/runtime/).
- `src/clinician/lib/protocol-drafts/session-03-real.ts` / `session-03-importer.ts` is a **separate, older ProtocolGraphNode/Edge-based draft** (pt-BR locale, protocol id `tbct-br-001`) stored in Dexie — distinct from the canonical `s03.ts` spec that the live runtime actually serves. Confirm which one is in scope before editing "Session 3" (see [TBCT_SESSIONS_1_3.md](TBCT_SESSIONS_1_3.md) §Session 3 for detail). UNVERIFIED whether this draft is reachable from any current UI path — grep `REAL_SESSION_03` call sites to confirm.

## 4. Runtime execution engine (session-agnostic; drives all 8 sessions)

All in [src/shared/runtime/](../../src/shared/runtime/) unless noted:

| File | Responsibility |
|---|---|
| `runtime-step-resolver.ts` | Resolves the current active node/prompt from `RuntimeSessionState` + release. |
| `runtime-context.ts` (`extractRuntimeState`) | Turns raw `PatientInput` into `StateExtractionResult` (fields, risk level/signals, missing fields). Deterministic parsing (`runtime-deterministic-input.ts`) with an assessment-provider hook (`runtime-input-assessment.ts`) for semantic cases. |
| `runtime-safety-orchestrator.ts` (`runSafetyOrchestrator`) | Matches active + global safety rules; rules come from **`src/shared/mocks/data.ts` `safetyRules`** (static in-repo array, not DB-editable at runtime) — shared across all 8 sessions. |
| `runtime-orchestrator.ts` (`orchestrateRuntimeAssistantTurn`) | Decides HOW to phrase the next assistant turn: dialogue-agent (Claude) vs. approved static text vs. personalized reflection. |
| `runtime-state-reducer.ts` | Deterministic node/prompt transition logic (never influenced by the LLM). |
| `runtime-state-machine.ts` | Legal `RuntimeSessionStatus` transitions. |
| `runtime-execution-tracer.ts` | Builds the `RuntimeExecutionTrace` audit record per turn (fidelity checks). |
| `runtime-output-validator.ts` | Validates generated text (locale consistency etc.) before it ships. |
| `testing/simulated-patient-runner.ts` | Scripted patient simulator used by `simulated-patient-runner.test.ts` to walk every session end-to-end. |

Orchestration entrypoint (ties the above together + persistence + safety
escalation + memory retrieval): [src/shared/api/runtime-execution-api.ts](../../src/shared/api/runtime-execution-api.ts) (1319 lines — the single largest/most load-bearing file in the runtime path).

## 5. LLM / prompt call sites

| Purpose | Client entry | Server call | Model source |
|---|---|---|---|
| Per-turn patient-facing phrasing (Sessions 1-8, dialogue agent) | [dialogue-agent-client.ts](../../src/shared/dialogue-agent/dialogue-agent-client.ts) → `/api/dialogue-agent` ([route](../../src/app/api/dialogue-agent/route.ts)) | [anthropic-dialogue-agent.ts](../../src/shared/dialogue-agent/anthropic-dialogue-agent.ts) `generateDialogueDecision()` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-5`). No Ollama/local option — missing key returns a deterministic fallback decision, does not error. |
| Short "reflection" acknowledgement of a personalized answer | `callPatientRenderer` in [runtime-orchestrator.ts:14](../../src/shared/runtime/runtime-orchestrator.ts) → `/api/patient-reflection` | `anthropic-patient-renderer.ts` | Anthropic |
| Patient input semantic assessment (optional, off by default) | [clinical-language-server.ts](../../src/shared/clinical-language/clinical-language-server.ts) / `assessment-providers.ts` | provider-switched | `ASSESSMENT_PROVIDER` = `groq \| ollama \| gemini \| deterministic` (default **`deterministic`** — no network call). Ollama config: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`), `OLLAMA_MODEL`. |
| Speech transcription | [src/app/api/speech/transcribe/route.ts](../../src/app/api/speech/transcribe/route.ts) | — | `GROQ_API_KEY` |

Safety-critical prompts (crisis check, pause-escalation) always bypass the LLM
entirely — `isSafetyCriticalPrompt()` in
[dialogue-agent-orchestrator.ts:26](../../src/shared/dialogue-agent/dialogue-agent-orchestrator.ts).

## 6. Tests

- Runner: `npm test` == `vitest run` (config: [vitest.config.ts](../../vitest.config.ts), jsdom).
- **Fully offline by design**: [src/test/setup.ts](../../src/test/setup.ts) monkey-patches `globalThis.fetch` to intercept every store endpoint (runtime/participant/safety/protocol-studio/worksheet/homework) and `/api/dialogue-agent`, serving them from in-memory fakes in [src/test/fakes/](../../src/test/fakes/). No `DATABASE_URL` or `ANTHROPIC_API_KEY` needed to run the suite.
- 35 test files / 163 tests, last run 2026-08-13: **all passing** (see final report).
- Session-1-3-relevant tests are spread across session-agnostic runtime-engine tests (most of `src/shared/runtime/*.test.ts`, `src/shared/dialogue-agent/*.test.ts`) plus catalog tests (`source-fidelity-catalog.test.ts`, `session-catalog.test.ts`) and the full-protocol `simulated-patient-runner.test.ts`. There are no test files scoped to exactly S01/S02/S03 in isolation — UNVERIFIED whether that's an intentional coverage gap; confirm by reading `simulated-patient-runner.ts` fixtures per session.

## 7. Local run/test commands

```bash
npm install
npm test              # vitest run -- offline, no DB/API keys required (§6)
npm run type-check     # tsc --noEmit
npm run lint

# Full dev server (needs live Postgres + Supabase + ANTHROPIC_API_KEY in .env.local):
npm run dev
```

No `.env.example` / compose file exists in the repo (UNVERIFIED reason — grep
found none as of this commit). Env vars actually read by the app are listed
in [TBCT_SESSIONS_1_3.md](TBCT_SESSIONS_1_3.md) and inline in
`pg-pool.ts` / `assessment-config.ts` / `anthropic-dialogue-agent.ts`.

## 8. Safety / clinical-content invariants (read before editing Sessions 1-3)

- `src/shared/mocks/data.ts` `safetyRules` is **shared by all 8 sessions** — editing it affects Sessions 4-8 too.
- `src/shared/dialogue-agent/*` and `src/shared/runtime/*` are the **shared engine** — editing them affects Sessions 4-8 too. Session-specific content lives in `src/patient/sessions/sNN/` (spec.ts, messages.ts, worksheet-binding.ts, worksheet.tsx, homework.tsx).
- The dialogue agent never decides completion/transition/safety — only phrasing (`keepCurrentNode` is always forced `true`). Do not build features that let it.
