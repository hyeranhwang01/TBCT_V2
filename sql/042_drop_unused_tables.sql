-- Tables no code uses any more (2026-09-28, .claude/TASK_SCOPE.json
-- note2026_09_28_drop_unused_tables):
--   conversation_sessions, conversation_messages -- the first conversation log
--     (sql/001), replaced by runtime_sessions/runtime_messages; sql/002
--     already dropped them, repeated here so every database ends the same.
--   memory_candidates, memory_review_decisions, memory_retrieval_runs,
--   memory_usage_logs -- the old candidate -> clinician-approval memory
--     pipeline (sql/023-024), replaced by participant memory chunks
--     (sql/025-030). Their store operations were removed with this file.
-- Kept from sql/023: runtime_session_summaries, goal_tracking_records,
-- homework_tracking_records (written at every session completion).

DROP TABLE IF EXISTS conversation_messages;
DROP TABLE IF EXISTS conversation_sessions;
DROP TABLE IF EXISTS memory_candidates;
DROP TABLE IF EXISTS memory_review_decisions;
DROP TABLE IF EXISTS memory_retrieval_runs;
DROP TABLE IF EXISTS memory_usage_logs;
