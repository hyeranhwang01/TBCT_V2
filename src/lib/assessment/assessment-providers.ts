import { assessmentResultSchema, sanitizeAssessmentResult, type AssessmentModel, type AssessmentProviderHealth, type AssessmentProviderMetadata, type AssessmentRequest, type AssessmentResult } from "@/lib/assessment/assessment-contract";
import { getAssessmentConfig } from "@/lib/assessment/assessment-config";
import { redactDirectIdentifiers } from "@/lib/assessment/privacy-redaction";
import { recordModelUsage } from "@/lib/assessment/model-observability";

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
const schema = { type: "object", additionalProperties: false, required: ["inputValid", "relevance", "intent", "extractedFields", "completionStatus", "safetyLevel", "safetySignals", "recommendedTransition", "internalSummary"], properties: {
  inputValid: { type: "boolean" }, relevance: { type: "string", enum: ["relevant", "partially_relevant", "irrelevant", "unclear"] },
  intent: { type: "string", enum: ["answer", "clarification_request", "refusal", "topic_shift", "distress_disclosure", "other"] }, extractedFields: { type: "object", additionalProperties: true },
  completionStatus: { type: "string", enum: ["complete", "incomplete", "needs_clarification"] }, safetyLevel: { type: "string", enum: ["none", "low", "moderate", "high", "critical"] },
  safetySignals: { type: "array", items: { type: "string" } }, recommendedTransition: { type: ["string", "null"] }, internalSummary: { type: ["string", "null"] },
  // Optional (not in `required`): only meaningful for prompts that collect an
  // open-ended list (e.g. "what are your problems/goals?"). Omit for every
  // other prompt type -- see turnActionSchema's doc comment.
  turnAction: { type: "string", enum: ["accept_answer", "clarification_request", "collection_stop", "unresolved", "current_item_correction"] },
} } as const;

function systemInstruction() { return `You are a classification and data-extraction API for a real-time patient conversation. Analyze only the supplied de-identified patient input.

JUDGE SUFFICIENCY, NOT PERFECTION
- The question is never "is this a complete, well-formed answer" -- it is "does this plausibly move the conversation to the next therapeutic step." Real patients answer briefly, colloquially, and in whatever language they speak; none of that makes an answer invalid.
- A short or informal reply that is clearly on-topic for the active question is relevant and, once every requested field it can support is extracted, complete for those fields.
- Never penalize brevity, casual phrasing, or a non-English language on their own. "I can't concentrate" and "집중이 잘 안돼" are exactly as valid as a longer, more formal sentence with the same meaning.
- When you are genuinely unsure whether an answer qualifies, prefer relevant/complete over unclear/needs_clarification -- a false rejection costs the patient a repeated question; a false acceptance costs nothing the rest of the pipeline can't still catch.

FIELD EXTRACTION
- Evaluate every allowed field independently.
- Extract a field when the patient's input plausibly supports it, even stated briefly or indirectly -- do not require an explicit, textbook-clean statement.
- Never copy one phrase into two clinically different fields.
- A situation is an observable event or circumstance (what happened, where, when, or with whom).
- A thought or belief is the meaning, prediction, judgment, or words that went through the person's mind.
- If only a thought is present, extract the thought and leave the situation absent. If only a situation is present, do the reverse.
- Do not invent, diagnose, or fabricate content the patient never said -- but do connect an answer to the field it's clearly about, even if the wording isn't a direct quote.
- Use only allowed field names. Content that plausibly relates to an allowed field should never produce an empty extractedFields object -- reserve that for input with no discernible connection to any of them.

COMPLETION CONSISTENCY
- complete: every requested concept needed by the node goal is plausibly supported, even briefly.
- incomplete: at least one useful requested field is supported but another is genuinely absent -- prefer this over needs_clarification whenever ANY part of the input is usable.
- needs_clarification: reserve this for input that is truly unrelated to the active question, a non-answer (greeting, "idk", copied prompt text), or gibberish -- not for an answer that is merely short, informal, or imperfectly phrased.
- inputValid=false only for greetings, copied questions, gibberish, or content with no plausible connection to the active task.

Examples:
Input: "I had too much work, and I thought I was failing." Allowed: distressingSituation, automaticThought
Output fields: {"distressingSituation":"having too much work","automaticThought":"I was failing"}; completionStatus=complete.
Input: "I keep thinking that I am not good enough." Same allowed fields.
Output fields: {"automaticThought":"I am not good enough"}; completionStatus=incomplete.
Input (Korean): "선생님과 발표를 했었던 상황이었어" (it was a situation where I gave a presentation with the teacher). Allowed: distressingSituation, automaticThought.
Output fields: {"distressingSituation":"gave a presentation with the teacher"}; completionStatus=incomplete -- this is a clear, sufficient situation even though it's brief and in Korean; do not mark needs_clarification just because the thought hasn't been given yet.
Input (Korean): "공부를 해야 하는데 집중이 잘 안돼" (I need to study but I can't concentrate). Allowed: distressingSituation, automaticThought.
Output fields: {"distressingSituation":"needing to study", "automaticThought":"can't concentrate"}; completionStatus=complete -- brief and colloquial, but it plausibly supports both fields.

REFUSAL
intent="refusal" means the patient wants to stop THIS COUNSELING SESSION or CONVERSATION itself -- e.g. "I don't want to continue therapy," "let's stop the session," "I don't want counseling right now."
It does NOT mean the patient is describing a habit, behavior, job, relationship, or anything else in their life that they want to stop, quit, or change -- that is ordinary clinical content and belongs in the relevant field(s), with intent="answer". "I have a habit of touching my hair when I'm anxious and I want to stop it," "I want to quit my job," "I want to stop avoiding this," and "I want this thought to stop" are all answers describing a problem/goal, never a refusal, even though the English word "stop" (or Korean 그만/멈추다) appears in them. Only classify refusal when the object of "stop/don't want to continue" is the session, therapy, or counseling process itself.

SAFETY
Detect explicit or indirect suicidal ideation, passive death wishes, self-harm, plans, preparation, means, and immediate danger. Indirect signals include wanting to disappear forever, not wake up, end everything, say goodbye, or believing others are better off without the speaker. Do not flag ordinary uses such as stop feeling anxious, a weekend plan, dying of embarrassment, discussion about another person, or quoted program text. Use moderate when indirect death-related meaning is plausible but unclear; high or critical only when current risk is supported.

OPEN LIST COLLECTION (turnAction, optional)
Only set this when nodeGoal indicates the active question is collecting an open-ended list of items (e.g. "what are your problems?", "what are your goals?") -- omit it for every other kind of question.
- "accept_answer": the input names a real, on-topic candidate item for the list. Store it verbatim; never rephrase it.
- "clarification_request": the participant is asking a question back -- about what the question means, why it's being asked, what counts as a valid item, or any other question directed at the interviewer -- rather than naming an item. A message ending in "?" is not automatically this: "am I not failing to concentrate?" describing their own difficulty is still accept_answer.
- "collection_stop": the participant says there is nothing more to add (e.g. "that's all," "nothing else comes to mind"). Never store this text as an item.
- "unresolved": the input is unrelated to the list being collected (small talk, an off-topic remark) or otherwise not classifiable as any of the above. Never store this text as an item.
A participant hedging with "I think" / "maybe" / "것 같아요" does not change the classification -- classify by the content, not the confidence with which it's stated.

RATING ONE ITEM AT A TIME (turnAction, optional)
Only set this when nodeGoal indicates the active question is rating ONE item from a list the participant already named (e.g. "how would you rate [item]?"), asked once per item -- omit it for every other kind of question, including the OPEN LIST COLLECTION case above.
- "accept_answer": a genuine rating for the current item (a number, a color word, or a hedged rating like "about a 4"). Extract the rating normally.
- "current_item_correction": the participant asserts the item currently being rated is not actually a valid item at all -- it's a duplicate of something already rated, it was never meant as an item, or (critically) it's itself a leftover question/clarification that got stored as if it were an item. Use this ONE action for all of these reasons; do not invent separate reasons. A leading number attached to this kind of message (e.g. "5. but this is the same as before") is not a rating -- classify as current_item_correction, not accept_answer.
- "clarification_request": the participant is asking what the CURRENT item or the rating scale means, not asserting the item is invalid. "What does this goal mean?" is clarification_request, not current_item_correction.
- "unresolved": anything else, including a request to go back and change an EARLIER rating ("I said 5 before, change it to 4") -- rating revision is not supported yet, so this must not mutate the list or record a rating.

Return JSON matching the schema. Do not write patient-visible text, diagnose, recommend treatment, or use unauthorized fields or transitions.`; }
function safeRequest(request: AssessmentRequest) { return { ...request, patientInput: redactDirectIdentifiers(request.patientInput) }; }

abstract class BaseAssessmentModel implements AssessmentModel {
  abstract healthCheck(): Promise<AssessmentProviderHealth>;
  abstract getProviderMetadata(): AssessmentProviderMetadata;
  protected abstract invoke(request: AssessmentRequest): Promise<{ data: unknown; usage?: Usage; latencyMs: number }>;
  async assessInput(request: AssessmentRequest): Promise<AssessmentResult> {
    const meta = this.getProviderMetadata(); let lastError = "assessment failed";
    // A patient is waiting on this request. Retrying a slow provider here used
    // to turn one provider timeout into two consecutive waits (up to roughly a
    // minute with the old deployment settings). The deterministic runtime
    // fallback is safer and much faster than retrying in the foreground.
    for (let attempt = 0; attempt < 1; attempt += 1) {
      const started = performance.now();
      try {
        const result = await this.invoke(request); const sanitized = sanitizeAssessmentResult(result.data, request); const usage = result.usage;
        recordModelUsage({ sessionId: "unbound", turnId: "unbound", provider: meta.provider, model: meta.model, purpose: attempt ? "repair" : "input_assessment", llmCalled: true, inputTokens: usage?.prompt_tokens ?? null, outputTokens: usage?.completion_tokens ?? null, totalTokens: usage?.total_tokens ?? null, latencyMs: result.latencyMs, retryCount: attempt, cacheStatus: "none", estimatedCost: null, success: true });
        return sanitized;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "assessment failed";
        recordModelUsage({ sessionId: "unbound", turnId: "unbound", provider: meta.provider, model: meta.model, purpose: attempt ? "repair" : "input_assessment", llmCalled: true, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: Math.round(performance.now() - started), retryCount: attempt, cacheStatus: "none", estimatedCost: null, success: false, failureReason: lastError });
      }
    }
    throw new Error(lastError);
  }
}

class OpenAICompatibleAssessmentModel extends BaseAssessmentModel {
  // Set once healthCheck() has confirmed a usable model on this instance --
  // getAssessmentModel() below already caches ONE instance per warm
  // serverless invocation, but invoke() used to call healthCheck() (a real
  // network round-trip to list available models) on every single call
  // regardless, roughly doubling this provider's per-turn latency for no
  // reason once the model was already confirmed good once. A later
  // genuine outage/misconfiguration still surfaces -- just at the real
  // completion request below instead of pre-emptively here -- which
  // assessRuntimePatientInput's caller already treats as a normal
  // "needs_clarification" fallback either way, so this trades an
  // early-and-clean error for a slightly-later one, not a silent failure.
  private healthConfirmed = false;
  constructor(private readonly provider: "groq" | "ollama", private readonly baseUrl: string, private readonly apiKey: string, private model: string) { super(); }
  getProviderMetadata(): AssessmentProviderMetadata { return { provider: this.provider, model: this.model || undefined, privacyBoundary: this.provider === "ollama" ? "local" : "cloud" }; }
  async healthCheck(signal?: AbortSignal) {
    try {
      const response = await fetch(`${this.baseUrl}/models`, { signal, headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined });
      if (!response.ok) return { ok: false, provider: this.provider, model: this.model || undefined, message: `Model-list request failed (${response.status})` } as AssessmentProviderHealth;
      const payload = await response.json() as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
      const ids = [...(payload.data ?? []).map((item) => item.id), ...(payload.models ?? []).map((item) => item.name)].filter((id): id is string => Boolean(id));
      if (!this.model && this.provider === "groq") this.model = ids[0] ?? "";
      if (!this.model) return { ok: false, provider: this.provider, message: `${this.provider === "ollama" ? "OLLAMA" : "GROQ"}_MODEL is required because no available model was discovered.` } as AssessmentProviderHealth;
      return ids.includes(this.model) ? { ok: true, provider: this.provider, model: this.model } : { ok: false, provider: this.provider, model: this.model, message: `Configured model is unavailable: ${this.model}` };
    } catch { return { ok: false, provider: this.provider, model: this.model || undefined, message: `${this.provider} is unavailable` }; }
  }
  protected async invoke(request: AssessmentRequest) {
    const timeoutMs = Math.min(5000, Math.max(500, Number(process.env.ASSESSMENT_TIMEOUT_MS ?? 3000)));
    const signal = AbortSignal.timeout(timeoutMs);
    if (!this.healthConfirmed) {
      const health = await this.healthCheck(signal);
      if (!health.ok) throw new Error(health.message);
      this.healthConfirmed = true;
    }
    const started = performance.now(); const cloud = this.provider === "groq"; const config = getAssessmentConfig();
    if (cloud && !config.allowCloudPatientAssessment) throw new Error("Cloud patient assessment is disabled; select Ollama or deterministic processing.");
    const payloadRequest = cloud && config.redactCloudInput ? safeRequest(request) : request;
    const responseFormat = this.provider === "groq"
      ? { type: "json_object" }
      : { type: "json_schema", json_schema: { name: "assessment", schema } };
    const response = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", signal, headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) }, body: JSON.stringify({ model: this.model, temperature: 0, messages: [{ role: "system", content: `${systemInstruction()} Required JSON schema: ${JSON.stringify(schema)}` }, { role: "user", content: JSON.stringify(payloadRequest) }], response_format: responseFormat }) });
    if (!response.ok) throw new Error(`${this.provider} assessment failed (${response.status})`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: Usage };
    const content = json.choices?.[0]?.message?.content; if (!content) throw new Error("Assessment provider returned no JSON content");
    return { data: assessmentResultSchema.parse(JSON.parse(content)), usage: json.usage, latencyMs: Math.round(performance.now() - started) };
  }
}

// Phase 2 (runtime orchestration simplification): a self-contained, best-
// effort approximation of the OPEN LIST COLLECTION guidance above, for when
// no cloud provider is configured -- this is what actually runs in the test
// suite and any deployment without GROQ/OLLAMA/GEMINI credentials. Mirrors
// this class's existing directRisk/indirectRisk pattern (its own regex,
// deliberately not importing runtime-context.ts's detectRuntimeRiskSignals,
// to avoid a runtime-context -> runtime-input-assessment -> assessment-
// providers -> runtime-context import cycle) rather than reaching into
// session-specific classifiers. A pure keyword classifier cannot achieve
// true semantic generalization (see the caller's own doc comment on
// deriveS02CollectionTurnAction) -- full generalization to arbitrary
// paraphrasing needs a real LLM provider; this is the honest fallback for
// when there isn't one, verified empirically against the required test
// corpus, not a claim of production-grade language understanding.
const OPEN_LIST_STOP_PATTERNS: RegExp[] = [
  /(?:더|딱히|이제|더\s*이상|그다지|특별히)\s*(?:생각나는|다른|추가할|말씀드릴)?\s*(?:거|것|건|게)?\s*(?:는|은)?\s*없(?:어요|습니다|네요|다)/,
  /그게\s*(?:다|전부)(?:예요|이에요|입니다)?/,
  /더는\s*없/,
  // Anchored to the start of the utterance (short filler allowed) --
  // unanchored, this matched ANY sentence ending in "없는 것 같아요"/"없는 듯",
  // including a genuine problem/goal candidate that happens to use "없다" to
  // describe something about themselves (e.g. "포기하는 용기가 없는 것
  // 같아요" -- "I don't seem to have the courage to give up", a real answer,
  // not a "nothing more to add" signal).
  /^(?:음|어|저|그냥|뭐|글쎄)?\s*,?\s*(?:더|딱히|이제)?\s*없는\s*것\s*같아요/,
  /^(?:음|어|저|그냥|뭐|글쎄)?\s*,?\s*(?:더|딱히|이제)?\s*없는\s*듯/,
  /충분한\s*것\s*같아요/,
  /이미\s*이루(?:어서|웠어서|웠기\s*때문에)?\s*없/,
  /\b(?:no more|nothing (?:more|else)|that'?s (?:it|all|everything)|i'?m done|can'?t think of)\b/,
];
const OPEN_LIST_META_PATTERNS: RegExp[] = [
  /질문/,
  /무슨\s*(?:말|뜻|의미)/,
  /어떤\s*의미/,
  /왜[\s\S]{0,8}(?:물어|묻)/,
  /말해야\s*하는/,
  /말하면\s*되/,
  /뭘\s*말/,
  /뭐(?:라고)?\s*답해야/,
  /(?:앞에서|아까|전에)\s*(?:말했|얘기했|이야기했)/,
  /이해(?:하지\s*못했|가\s*안)/,
  // English quality parity: this classifier was Korean-only until this pass
  // -- an English-speaking participant asking any of these (in particular
  // "Can I get treatment for X?", the direct English analogue of the
  // originally-reported "강박증을 치료받을 수 있나요?" bug) got no
  // clarification at all and had the question itself stored as a
  // problem/goal. Mirrors the ten Korean patterns above; verified
  // empirically against an English translation of the full Phase 2 test
  // corpus, plus a Korean-regression pass, before being wired in.
  /\bquestion\b/i,
  /\bwhat\s+do(?:es)?\s+(?:that|this|it|you)(?:\s+\w+)?\s+mean\b/i,
  /\bwhat\s+kind\s+of\s+(?:meaning|answer)\b/i,
  /\bwhy[\s\S]{0,12}ask(?:ing)?\s+(?:that|this)?\s*again\b/i,
  /\bwhat\s+(?:am\s+i|should\s+i)\s+(?:supposed\s+to\s+)?say\b/i,
  /\bi\s+(?:already\s+)?(?:said|mentioned|told\s+you)\s+(?:that|this)\b(?:\s+(?:already|before))?/i,
  /\bi\s+don'?t\s+understand\s+(?:the\s+)?(?:question|that)\b/i,
];
const CLEAR_SMALL_TALK_MARKERS = /다람쥐|날씨\s*좋|오늘\s*날씨(?:가|는)?\s*(?:어때|어떻)|배고파|고양이\s*귀엽|강아지\s*귀엽|\bsquirrel|nice\s+weather|(?:what(?:'s|\s+is)|how(?:'s|\s+is))\s+the\s+weather|weather\s+today|i'?m\s+hungry|cute\s+(?:cat|dog|puppy|kitten)\b/i;
// A bare readiness/acknowledgement reply ("네 알겠습니다.", "okay") is not a
// second list candidate -- without this, one lands as an extra "problems"/
// "goals" entry the moment the participant confirms they understood the
// prompt (before actually naming anything), which then reads back to them
// as if they'd listed "yes, understood" as one of their own problems.
// Anchored to the WHOLE (punctuation-stripped) utterance, not a substring
// match, so a real candidate that happens to start with "네, ..." followed
// by actual content still falls through to OPEN_LIST_CANDIDATE_MARKERS below.
const OPEN_LIST_ACKNOWLEDGEMENT_ONLY = /^(?:yes|yes i am|yes i'm ready|ok|okay|got it|understood|i understand|ready|네|예|응|네 알겠습니다|알겠습니다|이해했습니다|준비됐어요|준비되었습니다)$/i;
const OPEN_LIST_CANDIDATE_MARKERS = /힘들|어려|스트레스|불안|걱정|긴장|우울|무기력|자신감|괴로|답답|스스로|압박|잘\s*안\s*되|못\s*하|안\s*돼서|\S고\s*싶|\b(?:difficult|hard|struggl\w*|stress\w*|anxious|anxiety|worr\w*|tense|depress\w*|hopeless|confidence|distress\w*|frustrat\w*|pressure|overwhelm\w*|can'?t\s+\w+|couldn'?t\s+\w+|want\s+to|wish\s+to|hope\s+to|would\s+like\s+to)\b/i;
// English "Can OCD be treated?" is the direct analogue of Korean "수 있나요?"
// -- narrowly scoped to the "can/could + pronoun" and "is it possible"
// shapes so it doesn't fire on ordinary candidate content like "I can't
// concentrate" (a different token, "can't") or "I can achieve my goals"
// (no pronoun immediately follows "can" in this list).
const OPEN_LIST_POSSIBILITY_QUESTION_MARKER = /수\s*있|\bcan\s+(?:i|you|it|that|this|they|we)\b|\bis\s+it\s+possible\b|\bcould\s+(?:i|you|it|that|this)\b/i;

function classifyOpenListTurn(rawText: string): "accept_answer" | "clarification_request" | "collection_stop" | "unresolved" {
  const normalized = rawText.trim().toLowerCase();
  if (!normalized) return "unresolved";
  if (OPEN_LIST_STOP_PATTERNS.some((pattern) => pattern.test(normalized))) return "collection_stop";
  if (OPEN_LIST_META_PATTERNS.some((pattern) => pattern.test(normalized))) return "clarification_request";
  if (OPEN_LIST_ACKNOWLEDGEMENT_ONLY.test(normalized.replace(/[.!?。！？，,]/g, "").trim())) return "unresolved";
  if (CLEAR_SMALL_TALK_MARKERS.test(normalized)) return "unresolved";
  if (OPEN_LIST_CANDIDATE_MARKERS.test(normalized)) return "accept_answer";
  if (OPEN_LIST_POSSIBILITY_QUESTION_MARKER.test(normalized) && normalized.includes("?")) return "clarification_request";
  // Same minimum-content bar isMeaningfulTextResponse's own generic fallback
  // already uses elsewhere in this codebase (compact.length >= 2) -- short
  // but real candidates ("우울", "불안", or this suite's own "문제1"/"목표1"
  // placeholders) must not be rejected purely for brevity.
  return normalized.replace(/[^\p{L}\p{N}]/gu, "").length >= 2 ? "accept_answer" : "unresolved";
}

// Phase 3: same self-contained best-effort approximation, for the RATING
// ONE ITEM AT A TIME guidance above (S02's problemRatings/goalRatings).
// Deliberately a single "current_item_correction" bucket, not separate
// reject/duplicate/wrong-construct patterns -- the runtime does the same
// thing (remove the item, record no rating) regardless of which reason the
// participant states, so splitting the taxonomy further would only grow the
// pattern list without changing any downstream behavior. Verified
// empirically against every example in the Phase 3 task brief plus every
// pre-existing S02 rating-correction regression phrase before being wired in.
const RATING_CORRECTION_REJECT_PATTERNS: RegExp[] = [
  /(?:이건|그건|이거|그거)?\s*(?:목표|문제).{0,20}(?:아니|아닌)/,
  /제가\s*(?:목표|문제)(?:라고|로)\s*(?:말한|넣은|한)\s*게?\s*(?:아니|아닌)/,
  // English quality parity, verified against a full English translation of
  // the Phase 3 test corpus plus a Korean-regression pass.
  /\bthis\s+(?:isn'?t|is\s+not|wasn'?t)\s+a\s+(?:goal|problem)\b/i,
  /\bthat'?s\s+not\s+a\s+(?:goal|problem)\b/i,
  /\bi\s+(?:didn'?t|never)\s+(?:say|said|mean|meant|mention)\s+(?:that|this)\s+(?:was|is|as|to\s+be)\s+a\s+(?:goal|problem)\b/i,
];
const RATING_CORRECTION_DUPLICATE_PATTERNS: RegExp[] = [
  /앞(?:에서|에|\s*항목|의).{0,15}(?:했|한|같|말한)/,
  /아까\s*(?:한|했|말한).{0,10}같/,
  /왜[\s\S]{0,6}또\s*(?:해야|평가)/,
  /\b(?:i\s+)?already\s+(?:did|answered|covered|rated)\s+(?:this|that)\b/i,
  /\bsame\s+as\s+(?:the\s+)?(?:before|earlier|one\s+before)\b/i,
  /\bwhy\s+do\s+i\s+(?:have\s+to|need\s+to)\s+(?:do|rate|answer)\s+(?:this|that)\s+again\b/i,
  /\bwe\s+already\s+(?:covered|did|talked\s+about)\s+(?:this|that)\b/i,
];
// "이것도 질문인데요" -- the item being rated is itself a leftover question,
// not that the participant doesn't understand the current question (that's
// RATING_CORRECTION_CLARIFICATION_PATTERNS below, a different disposition).
const RATING_CORRECTION_QUESTION_CONTAMINATION_PATTERNS: RegExp[] = [
  /(?:이건|이거|이것도|그건|그거)?\s*질문(?:인데|이(?:에요|다|잖아요)?|이었|한\s*건데|했는데)/,
  /\bthis\s+(?:is|was)\s+(?:also\s+)?a\s+question\b/i,
  /\bthat'?s\s+(?:also\s+)?a\s+question\b/i,
  /\bthis\s+is\s+actually\s+a\s+question\b/i,
];
// Rating revision ("I said 5 before, change it to 4") is explicitly NOT
// current-item-correction (the item is valid, only the recorded VALUE is in
// question) and is explicitly not implemented this phase -- maps to
// "unresolved" so it neither mutates the list nor silently records a
// guessed number, per the Phase 3 task brief section 6/15/25.
const RATING_REVISION_PATTERNS: RegExp[] = [
  /바꿀게요|바꾸고\s*싶|다시\s*(?:말하면|답하면)|정정할게요|수정할게요/,
  /\b(?:i\s+)?want\s+to\s+change\s+(?:my|that|this)\b/i,
  /\blet\s+me\s+change\s+(?:that|this|it|my\s+answer)\b/i,
  /\bchange\s+(?:my|that|it)\s+(?:answer|rating|score)?\s*to\b/i,
  /\bi\s+(?:said|meant)\s+\d.{0,15}\bchange\s+it\s+to\b/i,
];
const RATING_CORRECTION_CLARIFICATION_PATTERNS: RegExp[] = [
  /무슨\s*(?:뜻|의미)/,
  /어떤\s*의미/,
  /질문(?:을|이)\s*이해/,
  /\bwhat\s+do(?:es)?\s+(?:that|this|it)(?:\s+\w+)?\s+mean\b/i,
  /\bi\s+don'?t\s+understand\s+(?:the\s+question|that|this)\b/i,
];

function classifyRatingCorrectionTurn(rawText: string): "accept_answer" | "current_item_correction" | "clarification_request" | "unresolved" {
  const normalized = rawText.trim().toLowerCase();
  if (!normalized) return "unresolved";
  if (RATING_CORRECTION_CLARIFICATION_PATTERNS.some((pattern) => pattern.test(normalized))) return "clarification_request";
  if (RATING_CORRECTION_QUESTION_CONTAMINATION_PATTERNS.some((pattern) => pattern.test(normalized))) return "current_item_correction";
  if (RATING_CORRECTION_REJECT_PATTERNS.some((pattern) => pattern.test(normalized))) return "current_item_correction";
  if (RATING_CORRECTION_DUPLICATE_PATTERNS.some((pattern) => pattern.test(normalized))) return "current_item_correction";
  if (RATING_REVISION_PATTERNS.some((pattern) => pattern.test(normalized))) return "unresolved";
  return "accept_answer";
}

/** True when this request is asking to rate one already-named item from a
 * growing list, one at a time (S02's problemRatings/goalRatings) -- the only
 * context classifyRatingCorrectionTurn applies to. Every other "rating" type
 * prompt in every other session (S07/S08 percentage ratings, etc.) is
 * unaffected. */
function isRatingOneItemAtATimeRequest(request: AssessmentRequest): boolean {
  return request.allowedFields.includes("problemRatings") || request.allowedFields.includes("goalRatings");
}

class DeterministicAssessmentModel implements AssessmentModel {
  getProviderMetadata(): AssessmentProviderMetadata { return { provider: "deterministic", privacyBoundary: "none" }; }
  async healthCheck() { return { ok: true, provider: "deterministic" as const }; }
  async assessInput(request: AssessmentRequest): Promise<AssessmentResult> {
    const raw = request.patientInput.trim();
    const normalized = raw.toLowerCase();
    const words = normalized.match(/[a-z\u00c0-\u00ff]+/gi) ?? [];
    const hangul = (normalized.match(/[\uac00-\ud7a3]/g) ?? []).length;
    const nonAnswer = ["hi", "hello", "hey", "test", "testing", "ok", "okay", "yes", "no", "idk", "fuiissiidojfosid"].includes(normalized);
    const distinction = /distinction/i.test(`${request.inputType} ${request.expectedAnswerDescription ?? ""}`);
    // The S01 opening explicitly asks for a personally experienced situation.
    // Reject only unmistakable small-talk questions here: broad topic-word
    // filtering would incorrectly reject a real event such as a cancelled
    // appointment because of rain.
    const unrelatedSituationSmallTalk = request.allowedFields.includes("situationThoughtDistinction")
      && CLEAR_SMALL_TALK_MARKERS.test(normalized);
    const valid = !unrelatedSituationSmallTalk && !nonAnswer && normalized.length > 1 && (!distinction || words.length >= 2 || hangul >= 4);
    const directRisk = /\b(?:want to die|wanna die|kill myself|suicid|suisid)\b/i.test(normalized);
    const indirectRisk = /\b(?:disappear(?: forever)?|not wake up|better off without me|better off dead|no reason to live|everything to end|can't go on|cannot go on)\b/i.test(normalized);
    const extractedFields: Record<string, unknown> = {};
    if (request.allowedFields.includes("distressingSituation") && request.allowedFields.includes("automaticThought")) {
      const split = raw.match(/^(.*?)(?:,?\s+(?:and\s+)?(?:i\s+)?(?:thought|keep thinking|was thinking)\s+(?:that\s+)?)(.+)$/i);
      if (split?.[1]?.trim()) extractedFields.distressingSituation = split[1].trim();
      if (split?.[2]?.trim()) extractedFields.automaticThought = split[2].trim();
      if (!split && /\b(?:i am|i'm|i was|i'm not|i am not)\b/i.test(raw)) extractedFields.automaticThought = raw;
    }
    const extractedCount = Object.keys(extractedFields).length;
    const completionStatus = request.allowedFields.length > 1
      ? extractedCount === request.allowedFields.length ? "complete" : extractedCount > 0 ? "incomplete" : "needs_clarification"
      : valid ? "complete" : "needs_clarification";
    const turnAction = isRatingOneItemAtATimeRequest(request) ? classifyRatingCorrectionTurn(raw) : classifyOpenListTurn(raw);
    return { inputValid: valid, relevance: valid ? "relevant" : unrelatedSituationSmallTalk ? "irrelevant" : "unclear", intent: directRisk || indirectRisk ? "distress_disclosure" : unrelatedSituationSmallTalk ? "topic_shift" : valid ? "answer" : "other", extractedFields, completionStatus, safetyLevel: directRisk ? "high" : indirectRisk ? "moderate" : "none", safetySignals: directRisk ? ["direct_suicidal_language"] : indirectRisk ? ["indirect_safety_language"] : [], recommendedTransition: null, internalSummary: null, turnAction };
  }
}

class GeminiAssessmentModel extends BaseAssessmentModel {
  constructor(private readonly apiKey: string, private readonly model: string) { super(); }
  getProviderMetadata(): AssessmentProviderMetadata { return { provider: "gemini", model: this.model || undefined, privacyBoundary: "cloud" }; }
  async healthCheck() { if (!this.apiKey || !this.model) return { ok: false, provider: "gemini" as const, model: this.model || undefined, message: "GEMINI_API_KEY and GEMINI_MODEL are required" }; try { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}?key=${this.apiKey}`); return { ok: r.ok, provider: "gemini" as const, model: this.model, message: r.ok ? undefined : `Configured model is unavailable (${r.status})` }; } catch { return { ok: false, provider: "gemini" as const, model: this.model, message: "Gemini is unavailable" }; } }
  protected async invoke(request: AssessmentRequest) { const config = getAssessmentConfig(); if (!config.allowCloudPatientAssessment) throw new Error("Cloud patient assessment is disabled; select Ollama or deterministic processing."); const health = await this.healthCheck(); if (!health.ok) throw new Error(health.message); const started = performance.now(); const body = { systemInstruction: { parts: [{ text: systemInstruction() }] }, contents: [{ role: "user", parts: [{ text: JSON.stringify(config.redactCloudInput ? safeRequest(request) : request) }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: schema } }; const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${this.apiKey}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`Gemini assessment failed (${r.status})`); const json = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }; const text = json.candidates?.[0]?.content?.parts?.[0]?.text; if (!text) throw new Error("Gemini returned no JSON content"); return { data: JSON.parse(text), usage: { prompt_tokens: json.usageMetadata?.promptTokenCount, completion_tokens: json.usageMetadata?.candidatesTokenCount, total_tokens: json.usageMetadata?.totalTokenCount }, latencyMs: Math.round(performance.now() - started) }; }
}

let cached: AssessmentModel | undefined;
export function getAssessmentModel(): AssessmentModel {
  if (cached) return cached; const config = getAssessmentConfig();
  if (config.provider === "groq") cached = new OpenAICompatibleAssessmentModel("groq", "https://api.groq.com/openai/v1", config.groq.apiKey, config.groq.model);
  else if (config.provider === "ollama") cached = new OpenAICompatibleAssessmentModel("ollama", `${config.ollama.baseUrl.replace(/\/$/, "")}/v1`, "", config.ollama.model);
  else if (config.provider === "gemini") cached = new GeminiAssessmentModel(config.gemini.apiKey, config.gemini.model);
  else cached = new DeterministicAssessmentModel();
  return cached;
}
export function resetAssessmentModelForTests() { cached = undefined; }
// Phase 2 contract-level tests need to exercise all four turnAction values
// and a genuine provider failure without a live network call -- this is the
// same test-support idiom the codebase already uses for the six Postgres
// store endpoints and the dialogue agent (src/test/fakes/*.fake.ts +
// installFakeStoreFetch), not a new pattern. Never called from production
// code; only from tests, alongside resetAssessmentModelForTests.
export function setAssessmentModelForTests(model: AssessmentModel) { cached = model; }
