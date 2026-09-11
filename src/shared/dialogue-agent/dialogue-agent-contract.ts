import { z } from "zod";
import { messagePartSchema } from "@/shared/dialogue-agent/message-composition";

// The node-scoped contract sent TO the dialogue agent every turn. Compact by
// design (see compileDialogueContract) -- never the whole protocol, never
// every prompt in the session, just what's needed to phrase THIS turn well.
// This is data for Claude to read, never instructions Claude can act on to
// change runtime state: everything the deterministic engine owns (session,
// node, transitions, completion, safety, persistence) stays outside this
// contract's write surface entirely -- Claude only ever returns a
// DialogueDecision (below), which the runtime treats as a communication
// suggestion, not a state change.
export const expectedInputTypeSchema = z.enum([
  "free_text",
  "integer_0_5",
  "percentage_0_100",
  "yes_no",
  "single_choice",
  "multi_choice",
  "ordered_list",
]);
export type ExpectedInputType = z.infer<typeof expectedInputTypeSchema>;

export const dialogueContractSchema = z.object({
  sessionId: z.string(),
  nodeId: z.string(),
  promptItemId: z.string(),
  roleId: z.string(),
  therapeuticObjective: z.string(),
  currentTaskText: z.string(),
  // Brief (1-2 sentence) "why this step matters" text, carried from
  // ClinicalStageNode.participantRationale when the node has one. Grounds
  // explain_rationale / handling "why are you asking this?" without Claude
  // inventing clinical justification of its own (Part 8).
  participantRationale: z.string().optional(),
  targetField: z.string().optional(),
  expectedConstruct: z.string().optional(),
  expectedInputType: expectedInputTypeSchema,
  // True for a repeat_until prompt (RuntimePromptItem.executionMode) -- one
  // that is by design asked again, near-identically, for each item/round
  // (S02's ordered_list collection, but also e.g. S05's per-contributor
  // re-rating loop, which isn't ordered_list). The dialogue-output-validator
  // repeated-identical-message check must not reject these -- confirmed live
  // via the 8-session simulated audit (S05 regressed to "partial" when that
  // check was scoped to expectedInputType==="ordered_list" alone, missing
  // this broader repeat_until case).
  isRepeatablePrompt: z.boolean().default(false),
  choiceOptions: z.array(z.string()).optional(),
  participantOwned: z.boolean(),
  assistantMustNotSupply: z.boolean(),
  // True when THIS turn's own targetField is not itself participant-owned
  // (e.g. a delivery-tracking flag like courtroomOrientationAcknowledged)
  // but the node it belongs to also requires a genuinely protected field
  // (e.g. that same node's charge) -- see dialogue-contract-compiler.ts's
  // isFieldProtected. Patient Authorship Invariant gap fix
  // (.claude/TASK_SCOPE.json note2026_09_07): an instruction/orientation
  // turn's free-form delivery can still restate or invent content for a
  // DIFFERENT field the node is responsible for, even when this turn's own
  // field carries no content risk by itself. Deliberately kept separate
  // from assistantMustNotSupply (which describes ONLY targetField, and
  // whose wording in systemPrompt() names "this field" specifically) rather
  // than widening that field's meaning.
  nodeRequiresProtectedField: z.boolean().default(false),
  // True only when this session has a worksheet-edit affordance (any
  // session with a reviewed binding registry entry -- see
  // worksheet-binding-registry.ts) -- lets Claude answer "can I change an
  // earlier answer?"
  // honestly: point to the real edit path where one exists, or say plainly
  // that it isn't automated yet rather than promising a branch/fork the
  // runtime doesn't implement (branching/revision is explicitly deferred,
  // see dialogue-agent-orchestrator.ts).
  worksheetEditAvailable: z.boolean(),
  confirmedState: z.record(z.unknown()),
  allowedActions: z.array(z.string()),
  forbiddenActions: z.array(z.string()),
  relevantTerminology: z.array(z.object({ term: z.string(), meaning: z.string() })).optional(),
  scaleExplanation: z.string().optional(),
  // Source-mandated conduct rules for THIS specific step (S07/S08's CRITICAL
  // POINTs and Key Principles: therapist silence in the empty chair, never
  // coaching the prosecutor, the Juror-2 "prosecutor's voice" intervention,
  // gentle third-person corrections, ...). Curated per-prompt by
  // dialogue-contract-compiler.ts's stepSpecificGuidanceFor -- previously
  // these reached the model only by accident, when the raw source excerpt
  // that happened to contain them landed inside therapeuticObjective.
  stepSpecificGuidance: z.array(z.string()).optional(),
  lastParticipantMessage: z.string().optional(),
  recentContext: z.array(z.object({ role: z.enum(["patient", "assistant"]), content: z.string() })),
  safetyStatus: z.string(),
  locale: z.string(),
  clarificationAttemptCount: z.number().int().min(0),
  // True only for the very first prompt of the very first node of the
  // session (no node completed yet) -- lets Claude add one short "here's
  // what today's session is about" welcome sentence, grounded in
  // therapeuticObjective, before the actual first task. False for every
  // later turn, including later first-prompts-of-a-node (see
  // isFirstPromptOfNode below). Never true for a safety-critical opening
  // prompt (e.g. S03's safety-check) -- those are excluded from the
  // dialogue agent entirely and never reach this contract.
  isFirstPromptOfSession: z.boolean(),
  // True for the first prompt of ANY node (including the session's first --
  // isFirstPromptOfSession implies this too), i.e. the participant is
  // moving into a new step/part of the session. Lets Claude add one short
  // "we're moving into the next part" sentence before the actual task,
  // grounded in therapeuticObjective, instead of asking the task cold.
  isFirstPromptOfNode: z.boolean(),
  // True when sourcePromptItem.type === "role_transition" (e.g. S07's
  // empty-chair/Consensus-chair moves, S08's courtroom role entries) --
  // combined with isFirstPromptOfNode, tells Claude to explicitly name the
  // role/perspective switch instead of a generic "next part" framing.
  isRoleTransitionPrompt: z.boolean(),
  // Clinician-authored guidance for THIS specific prompt (PromptItem.modelGuidance,
  // via RuntimePromptItem.modelGuidance -- the same field the Protocol Editor's
  // "Clinician guide" field, and the manual-reflection page's matching field,
  // already let a clinician edit). Additional phrasing instruction for how to
  // handle this one turn, layered on top of -- never replacing -- the fixed
  // safety/behavior rules in anthropic-dialogue-agent.ts's systemPrompt.
  clinicianGuidance: z.string().optional(),
  // Clinician-authored, session-wide tone/role framing (SessionCommonRules.
  // roleAndStance, e.g. "speak warmly, use short sentences, avoid clinical
  // jargon"). Same additive-only guarantee as clinicianGuidance above.
  sessionToneGuidance: z.string().optional(),
  // Reflect-and-Confirm (.claude/TASK_SCOPE.json note2026_09_11): true only
  // when this turn may carry the assistant's own summary/conclusion of what
  // the participant said -- see dialogue-contract-compiler.ts for the exact
  // conditions. Absent/false means a summarize_and_confirm decision is
  // rejected outright.
  summaryCheckAllowed: z.boolean().optional(),
  // Set only on the turn right after the participant did NOT simply confirm
  // the previous summary -- carries that summary so Claude revises it against
  // their correction instead of repeating it.
  reflectionCheckContext: z.object({ previousSummary: z.string(), attempt: z.number().int().min(1) }).optional(),
});
export type DialogueContract = z.infer<typeof dialogueContractSchema>;

export const dialogueResponseTypeSchema = z.enum([
  "acknowledge",
  "reflect_and_ask",
  "clarify",
  "repair",
  "request_missing_field",
  "explain_term",
  "explain_scale",
  // Answers "why are you asking this?" / abstract-task confusion using
  // contract.participantRationale, then returns to the same unresolved task
  // -- distinct from explain_term (a construct definition) and clarify (a
  // repair of a misunderstood answer).
  "explain_rationale",
  // Reminds the participant of something they already confirmed earlier in
  // THIS node/session (e.g. "you said the thought was X") without re-asking
  // it -- the "restore_context" allowed-action already existed in
  // dialogue-contract-compiler.ts; this gives it a matching decision value.
  "restore_context",
  "show_required_visual",
  "acknowledge_pause",
  // Reflect-and-Confirm (note2026_09_11): the assistant's own short summary
  // or conclusion of what the participant said. The server always closes it
  // with a fixed "did I get that right?" and never combines it with the next
  // task -- see message-composition.ts's assembleSummaryCheck.
  "summarize_and_confirm",
]);

export const participantResponseStateSchema = z.enum([
  "valid_answer",
  "partial_answer",
  "wrong_construct",
  "question_not_understood",
  "missing_visual",
  "missing_context",
  "participant_question",
  "duplicate_answer",
  // Participant wants to correct an earlier answer ("I answered that
  // wrong", "can I go back?"). The branching/fork system Part 16 describes
  // is explicitly deferred -- this state exists so Claude can recognize and
  // respond to the request honestly (point to the real worksheet-edit path
  // when contract.worksheetEditAvailable, otherwise say plainly it isn't
  // automated yet) rather than silently mis-clarifying it as off_topic.
  "revision_request",
  "declines",
  "pause_request",
  "off_topic",
]);

export const visualActionSchema = z.enum(["none", "focus_field", "show_options", "restore_worksheet", "show_scale"]);

// Claude's own read of how much explanation this turn needed -- logged for
// QA (Part 26), and named explicitly in the system prompt so "never default
// to expanded" is something the model can self-report against, not just an
// unverifiable instruction. Does not gate anything deterministically; it is
// descriptive, not authoritative.
export const explanationDepthSchema = z.enum(["minimal", "standard", "expanded"]);

// candidateFieldMention is explicitly NOT authoritative clinical extraction --
// extractRuntimeState (runtime-context.ts) remains the only writer of
// RuntimeContext.fields. This is here so Claude's own read of "what did the
// participant seem to say" can be logged and compared against the real
// extraction for QA, never substituted for it.
export const dialogueDecisionSchema = z.object({
  responseType: dialogueResponseTypeSchema,
  patientFacingMessage: z.string().min(1).max(700),
  keepCurrentNode: z.literal(true),
  targetField: z.string().optional(),
  participantResponseState: participantResponseStateSchema,
  visualAction: visualActionSchema.optional(),
  clarificationReason: z.string().optional(),
  explanationDepth: explanationDepthSchema.optional(),
  candidateFieldMention: z.object({ field: z.string(), value: z.unknown() }).optional(),
  // Patient Authorship Invariant (.claude/TASK_SCOPE.json note2026_09_05):
  // for a turn dialogue-output-validator.ts's requiresAssembledMessage
  // flags, patientFacingMessage above is NOT trusted at all -- Claude must
  // submit this instead, and the server assembles + independently verifies
  // the final text from it (see message-composition.ts). Optional here
  // because it is irrelevant, and never checked, for every other turn.
  messageParts: z.array(messagePartSchema).optional(),
});
export type DialogueDecision = z.infer<typeof dialogueDecisionSchema>;

export type DialogueAgentResult =
  | { decision: DialogueDecision; provider: string; model?: string; latencyMs: number; failed: false }
  // `notConfigured` separates "no provider is set up in this environment" from
  // "the provider was called and let us down". Both ship the deterministic
  // text, but only the second is a quality signal -- see
  // DialogueAgentTurnResult.usedFallback, which already draws the same line
  // for safety-critical prompts. Without it, an unconfigured environment
  // reports a 100% fallback rate and buries the real ones.
  | { decision: DialogueDecision; provider: "none"; failed: true; failureReason: string; notConfigured?: boolean };
