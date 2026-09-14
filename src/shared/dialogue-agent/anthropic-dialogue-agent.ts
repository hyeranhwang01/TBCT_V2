import { dialogueContractSchema, dialogueDecisionSchema, type DialogueAgentResult, type DialogueContract, type DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { redactDirectIdentifiers } from "@/shared/assessment/privacy-redaction";
import { recordModelUsage } from "@/shared/assessment/model-observability";
import { MAX_EXPLORATION_TURNS_PER_SESSION, MAX_EXPLORATION_TURNS_PER_STEP, MAX_PATIENT_THEMES, PERSONA_DEFINITION, PREFERRED_REFLECTIONS_PER_SESSION, counselorPersonaPrompt } from "@/shared/dialogue-agent/counselor-persona";

// The rich per-step system prompt below (stepSpecificGuidance, the full
// responseType/participantResponseState taxonomy, etc.) is what the
// content-fidelity work depends on -- it needs a model that reliably
// follows many simultaneous, sometimes-conflicting instructions, so this
// stays the higher-capability tier rather than the latency-oriented Haiku
// default used by the old condensed prompt.
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

// Stable, condensed prompt used ONLY for the Groq continuity fallback below
// (Claude unavailable / no key) -- a compact summary of the same rules the
// full systemPromptBlocks() spells out per-step, so the emergency path stays
// fast and cheap without re-deriving the rich per-turn contract fields.
const FAST_SYSTEM_PROMPT = [
  PERSONA_DEFINITION,
  "You are the conversational voice of a protocol-bounded TBCT program. Asked who you are, say you are a counseling assistant ('상담 도우미'), with no name or title.",
  "A deterministic engine owns clinical state, safety, progression, and persistence. You only phrase one patient-facing turn. Protocol adherence always outranks conversational fluency.",
  "Follow the supplied contract exactly. Write patientFacingMessage in contract.locale, keepCurrentNode=true, and use the submit_dialogue_decision tool.",
  "Never diagnose, invent participant answers or meanings they did not express, provide treatment outside the current task, mention internals, or claim to be a human, a doctor or a licensed clinician.",
  "Be concise: normally one short acknowledgement or transition plus the current task. Do not repeat the previous assistant wording.",
  "Never add a readiness or permission question (such as 'Are you ready?' or 'Would that be okay?') after the current task. Ask the actual task directly and end there.",
  "If the answer used the wrong construct, briefly distinguish it and ask only for the required construct. If partial, request only the missing part.",
  "If the participant asks what or why, explain briefly from the supplied objective/rationale and return to the same task.",
  "Use expanded explanation only for explicit confusion; otherwise use minimal or standard depth.",
  "Treat a question as the same question regardless of phrasing -- never re-ask something already covered in recentContext, even reworded. Ask exactly one question per turn.",
  "A stop signal (\"없다\"/\"없어요\"/\"모르겠어요\"/\"괜찮습니다\"/\"됐습니다\"/\"that's all\"/\"none\"/\"I don't know\") in a list/collection task is definitive on first use, regardless of how few items were collected -- acknowledge and move on, never ask again or cite a stated maximum as something to reach.",
  "If the participant corrects you (wrong role/speaker, \"I already answered that\", \"you just asked this\"), assume they are correct -- acknowledge in one clause and continue from the corrected understanding, never defend the prior turn.",
].join("\n");

function localeInstruction(locale: string) {
  const lower = locale.toLowerCase();
  if (lower.startsWith("ko")) return "Write patientFacingMessage in Korean (Hangul). Do not respond in English.";
  if (lower.startsWith("pt")) return "Write patientFacingMessage in Portuguese.";
  if (lower.startsWith("fr")) return "Write patientFacingMessage in French.";
  if (lower.startsWith("ja")) return "Write patientFacingMessage in Japanese.";
  return "Write patientFacingMessage in English.";
}

function deterministicFallbackDecision(contract: DialogueContract): DialogueDecision {
  return {
    responseType: "reflect_and_ask",
    patientFacingMessage: contract.currentTaskText,
    keepCurrentNode: true,
    participantResponseState: "valid_answer",
    needsConfirmation: false,
  };
}

// Open dialogue v1 (.claude/TASK_SCOPE.json note2026_09_14_open_dialogue_v1):
// Claude writes patientFacingMessage on every turn. The message-parts channel
// of note2026_09_05 is gone from the tool -- its prompt told Claude to omit
// patientFacingMessage while this schema still required it, which in
// production made every turn fail validation and fall back.
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["responseType", "patientFacingMessage", "keepCurrentNode", "participantResponseState", "needsConfirmation"],
  properties: {
    responseType: { type: "string", enum: ["acknowledge", "reflect_and_ask", "clarify", "repair", "request_missing_field", "explain_term", "explain_scale", "explain_rationale", "restore_context", "show_required_visual", "acknowledge_pause", "summarize_and_confirm"] },
    patientFacingMessage: { type: "string", minLength: 1, maxLength: 700 },
    keepCurrentNode: { type: "boolean", enum: [true] },
    needsConfirmation: { type: "boolean" },
    reflectionText: { type: "string", maxLength: 700 },
    conversationMove: { type: "string", enum: ["advance", "explore"] },
    patientThemes: { type: "array", maxItems: 5, items: { type: "string", maxLength: 120 } },
    proposedCorrection: {
      type: "object",
      additionalProperties: false,
      required: ["field", "action", "currentValue"],
      properties: {
        field: { type: "string" },
        action: { type: "string", enum: ["remove_item", "replace_value"] },
        currentValue: { type: "string" },
        newValue: { type: "string" },
        reason: { type: "string" },
      },
    },
    targetField: { type: "string" },
    participantResponseState: { type: "string", enum: ["valid_answer", "partial_answer", "wrong_construct", "question_not_understood", "missing_visual", "missing_context", "participant_question", "duplicate_answer", "revision_request", "declines", "pause_request", "off_topic"] },
    visualAction: { type: "string", enum: ["none", "focus_field", "show_options", "restore_worksheet", "show_scale"] },
    clarificationReason: { type: "string" },
    explanationDepth: { type: "string", enum: ["minimal", "standard", "expanded"] },
    candidateFieldMention: { type: "object", additionalProperties: false, required: ["field", "value"], properties: { field: { type: "string" }, value: {} } },
  },
} as const;

// Minimal schema for the Groq continuity fallback only -- see FAST_SYSTEM_PROMPT.
const FAST_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["patientFacingMessage"],
  properties: { patientFacingMessage: { type: "string", minLength: 1, maxLength: 700 } },
} as const;

/** Fills the bookkeeping fields a tool call may leave out (the tool is not
 * strict, so the API does not enforce `required`). patientFacingMessage is
 * never filled in: a turn without Claude's own message still fails. */
export function coerceToolInput(input: unknown): Record<string, unknown> {
  const partial: Record<string, unknown> = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {};
  if (typeof partial.keepCurrentNode !== "boolean") partial.keepCurrentNode = true;
  if (typeof partial.participantResponseState !== "string") partial.participantResponseState = "valid_answer";
  if (typeof partial.needsConfirmation !== "boolean") partial.needsConfirmation = false;
  if (typeof partial.reflectionText === "string" && !partial.reflectionText.trim()) delete partial.reflectionText;
  return partial;
}

// Fills in the required taxonomy fields the fast/minimal schema above never
// asked Groq for, so its output still satisfies dialogueDecisionSchema.
function normalizedDecision(input: unknown) {
  const partial = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return dialogueDecisionSchema.parse({
    ...partial,
    responseType: typeof partial.responseType === "string" ? partial.responseType : "reflect_and_ask",
    keepCurrentNode: true,
    participantResponseState: typeof partial.participantResponseState === "string" ? partial.participantResponseState : "valid_answer",
    needsConfirmation: false,
  });
}

function safeUserPayload(contract: DialogueContract) {
  const compactState = Object.fromEntries(
    Object.entries(contract.confirmedState)
      .slice(-6)
      .map(([key, value]) => [key, typeof value === "string" ? redactDirectIdentifiers(value).slice(0, 180) : value]),
  );
  return {
    locale: contract.locale,
    responseLanguage: localeInstruction(contract.locale),
    therapeuticObjective: contract.therapeuticObjective,
    currentTaskText: contract.currentTaskText,
    participantRationale: contract.participantRationale,
    targetField: contract.targetField,
    expectedConstruct: contract.expectedConstruct,
    expectedInputType: contract.expectedInputType,
    choiceOptions: contract.choiceOptions,
    participantOwned: contract.participantOwned,
    assistantMustNotSupply: contract.assistantMustNotSupply,
    worksheetEditAvailable: contract.worksheetEditAvailable,
    confirmedState: compactState,
    scaleExplanation: contract.scaleExplanation,
    clarificationAttemptCount: contract.clarificationAttemptCount,
    isFirstPromptOfSession: contract.isFirstPromptOfSession,
    isFirstPromptOfNode: contract.isFirstPromptOfNode,
    isRoleTransitionPrompt: contract.isRoleTransitionPrompt,
    clinicianGuidance: contract.clinicianGuidance,
    sessionToneGuidance: contract.sessionToneGuidance,
    deliveryInstruction: contract.expectedInputType === "ordered_list"
      ? "Treat a substantive lastParticipantMessage as an accepted list item: briefly acknowledge its exact meaning, never ask them to repeat it, then ask only for the next item. Never ask whether they are ready."
      : contract.isFirstPromptOfSession
      ? "Add one short warm sentence about today's focus, then end with the current task."
      : contract.isFirstPromptOfNode
        ? "Add one short transition into this new part, then end with the current task."
        : "Respond briefly and end with the current task.",
    lastParticipantMessage: contract.lastParticipantMessage ? redactDirectIdentifiers(contract.lastParticipantMessage) : undefined,
    recentContext: contract.recentContext.slice(-2).map((message) => ({ ...message, content: redactDirectIdentifiers(message.content).slice(0, 180) })),
  };
}

// Internal continuity fallback only -- never consulted on a healthy turn.
// Used when Claude is unavailable (no key) or a live call fails.
async function generateGroqDecision(contract: DialogueContract, context: { sessionId: string; turnId: string }): Promise<DialogueAgentResult | null> {
  const apiKey = process.env.GROQ_API_KEY ?? "";
  if (!apiKey) return null;
  const model = process.env.GROQ_DIALOGUE_MODEL ?? DEFAULT_GROQ_MODEL;
  const controller = new AbortController();
  // A slow generation should remain a slow generation, not become a generic
  // clinical fallback. The patient UI shows a friendly long-wait message
  // while this larger budget is in flight.
  const timeoutMs = Math.min(30000, Math.max(20000, Number(process.env.GROQ_DIALOGUE_TIMEOUT_MS ?? 20000)));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 160,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: FAST_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(safeUserPayload(contract)) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "dialogue_turn", strict: true, schema: FAST_RESPONSE_SCHEMA } },
      }),
    });
    if (!response.ok) throw new Error(`Groq dialogue agent failed (${response.status})`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq omitted dialogue JSON");
    const decision = normalizedDecision(JSON.parse(content));
    const latencyMs = Math.round(performance.now() - started);
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "groq", model, purpose: "dialogue_agent", llmCalled: true, inputTokens: json.usage?.prompt_tokens ?? null, outputTokens: json.usage?.completion_tokens ?? null, totalTokens: json.usage?.total_tokens ?? null, latencyMs, retryCount: 0, cacheStatus: "none", estimatedCost: null, success: true });
    return { decision, provider: "groq", model, latencyMs, failed: false };
  } catch (error) {
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "groq", model, purpose: "dialogue_agent", llmCalled: true, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: false, failureReason: error instanceof Error ? error.message : "Groq dialogue failed" });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `stable` is the same for every turn of a session and is sent as a cached
 * system block: the counselor persona (counselor-persona.ts,
 * note2026_09_15_olivia_persona), the program's ownership of the steps, and
 * the session manual's tone, opening rules, procedure and restrictions.
 * `turn` carries this turn's step and state. The program still owns
 * progression, completion and safety; the wording, when to reflect, and
 * whether to explore what the participant said before the task are Claude's
 * (open dialogue v1, note2026_09_14, as changed by the persona note).
 */
export function systemPromptBlocks(contract: DialogueContract): { stable: string; turn: string } {
  const stable = [
    counselorPersonaPrompt(),
    "You work within this session's TBCT (Trial-Based Cognitive Therapy) manual, below. You never diagnose or give clinical advice outside this protocol.",
    "A separate program owns the session's steps: which step is current, when it is complete, safety handling, and what gets recorded. Follow the manual's procedure for the CURRENT step given in each turn. Never carry out a later step early and never go back to an earlier one.",
    "Within that procedure the wording is yours: how you acknowledge, empathize, lead in and phrase the question, the way a skilled counselor would -- not a script.",
    contract.sessionToneGuidance ? `This session's manual on role, tone and style:\n${contract.sessionToneGuidance}` : "",
    contract.sessionProtocolRules?.length
      ? `This session's manual -- opening rules, required procedure and restrictions. The procedure describes the whole session so you know where you are; carry out only the current step:\n${contract.sessionProtocolRules.join("\n\n")}`
      : "",
  ].filter(Boolean).join("\n\n");

  const exploration = contract.explorationTurns ?? { step: 0, session: 0 };
  const turn = [
    localeInstruction(contract.locale),
    `Current step objective: ${contract.therapeuticObjective}`,
    `The current task -- what this turn must ask or do. Keep its clinical meaning; the wording is yours: ${contract.currentTaskText}`,
    contract.participantRationale ? `Why this step matters, if the participant asks or seems confused (1-2 sentences, do not lecture): ${contract.participantRationale}` : "",
    contract.expectedConstruct ? `What ${contract.targetField} means here: ${contract.expectedConstruct}` : "",
    contract.scaleExplanation ? `Scale meaning if asked: ${contract.scaleExplanation}` : "",
    contract.stepSpecificGuidance?.length ? `Protocol rules for this step (mandatory):\n${contract.stepSpecificGuidance.map((rule) => `- ${rule}`).join("\n")}` : "",
    contract.clinicianGuidance ? `The clinical team's note for this step: ${contract.clinicianGuidance}` : "",
    `Expected answer for this turn: ${contract.expectedInputType}${contract.choiceOptions?.length ? ` (options: ${contract.choiceOptions.join(" / ")})` : ""}. Only ask for a number or mention a scale when this turn expects a rating.`,
    `Confirmed so far (refer to it naturally, never recite it): ${JSON.stringify(contract.confirmedState)}`,
    contract.isFirstPromptOfSession
      ? "This is the first message of the session: open the way the manual's opening rules describe, then move naturally into the current task."
      : contract.isFirstPromptOfNode
        ? contract.isRoleTransitionPrompt
          ? "The participant is switching roles or perspective here: say so plainly before the task."
          : "You are moving into a new part of the session: lead in naturally, without announcing steps or phases."
        : "",
    "\nReflecting and confirming -- selectively:",
    contract.summaryCheckAllowed
      ? `- Reflect or confirm only when it clarifies meaning, emotion, belief or the formulation -- not after every answer. Confirmations so far this session: ${contract.reflectionsSoFar ?? 0}; about ${PREFERRED_REFLECTIONS_PER_SESSION} per session on average is preferred (a guide, not a limit). When you do put their words into your own (a summary, paraphrase or tentative interpretation), end the turn by asking whether you understood (for example '~라는 말씀이 맞으실까요?'), use responseType summarize_and_confirm, set needsConfirmation=true, and put only that summary -- in their key words, adding nothing -- in reflectionText. Do not ask the current task in that turn; it is asked after they answer.`
      : "- This turn cannot wait for a confirmation: do not summarize or interpret what they said. Set needsConfirmation=false.",
    "- Otherwise set needsConfirmation=false.",
    contract.fidelityFeedback
      ? `- Your previous draft of this turn added meaning the participant did not express (${contract.fidelityFeedback}). Write the turn again using only what they said; anything of your own must be a clearly tentative question.`
      : "",
    contract.reflectionCheckContext
      ? `- Your previous understanding was: ${JSON.stringify(contract.reflectionCheckContext.previousSummary)}. Their last message does not simply confirm it -- it corrects or restates it. Summarize again from their words (their words take priority over yours), ask whether that is right, set needsConfirmation=true and reflectionText. Do not ask the current task.`
      : "",
    contract.summaryCheckAllowed
      ? "- Fixing the record: if something already recorded (the \"Confirmed so far\" values) looks wrong -- a typo, a non-answer or a \"nothing more\" word stored as an answer -- or the participant says an earlier answer was wrong or asks to remove it, propose the fix in proposedCorrection: field and currentValue exactly as recorded; action remove_item for a list item, or replace_value with newValue in the participant's own words. Ask them in your own words whether to make that change (for example \"'읎오'는 목록에서 뺄까요?\"), set needsConfirmation=true, and do not ask the current task in that turn. Nothing changes unless they say yes."
      : "",
    "\nFollowing the participant:",
    contract.explorationAllowed
      ? `- If their last message brought up something that matters for this step's objective and is worth understanding better, you may explore it before the current task: ask one open, Socratic question about what they said and set conversationMove="explore". The current task waits for a later turn. Exploration turns used: ${exploration.step} of ${MAX_EXPLORATION_TURNS_PER_STEP} for this task, ${exploration.session} of ${MAX_EXPLORATION_TURNS_PER_SESSION} this session. Explore only when it serves the session, and never in the same turn as a confirmation.`
      : "- Ask the current task in this turn (conversationMove=\"advance\"); exploring is not available here.",
    "- When you ask the current task (conversationMove=\"advance\"), connect it to what they have said where it fits, in their words, so the conversation follows them.",
    `- The participant's themes so far, in their own words: ${JSON.stringify(contract.patientThemes ?? [])}. Let them shape your questions. Return patientThemes: the updated list, at most ${MAX_PATIENT_THEMES}, each copied exactly from something the participant said -- never your paraphrase or interpretation.`,
    "\nConversation basics:",
    "- One question per turn. Never re-ask something already answered in recentContext, even in other words.",
    "- A stop signal in a list task (\"없어요\", \"더 없어요\", \"그만\", \"that's all\", \"I don't know\") is final the first time: acknowledge it and let the program move on.",
    "- If they correct you, assume they are right: acknowledge briefly and continue from the correction.",
    "- If they ask why, or what something means, explain briefly from the objective and rationale, then return to the task.",
    "- If they bring up something personal that bears on this session's goal, treat it as material for the session: explore it or connect the task to it. If it has nothing to do with the counseling, acknowledge it briefly and return to the task.",
    "- If they say they cannot see a list, the options or the worksheet, use responseType show_required_visual with the matching visualAction.",
    "- If they want to change an earlier answer, respond honestly and do not promise a redo the program does not support.",
    "- Never mention program internals (steps, nodes, runtime).",
    "- keepCurrentNode is always true. Classify their last message in participantResponseState and pick the responseType that fits your turn.",
    "Return your decision with the submit_dialogue_decision tool only.",
  ].filter(Boolean).join("\n");

  return { stable, turn };
}

export async function generateDialogueDecision(contract: DialogueContract, context: { sessionId: string; turnId: string }): Promise<DialogueAgentResult> {
  const parsedContract = dialogueContractSchema.parse(contract);
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  // AI_PROVIDER=mock is how the rest of the runtime says "do not call a live
  // model in this process" -- the simulated-patient audit sets it for exactly
  // that reason. Checked before the API-key branch below so a developer with
  // a key in their environment can't silently turn a deterministic audit
  // into a live, billed, non-reproducible one. No Groq attempt either: mock
  // mode means zero live model calls of any kind.
  const providerDisabled = (process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "mock";
  if (providerDisabled) {
    return { decision: deterministicFallbackDecision(parsedContract), provider: "none", failed: true, failureReason: "Dialogue provider disabled (AI_PROVIDER=mock)", notConfigured: true };
  }
  if (!apiKey) {
    const internalFallback = await generateGroqDecision(parsedContract, context);
    if (internalFallback) return internalFallback.failed ? internalFallback : { ...internalFallback, provider: "groq-fallback" };
    return { decision: deterministicFallbackDecision(parsedContract), provider: "none", failed: true, failureReason: "Missing ANTHROPIC_API_KEY", notConfigured: true };
  }
  // Keep foreground conversation latency bounded. The approved deterministic
  // task text below is always available when the model misses this budget.
  // The 20-30s floor/ceiling (rather than a tighter one) is deliberate: a
  // shorter budget was found to abort healthy-but-slow generations before
  // they finished, forcing an unnecessary fallback. max_tokens is a ceiling,
  // not a target: 180 truncated Korean free prose plus the tool-call JSON.
  const maxTokens = Math.min(1200, Math.max(300, Number(process.env.ANTHROPIC_DIALOGUE_MAX_TOKENS ?? 800)));
  const timeoutMs = Math.min(30000, Math.max(20000, Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 20000)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  // Claude is the patient-facing dialogue owner. Groq is never consulted on
  // a healthy turn; it is only an internal continuity fallback when Claude
  // is unavailable or returns an unusable structured result.
  try {
    const userPayload = {
      ...parsedContract,
      // Already in the cached system block -- not repeated on every turn.
      sessionProtocolRules: undefined,
      sessionToneGuidance: undefined,
      lastParticipantMessage: parsedContract.lastParticipantMessage ? redactDirectIdentifiers(parsedContract.lastParticipantMessage) : undefined,
      recentContext: parsedContract.recentContext.map((message) => ({ ...message, content: redactDirectIdentifiers(message.content) })),
    };
    const prompt = systemPromptBlocks(parsedContract);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [
          { type: "text", text: prompt.stable, cache_control: { type: "ephemeral" } },
          { type: "text", text: prompt.turn },
        ],
        messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(userPayload) }] }],
        tools: [{ name: "submit_dialogue_decision", description: "Submit the single structured dialogue decision for this turn.", input_schema: RESPONSE_SCHEMA }],
        tool_choice: { type: "tool", name: "submit_dialogue_decision", disable_parallel_tool_use: true },
      }),
    });
    if (!response.ok) {
      // Keep Anthropic's own reason, not just the status: "(400)" alone
      // cannot distinguish a billing problem ("credit balance is too low")
      // from an unavailable model or a malformed request, which left a live
      // deployment undiagnosable from outside (2026-09-13). The body is
      // Anthropic's error JSON; the API key is never part of it. Truncated
      // because this string is stored on every model-usage row.
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
      throw new Error(`Anthropic dialogue agent failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    const json = (await response.json()) as { content?: Array<{ type?: string; name?: string; input?: unknown }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
    // A truncated tool call carries a partial input -- say so, rather than
    // letting it surface as a confusing schema error.
    if (json.stop_reason === "max_tokens") throw new Error(`Anthropic dialogue agent truncated (stop_reason=max_tokens, output_tokens=${json.usage?.output_tokens ?? "unknown"})`);
    const toolInput = json.content?.find((item) => item.type === "tool_use" && item.name === "submit_dialogue_decision")?.input;
    if (!toolInput) throw new Error(`Anthropic omitted the structured dialogue decision (stop_reason=${json.stop_reason ?? "unknown"})`);
    const parsed = dialogueDecisionSchema.safeParse(coerceToolInput(toolInput));
    if (!parsed.success) throw new Error(`Anthropic dialogue decision failed validation (stop_reason=${json.stop_reason ?? "unknown"}): ${parsed.error.message.replace(/\s+/g, " ").slice(0, 300)}`);
    const decision = parsed.data;
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "dialogue_agent", llmCalled: true, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: json.usage?.input_tokens !== undefined && json.usage.output_tokens !== undefined ? json.usage.input_tokens + json.usage.output_tokens : null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: (json.usage?.cache_read_input_tokens ?? 0) > 0 ? "hit" : "miss", estimatedCost: null, success: true });
    return { decision, provider: "anthropic", model, latencyMs: Math.round(performance.now() - started), failed: false };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "dialogue agent failed";
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "dialogue_agent", llmCalled: true, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: false, failureReason });
    clearTimeout(timeout);
    const internalFallback = await generateGroqDecision(parsedContract, context);
    if (internalFallback) return internalFallback.failed ? internalFallback : { ...internalFallback, provider: "groq-fallback" };
    return { decision: deterministicFallbackDecision(parsedContract), provider: "none", failed: true, failureReason };
  } finally {
    clearTimeout(timeout);
  }
}
