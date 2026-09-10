TBCT Project — Claude Code Operating Rules

HARNESS VERSION: 2026-08-13-manual-v2

Mission

Work on the existing TBCT counseling-chatbot codebase with minimum necessary change.

Current enhancement priority: counseling Sessions 1, 2, and 3 only, unless the user explicitly expands scope.

Preserve existing behavior outside the requested task.

Authoritative TBCT session manual

For any TBCT session task, follow .claude/rules/tbct-session-manual.md and consult docs/ai/TBCT_SESSION_OWNER_MANUAL.md for the relevant session.

.claude/rules/tbct-session-manual.md is mandatory, not optional; read it before editing any s01~s08 session implementation.

Never hand-edit src/shared/protocol/tbct-source-text.generated.ts.

For S02/S03, preserve the protected identifiers defined in the manual rule.

Treat the manual as the authoritative editing policy for session files. Use CODEMAP only as a navigation aid and verify current code before acting.

If current code and the manual appear inconsistent, report the mismatch before changing behavior; do not silently reinterpret or rewrite the manual.

Context economy

Before broad exploration, read docs/ai/CODEMAP.md if it exists and is marked current.

Use the codebase map as an index, not as truth: verify only the files/symbols needed for the current task.

Prefer targeted symbol/text search over recursively reading directories.

Do not reread files already summarized in the current session unless a concrete gap requires it.

Do not import large architecture documents into this file. Load detailed context through project skills only when relevant.

Change discipline

Make the smallest change that satisfies the request.

Do not refactor, rename, reformat, reorganize, upgrade dependencies, or clean unrelated code unless explicitly required.

Do not change Sessions 4–8 while working on Sessions 1–3 unless a shared dependency must change; explain the dependency before editing it.

Preserve public APIs, data schemas, prompts, session transitions, and storage behavior unless the task explicitly requires a change.

Never use shell commands as a workaround to mutate out-of-scope source files.

Before code edits, create/update .claude/TASK_SCOPE.json with the exact files or directories allowed for the task.

If additional files become necessary, update the scope first and state why.

Verification

All development and tests must be runnable on this local desktop.

Prefer the repository's existing test/build/runtime commands.

Do not depend on a remote DB or server when a faithful local equivalent can be used.

If the project already requires a specific database engine, preserve compatibility and run that engine locally when practical; do not silently replace it with SQLite.

For a new lightweight local-only datastore with no existing compatibility constraint, prefer SQLite.

For local LLM inference, Ollama is acceptable when compatible with the project.

Never point tests at production services or production data.

Before finishing a task

Run the narrowest relevant tests first; expand only when shared behavior may be affected.

Review git diff --stat and git diff for accidental edits.

Before any git push, verify that local-only connection records, credentials, endpoints, database URLs, ports, or environment-specific settings are not committed and cannot override or leak into the deployment environment.

Report: files changed, behavior changed, tests run/results, and any remaining local prerequisites.

Compact instructions

During compaction preserve: current task scope, changed files, test results, unresolved failures, and Session 1–3 behavioral invariants.