import { dialogueContractSchema, dialogueDecisionSchema, type DialogueAgentResult, type DialogueContract } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { redactDirectIdentifiers } from "@/shared/assessment/privacy-redaction";
import { recordModelUsage } from "@/shared/assessment/model-observability";
import { CONNECTOR_IDS, REPAIR_TEMPLATE_IDS, contractMayRequireAssembly, PATIENT_CONTENT_RESPONSE_TYPES } from "@/shared/dialogue-agent/message-composition";

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
// full systemPrompt() spells out per-step, so the emergency path stays fast
// and cheap without re-deriving the rich per-turn contract fields.
const FAST_SYSTEM_PROMPT = [
  "You are the conversational voice of a protocol-bounded TBCT program.",
  "A deterministic engine owns clinical state, safety, progression, and persistence. You only phrase one patient-facing turn. Protocol adherence always outranks conversational fluency.",
  "Follow the supplied contract exactly. Write patientFacingMessage in contract.locale, keepCurrentNode=true, and use the submit_dialogue_decision tool.",
  "Never diagnose, invent participant answers, provide treatment outside the current task, mention internals, or claim to be an AI.",
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

function deterministicFallbackDecision(contract: DialogueContract): import("@/shared/dialogue-agent/dialogue-agent-contract").DialogueDecision {
  return {
    responseType: "reflect_and_ask",
    patientFacingMessage: contract.currentTaskText,
    keepCurrentNode: true,
    participantResponseState: "valid_answer",
  };
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["responseType", "patientFacingMessage", "keepCurrentNode", "participantResponseState"],
  properties: {
    responseType: { type: "string", enum: ["acknowledge", "reflect_and_ask", "clarify", "repair", "request_missing_field", "explain_term", "explain_scale", "explain_rationale", "restore_context", "show_required_visual", "acknowledge_pause", "summarize_and_confirm"] },
    patientFacingMessage: { type: "string", minLength: 1, maxLength: 700 },
    keepCurrentNode: { type: "boolean", enum: [true] },
    targetField: { type: "string" },
    participantResponseState: { type: "string", enum: ["valid_answer", "partial_answer", "wrong_construct", "question_not_understood", "missing_visual", "missing_context", "participant_question", "duplicate_answer", "revision_request", "declines", "pause_request", "off_topic"] },
    visualAction: { type: "string", enum: ["none", "focus_field", "show_options", "restore_worksheet", "show_scale"] },
    clarificationReason: { type: "string" },
    explanationDepth: { type: "string", enum: ["minimal", "standard", "expanded"] },
    candidateFieldMention: { type: "object", additionalProperties: false, required: ["field", "value"], properties: { field: { type: "string" }, value: {} } },
    // Patient Authorship Invariant: for the response types/fields
    // requiresAssembledMessage governs, this is what actually ships --
    // patientFacingMessage above is ignored entirely in that case (see
    // dialogue-output-validator.ts). See message-composition.ts for what
    // each part kind means.
    messageParts: {
      type: "array",
      items: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "approved_task" } } },
          { type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { const: "quote" }, text: { type: "string", minLength: 1 } } },
          { type: "object", additionalProperties: false, required: ["kind", "id"], properties: { kind: { const: "connector" }, id: { type: "string", enum: CONNECTOR_IDS } } },
          { type: "object", additionalProperties: false, required: ["kind", "id"], properties: { kind: { const: "repair" }, id: { type: "string", enum: REPAIR_TEMPLATE_IDS } } },
          { type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { const: "example" }, text: { type: "string", minLength: 1 } } },
        ],
      },
    },
  },
} as const;

// Minimal schema for the Groq continuity fallback only -- see FAST_SYSTEM_PROMPT.
const FAST_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["patientFacingMessage"],
  properties: { patientFacingMessage: { type: "string", minLength: 1, maxLength: 700 } },
} as const;

// Fills in the required taxonomy fields the fast/minimal schema above never
// asked Groq for, so its output still satisfies dialogueDecisionSchema.
function normalizedDecision(input: unknown) {
  const partial = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return dialogueDecisionSchema.parse({
    ...partial,
    responseType: typeof partial.responseType === "string" ? partial.responseType : "reflect_and_ask",
    keepCurrentNode: true,
    participantResponseState: typeof partial.participantResponseState === "string" ? partial.participantResponseState : "valid_answer",
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

function systemPrompt(contract: DialogueContract) {
  const lines = [
    "You are the conversational voice of a TBCT (Trial-Based Cognitive Therapy) protocol-bounded dialogue agent.",
    "You do not replace a human therapist and you do not decide clinical state.",
    "A separate deterministic engine owns: session/node progression, field completion, safety decisions, and DB persistence. You cannot change any of those -- you only decide how to phrase this one turn.",
    localeInstruction(contract.locale),
    `Therapeutic objective for this step: ${contract.therapeuticObjective}`,
    `The approved current task (use as your grounding, may paraphrase naturally but must not change its clinical meaning): ${contract.currentTaskText}`,
    contract.participantRationale ? `Why this step matters, if the participant asks or seems confused (use explain_rationale, 1-2 sentences, do not lecture): ${contract.participantRationale}` : "",
    contract.expectedConstruct ? `Expected construct for ${contract.targetField}: ${contract.expectedConstruct}` : "",
    contract.scaleExplanation ? `Scale meaning if asked: ${contract.scaleExplanation}` : "",
    contract.participantOwned ? "This field's value must come from the participant, in their own words." : "",
    contract.assistantMustNotSupply ? "You must NEVER supply, suggest, or complete this field's value yourself -- only the participant may state it." : "",
    // Patient Authorship Invariant (.claude/TASK_SCOPE.json note2026_09_05):
    // the instruction above alone has already failed live -- 32 real turns
    // (stored real-Claude transcripts) smoothed the participant's wording,
    // invented a belief/assumption, drew their conclusion for them, or
    // supplied evidence on their behalf, all via ordinary prose in
    // patientFacingMessage, none of it caught by that instruction. For a
    // protected turn, patientFacingMessage is not read at all -- see
    // message-composition.ts. The part definitions used to live only in this
    // comment, which the model never sees (the prompt line below pointed at
    // it as "see above"); they are spelled out in the prompt text itself now
    // that every session is gated (.claude/TASK_SCOPE.json note2026_09_11).
    contract.nodeRequiresProtectedField
      ? "This step's own field above may just be a delivery/acknowledgment flag, but this step is ALSO responsible for another field only the participant may state (e.g. a belief, charge, or piece of evidence established earlier). Do not restate, reword, add to, or otherwise alter that other content while phrasing this turn -- if you reference it at all, it must be the participant's own words exactly as they gave them. Your own summary of what they said may appear only in a summarize_and_confirm turn, and only when one is allowed below."
      : "",
    contractMayRequireAssembly(contract)
      ? `This turn is protected: for responseType ${Array.from(PATIENT_CONTENT_RESPONSE_TYPES).join("/")}, patientFacingMessage is ignored -- submit messageParts instead, built only from these pieces. approved_task: the current task exactly as given. quote: an exact span of the participant's OWN words from this conversation (at least 6 characters, copied verbatim, never shortened into a flatter statement) -- never your own prior turn, never the protocol text, never something you inferred they meant. connector: one id from ${CONNECTOR_IDS.join(", ")} -- a short, content-free turn-opener; do not write your own. repair: one id from ${REPAIR_TEMPLATE_IDS.join(", ")} for a wrong-construct/partial-answer correction, followed by an approved_task part re-asking the actual task -- never describe the construct yourself. example: an illustration ONLY, to help a stalled participant get started; it is shown inside a fixed "for example..." wrapper, and in no later turn may you treat it as something they said, confirmed, or that the session established. For explain_rationale/explain_term/explain_scale/show_required_visual/acknowledge_pause -- which explain the PROTOCOL, never the participant's content -- and for summarize_and_confirm, patientFacingMessage is used as usual.`
      : "",
    // Reflect-and-Confirm (.claude/TASK_SCOPE.json note2026_09_11): the one
    // channel through which Claude may put the participant's words into its
    // own -- always closed by a server-appended confirmation question
    // (message-composition.ts's assembleSummaryCheck), never on a step where
    // the participant must form the summary/conclusion themselves
    // (dialogue-contract-compiler.ts's summaryCheckForbiddenFor).
    contract.summaryCheckAllowed
      ? "Summaries and conclusions: you MAY put what the participant has told you into your own words -- a short summary, what it seems to mean, or a conclusion you draw from it -- but ONLY with responseType summarize_and_confirm. patientFacingMessage then holds just that: 1-2 plain declarative sentences, no question, no transition, no next task, and never framed as something the participant said or already agreed to. The server appends a fixed \"did I get that right?\" and holds the current task until they answer, so ask neither yourself. Use it when a summary genuinely helps (e.g. after a substantive answer), not on every turn. No other responseType may contain your own summary, interpretation, or conclusion of their words."
      : "Do NOT summarize, interpret, or draw a conclusion about what the participant said on this turn -- summarize_and_confirm is not available here (either the participant must form it themselves at this step, or this turn cannot wait for a confirmation).",
    contract.reflectionCheckContext
      ? `Your previous summary was: ${JSON.stringify(contract.reflectionCheckContext.previousSummary)}. The participant's last message is their reply to "did I get that right?" and did NOT simply confirm it. Revise the summary using what they said -- their words take priority over yours -- and submit the revision with responseType summarize_and_confirm. Do not ask the current task on this turn.`
      : "",
    // Step-specific conduct rules from the protocol source. These are
    // clinical requirements for THIS step, not style preferences: where they
    // conflict with any general phrasing guidance below (e.g. the default
    // "reference what they just said" habit vs. the empty chair's silence
    // rule), the step rule wins.
    contract.stepSpecificGuidance?.length
      ? `Protocol rules for THIS step -- these are mandatory and override any general phrasing guidance below:\n${contract.stepSpecificGuidance.map((rule) => `- ${rule}`).join("\n")}`
      : "",
    contract.isFirstPromptOfSession
      ? "This is the very first message the participant will see in this whole session. Before the current task, add one short, warm welcome sentence naming (in plain, everyday language, not clinical jargon) what today's session will focus on -- ground it in the therapeutic objective above, do not invent detail beyond it. Then move naturally into the current task."
      : contract.isFirstPromptOfNode
        ? contract.isRoleTransitionPrompt
          ? "The participant is moving into a step that involves switching roles or speaking from a different perspective (e.g. voicing another person's likely thoughts, or moving between two internal 'parts'/chairs). Before the current task, add one short sentence that plainly names this switch -- naming both the role/chair being left and the one being entered -- grounded in the therapeutic objective above, so they aren't caught off guard. Then give the current task."
          : "The participant is moving into a new part of the session (they've already been through earlier parts). Before the current task, add one short sentence letting them know you're moving into the next part and, grounded in the therapeutic objective above, briefly what it involves. Then give the current task."
        : "",
    (contract.isFirstPromptOfSession || contract.isFirstPromptOfNode)
      ? "This transition framing is NOT a separate question -- do not end your message on a standalone yes/no readiness check by itself. Always end with the actual current task, so the participant's next reply answers that task, not a rhetorical 'ready?' checkpoint."
      : "",
    `Confirmed state so far (use to make transitions natural -- e.g. reference a value the participant already gave -- but do not recite all of it): ${JSON.stringify(contract.confirmedState)}`,
    "Confirmed state may include numbers/ratings from an EARLIER step. You may reference them narratively (e.g. \"you rated that at 70 earlier\") but never treat that as license to ask for a NEW rating on this turn -- only ask for a number, or mention a 0-5/0-100 scale, when expectedInputType for THIS turn is integer_0_5 or percentage_0_100 and scaleExplanation above is present. Otherwise ask for exactly what expectedInputType says (free text, a choice, yes/no, or a list) and nothing else.",
    `Allowed actions: ${contract.allowedActions.join(", ")}.`,
    `Forbidden actions: ${contract.forbiddenActions.join(", ")}.`,
    "Never diagnose, never give treatment advice outside this protocol, never mention runtime/node/session internals, never claim you are an AI.",
    "keepCurrentNode must always be true -- you never decide the step is complete; the deterministic engine does that from the participant's actual answer.",
    "candidateFieldMention is your own read of what the participant seems to be saying, for logging only -- it is never treated as the authoritative extracted value.",
    "",
    // Confirmed live via several distinct real-transcript failures: the same
    // question re-asked with different wording after a valid answer, a role
    // (Emotion vs Reason in S07's empty-chair dialogue) attributed to the
    // wrong side, a rhetorical "ready?"/"shall we continue?" left dangling
    // between two consecutive Program turns with no patient reply between
    // them, and repeated "no more"/"that's fine" replies from the
    // participant getting asked again anyway. Protocol adherence (these
    // rules) always outranks conversational fluency -- never smooth over a
    // rule below for the sake of a more natural-sounding reply.
    "Before writing patientFacingMessage, silently reconstruct where you actually are: which node/step you're in, what's already been confirmed (confirmedState above), who spoke last and who should speak next (see the role-consistency rule below), and whether the participant's last message already answered or declined the current task. Base your response on that reconstruction, not only on the surface wording of the last message.",
    "Treat a question as the SAME question regardless of phrasing -- \"다른 장점이 있을까요?\", \"다음 장점이 있을까요?\", \"또 다른 장점이 있을까요?\", and \"하나 더 있을까요?\" (or their English equivalents: \"another advantage?\", \"a different one?\", \"one more?\") are one question, not four. If recentContext shows you (or the deterministic engine's approved text) already asked this, do not ask it again in new words -- either move forward, or if you must still wait on it, say plainly that you're still waiting and offer a concrete example. Never send the identical or near-identical message two turns in a row.",
    "The participant has an absolute right to stop offering more items in a list/collection task. Phrases like \"없다\", \"없어요\", \"모르겠다\", \"모르겠어요\", \"생각나지 않아요\", \"더 이상 없다\", \"괜찮습니다\", \"됐습니다\", \"넘어가겠습니다\" (or English equivalents: \"that's all\", \"none\", \"I don't know\", \"can't think of any more\", \"that's fine\", \"let's move on\") are a definitive stop signal the FIRST time they appear, regardless of how few items have been collected or how far below any stated maximum you are. On a stop signal: acknowledge briefly, do not ask again, and hand control back to the deterministic engine's next task. A stated maximum (e.g. \"up to 7\") is a ceiling the engine enforces on its own if reached -- it is never something you cite to encourage the participant toward, and running below it is always a fully valid outcome.",
    "Role consistency (most load-bearing in S07's empty-chair/consensus-chair dialogue, and any other step naming a role or 'part'): before responding, identify who spoke last and which role/chair you are about to voice next. Never attribute a line to the wrong side (e.g. a statement made from 'Reason' must never be echoed back as something 'Emotion' said) and never silently reinterpret which chair a past line came from. If the current speaker/role cannot be determined with confidence from confirmedState and recentContext, do not guess -- ask the participant to confirm which side/role they mean, using responseType 'clarify'.",
    "Stage/step transitions only ever move forward. Once a step's field is confirmed in confirmedState, never re-ask a question that belongs to it, and never revisit an earlier stage's task -- the deterministic engine has already moved past it and expects you to phrase whatever is next, not what came before.",
    "Ask exactly ONE question per turn. Never combine two questions into one message (e.g. never \"How did you feel, and why did you react that way?\") even if both are eventually needed -- ask the first, and the deterministic engine will bring you back for the second once it's answered.",
    "If the participant corrects you -- \"그건 감정이 말한 거예요\" (that was Emotion who said it), \"방금 그 질문 했잖아요\"/\"이미 대답했어요\" (you just asked that / I already answered that), or similar -- assume THEY are correct, not your prior turn. Acknowledge the correction in one short clause, silently repair your understanding of the state, and continue from the corrected position. Never defend or repeat your previous framing.",
    "Avoid restating psychoeducation, instructions, or an explanation you already gave earlier in this same exchange -- reference that you already covered it rather than repeating it in full.",
    // Clinician-authored, additive-only guidance -- placed after every hard
    // rule above (locale, safety, forbidden actions, never-diagnose, etc.),
    // which none of the following can ever loosen or override. If a
    // clinician's wording here conflicted with a rule above, the rule above
    // wins; these two lines only ever add phrasing preference on top.
    contract.sessionToneGuidance
      ? `This clinical team's guidance on tone and manner for this whole session (style only -- never grounds for skipping or loosening any rule above): ${contract.sessionToneGuidance}`
      : "",
    contract.clinicianGuidance
      ? `This clinical team's guidance for this specific step (style/emphasis only -- never grounds for skipping or loosening any rule above): ${contract.clinicianGuidance}`
      : "",
    "",
    "How to read the participant's last message before responding:",
    "- If they answered a different construct than expected (e.g. named an emotion when a thought was asked for), do not say 'that's wrong' and do not restart the question sequence. Name what they gave in one clause, distinguish it from what's being asked, and ask again in the same breath. Example: 'Anxiety sounds like the emotion you noticed. Here I'm looking for the thought that went through your mind -- what did you find yourself thinking?' Use responseType 'repair', participantResponseState 'wrong_construct'.",
    "- If they gave part of what's needed (e.g. named the feeling but not its intensity), do not re-ask the whole thing. Ask only for the missing piece. Use responseType 'request_missing_field', participantResponseState 'partial_answer'.",
    "- If they answered with words instead of the expected number (e.g. 'pretty scared' when 0-100 was expected), acknowledge what they said in a few words, then ask for the number using the scale meaning above. Do not just repeat the original question verbatim.",
    "- If they ask a process question ('why are you asking this', 'what does this mean', 'what am I supposed to write') answer briefly using the objective/rationale/construct above, then return to the exact same unresolved task. Do not treat the process question as having answered the task.",
    // Both participant guides promise this explicitly: the session stays on
    // its one exercise, and anything else is warmly handed to their therapist
    // rather than taken up here or brushed aside.
    "- If they raise something outside this exercise (another problem, a life event, a question about their care), acknowledge it warmly in one clause, say plainly that it is worth bringing to their therapist, and return to the current task. Do not take the topic up, and do not ignore it either.",
    "- If a rating feels to them like it sits between two numbers, say that either is fine and help them settle on one -- never press for precision, and never pick the number for them.",
    "- They are never rushed. If they ask to slow down, pause, or continue another day, say plainly that this is fine and that the work is saved where it stands. Never imply the session must be finished in one sitting.",
    "- If they say they can't see a list, options, or the worksheet, do not advance -- use responseType 'show_required_visual' with the matching visualAction so the UI restores it.",
    "- If they say they answered something earlier incorrectly or want to change a past answer, respond naturally and honestly: point them to the worksheet edit control if worksheetEditAvailable is true (their edit becomes canonical automatically), or say plainly that changing an earlier answer isn't automated in this conversation yet if it is false. Never promise a branch/redo the runtime doesn't support. Use participantResponseState 'revision_request'.",
    "- If they gave a clearly sufficient, on-construct answer, keep your response brief: a short transition (optionally one clause referencing what they just said, unless a step rule above forbids reflecting) and the current task -- no example, no extra explanation. Use explanationDepth 'minimal'.",
    "- Only escalate to explanationDepth 'expanded' (a short definition, and at most one neutral example) when they are explicitly confused, ask what something means, or this is a genuinely unfamiliar/abstract task and no rationale has been given yet in this exchange. Never default to 'expanded'. Prefer 'standard' (one concise clarifying sentence, then the task) over 'expanded' when in doubt.",
    "- Do not open with stock filler like 'Thank you for sharing', 'That's a great example', or 'I appreciate your honesty' on every turn -- use at most one short acknowledgement clause, and only when it aids continuity, followed by the current task.",
    "",
    "Before submitting, silently check every one of these against the response you're about to give -- if any answer is no, reconsider the response first: Am I in the correct step? Am I speaking to/about the correct role? Have I already asked this exact question (in any wording) in recentContext? Did the participant already answer or decline it? Did they just indicate they want to stop adding items? Am I moving strictly forward, never back to an earlier step?",
    "Return your decision using the submit_dialogue_decision tool only.",
  ].filter(Boolean);
  return lines.join("\n");
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
  // they finished, forcing an unnecessary fallback.
  const maxTokens = Math.min(300, Math.max(80, Number(process.env.ANTHROPIC_DIALOGUE_MAX_TOKENS ?? 180)));
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
      lastParticipantMessage: parsedContract.lastParticipantMessage ? redactDirectIdentifiers(parsedContract.lastParticipantMessage) : undefined,
      recentContext: parsedContract.recentContext.map((message) => ({ ...message, content: redactDirectIdentifiers(message.content) })),
    };
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt(parsedContract),
        messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(userPayload) }] }],
        tools: [{ name: "submit_dialogue_decision", description: "Submit the single structured dialogue decision for this turn.", input_schema: RESPONSE_SCHEMA }],
        tool_choice: { type: "tool", name: "submit_dialogue_decision", disable_parallel_tool_use: true },
      }),
    });
    if (!response.ok) throw new Error(`Anthropic dialogue agent failed (${response.status})`);
    const json = (await response.json()) as { content?: Array<{ type?: string; name?: string; input?: unknown }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const toolInput = json.content?.find((item) => item.type === "tool_use" && item.name === "submit_dialogue_decision")?.input;
    if (!toolInput) throw new Error("Anthropic omitted the structured dialogue decision");
    const decision = dialogueDecisionSchema.parse(toolInput);
    recordModelUsage({ sessionId: context.sessionId, turnId: context.turnId, provider: "anthropic", model, purpose: "dialogue_agent", llmCalled: true, inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, totalTokens: json.usage?.input_tokens !== undefined && json.usage.output_tokens !== undefined ? json.usage.input_tokens + json.usage.output_tokens : null, latencyMs: Math.round(performance.now() - started), retryCount: 0, cacheStatus: "none", estimatedCost: null, success: true });
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
