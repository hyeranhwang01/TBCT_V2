One-time Claude Code prompt: TBCT codebase onboarding + local verification setup

This is a one-time onboarding task. Do not treat the explanatory report requested below as a recurring requirement.

Goal

Understand this repository efficiently, create a compact navigation map for future work, explain the architecture to me, document TBCT Sessions 1–3 in detail, and establish a local-only test/run path without making unrelated source changes.

Mandatory operating constraints

Read the root CLAUDE.md first and follow it.

Before any source-code edit, maintain .claude/TASK_SCOPE.json. For this onboarding task, avoid source edits unless they are strictly necessary to make the existing project runnable locally.

Do not recursively read the whole repository file-by-file.

Start with high-information files only: repository tree at shallow depth, manifests/lockfiles, README/docs, env examples, compose files, application entrypoints, routing/orchestration files, and test configuration.

Use targeted search (rg, symbol navigation, references) to locate TBCT session orchestration and Sessions 1, 2, 3. Inspect Sessions 4–8 only enough to understand shared interfaces or transition patterns; do not deeply analyze them by default.

Do not modify, refactor, reformat, rename, upgrade, or clean unrelated code.

Do not guess. Mark unsupported statements UNVERIFIED and identify the exact file needed to verify them.

Phase A — Efficient repository mapping

Determine language/framework/runtime, app entrypoints, service boundaries, TBCT flow, state/persistence, LLM integration, safety logic, test structure, and local infrastructure.

Populate docs/ai/CODEMAP.md with concise paths, key symbols, responsibilities, dependencies, and commands.

Record the current git commit/hash in Last verified when available.

The map is an index, not a source dump. Keep it compact enough to reread cheaply in future sessions.

Phase B — Human-readable architecture explanation (one-time output)

After mapping, explain to me in Korean:

the overall code structure and request/runtime flow;

where the counseling/session engine starts;

how state moves between components;

where prompts/model calls, persistence, safety handling, and UI/API boundaries live;

the minimum set of files a developer should read first.
Use exact repository paths and important symbol names. Keep the global overview concise.

Phase C — Sessions 1, 2, 3 deep explanation

Under the overview, explain Sessions 1–3 in more detail and populate docs/ai/TBCT_SESSIONS_1_3.md from verified code.
For each session, identify:

implementation purpose in this repository;

entry and exit/transition conditions;

main files/classes/functions;

prompt/config sources;

input state and output state;

data carried to the next session;

LLM/model dependencies;

DB/storage interactions;

safety/fallback/error behavior;

existing tests and missing high-value tests;

files most likely to require change during enhancement;

shared files where edits could accidentally affect Sessions 4–8.
Then summarize the 1→2→3 transition and shared invariants.
Do not add TBCT clinical theory that is not represented in code or supplied project specifications.

Phase D — Local-only run/test setup

Everything must be runnable on this desktop.

First discover the repository's existing install/run/test method. Reuse it instead of inventing a parallel stack.

Identify all remote dependencies required for tests or development.

For each dependency, choose the simplest faithful local option:

Existing DB engine required by the app → run the same engine locally (native or minimal Docker Compose) when practical.

No existing DB-engine compatibility requirement and only a lightweight local datastore is needed → SQLite is preferred.

Local LLM inference → Ollama is acceptable if the current model adapter can support it without production-facing semantic changes.

Cache/queue/vector store → use the smallest local implementation compatible with existing interfaces.

Never connect tests to production DBs, production servers, or production datasets.

Do not silently replace an existing production database/model interface merely because another option is easier.

If local setup files are genuinely needed, scope and add only those files. Prefer local/ignored configuration for machine-specific settings.

Run the narrowest useful smoke test, then Sessions 1–3 tests. If tests are absent, add only high-value tests required to validate the enhancement surface, not a broad test rewrite.

Phase E — Final checks

Before reporting completion:

inspect git status and separate pre-existing user changes from your changes;

inspect git diff --stat and git diff;

revert accidental/unrelated edits made by you only;

confirm docs/ai/CODEMAP.md and docs/ai/TBCT_SESSIONS_1_3.md match the code you actually verified;

report local setup commands and test results.

Final response format

프로젝트 전체 구조 요약

핵심 실행 흐름

Session 1 상세

Session 2 상세

Session 3 상세

Session 1→2→3 연결 구조

로컬 실행/DB/LLM 구성

테스트 결과

앞으로 Claude가 우선 참고할 맵 파일

이번 작업에서 실제로 변경한 파일 목록

Do not perform Session 1–3 feature enhancement yet. This task is onboarding, mapping, explanation, and local verification setup only.