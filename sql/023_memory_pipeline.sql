-- Longitudinal-memory pipeline tables (Neon Postgres).
--
-- WHY: a patient turn always runs on the server (/api/runtime/turn, see
-- src/shared/api/runtime-execution-api.ts submitPatientInput), but until
-- this migration every memory-pipeline record other than the approved
-- memory itself (session summaries, memory candidates, review decisions,
-- retrieval runs, usage logs, goal/homework tracking) lived only in the
-- browser IndexedDB (src/shared/data/db/tbct-local-db.ts). Dexie has no
-- IndexedDB in Node, so completeRuntimeSession's summary/candidate step
-- threw on the server, candidates never reached the clinician review
-- screen (which read a DIFFERENT browser's IndexedDB), and retrieval
-- logging failed silently every turn. Same "document row" shape as
-- sql/005_participants.sql's longitudinal_memories: indexed scalar
-- columns + `data jsonb`, so src/shared/data/server/participant-store.ts
-- needs no per-field mapping. Safe to re-run (IF NOT EXISTS throughout).
-- RLS for these tables: sql/024_memory_pipeline_rls.sql.

CREATE TABLE IF NOT EXISTS runtime_session_summaries (
  id text PRIMARY KEY,
  runtime_session_id text NOT NULL,
  participant_id text NOT NULL,
  summary_status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_session_summaries_session_idx ON runtime_session_summaries (runtime_session_id);
CREATE INDEX IF NOT EXISTS runtime_session_summaries_participant_idx ON runtime_session_summaries (participant_id);

-- A candidate is a LongitudinalMemory that has not been approved yet
-- (status candidate/pending_review/rejected). Approval copies it into
-- longitudinal_memories and deletes it here -- see
-- src/shared/api/longitudinal-memory-api.ts approveMemoryCandidate.
CREATE TABLE IF NOT EXISTS memory_candidates (
  id text PRIMARY KEY,
  participant_id text NOT NULL,
  memory_type text NOT NULL,
  status text NOT NULL,
  source_session_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_candidates_participant_idx ON memory_candidates (participant_id);
CREATE INDEX IF NOT EXISTS memory_candidates_status_idx ON memory_candidates (status);

CREATE TABLE IF NOT EXISTS memory_review_decisions (
  id text PRIMARY KEY,
  memory_id text NOT NULL,
  participant_id text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_review_decisions_memory_idx ON memory_review_decisions (memory_id);

CREATE TABLE IF NOT EXISTS memory_retrieval_runs (
  id text PRIMARY KEY,
  participant_id text NOT NULL,
  runtime_session_id text NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_retrieval_runs_session_idx ON memory_retrieval_runs (runtime_session_id);

CREATE TABLE IF NOT EXISTS memory_usage_logs (
  id text PRIMARY KEY,
  memory_id text NOT NULL,
  participant_id text NOT NULL,
  runtime_session_id text NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_usage_logs_session_idx ON memory_usage_logs (runtime_session_id);
CREATE INDEX IF NOT EXISTS memory_usage_logs_participant_idx ON memory_usage_logs (participant_id);

-- Goal / homework tracking records are written by extractMemoryCandidates
-- (src/shared/api/session-summary-api.ts) on the same server path, so they
-- move together with the rest of the pipeline.
CREATE TABLE IF NOT EXISTS goal_tracking_records (
  id text PRIMARY KEY,
  participant_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS goal_tracking_records_participant_idx ON goal_tracking_records (participant_id);

CREATE TABLE IF NOT EXISTS homework_tracking_records (
  id text PRIMARY KEY,
  participant_id text NOT NULL,
  status text NOT NULL,
  assigned_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS homework_tracking_records_participant_idx ON homework_tracking_records (participant_id);
