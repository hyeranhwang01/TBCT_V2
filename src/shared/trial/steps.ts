// Session steps for fidelity (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend, M2). A session's steps come from its prompt
// document (docs/prompts/TBCT_AI_Prompt_S0N.md, "Step N" and its "Recorded"
// line); `evidence` are the recorded fields that show the step was done (any
// one of them). A step that records nothing (S02 steps 1, 3, 4, 6, 8, 10)
// counts as done once the model reports reaching it or a later step shows
// evidence.

export type SessionStep = { number: number; name: string; evidence: string[] };

export type StepTable = { sessionDefinitionId: string; steps: SessionStep[] };
