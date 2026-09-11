import { z } from "zod";
import type { DialogueContract, DialogueDecision } from "@/shared/dialogue-agent/dialogue-agent-contract";

/**
 * Patient Authorship Invariant -- channel layer (.claude/TASK_SCOPE.json
 * note2026_09_05, plan file goofy-orbiting-noodle.md Phase 2).
 *
 * The prior line of defense (dialogue-output-validator.ts's
 * assistant_supplied_participant_owned_content check) only ever inspected
 * Claude's own SELF-REPORTED candidateFieldMention -- a free-prose
 * patientFacingMessage that smoothed the participant's wording, invented an
 * assumption, or asserted a conclusion on their behalf passed untouched,
 * because nothing ever re-checked the prose itself against what the
 * participant actually said. This was confirmed live: 32 real turns from
 * stored real-Claude transcripts (artifacts/session-fidelity/live-claude-s07-s08/,
 * live-claude/) violate exactly this, none of them via candidateFieldMention.
 *
 * A denylist of bad phrases cannot close this gap -- the space of ways to
 * phrase an invented conclusion is not enumerable (this was tried first and
 * rejected; see the plan file's "왜 첫 설계는 폐기하는가" section). Instead,
 * for any turn that talks ABOUT a participant-owned field's content, Claude
 * is not permitted to submit free prose at all: it submits a MessagePart[]
 * built only from a fixed set of primitives, and the server -- never
 * Claude -- assembles the final text:
 *
 *   - approved_task: the protocol's own already-approved question (server
 *     substitutes contract.currentTaskText; Claude cannot alter it here).
 *   - quote: must be an exact (normalization-tolerant) substring of
 *     something the PARTICIPANT actually said or already had confirmed --
 *     verified against real transcript data, not trusted from Claude. This
 *     is a decidable predicate (true/false, no false negatives), unlike a
 *     regex "does this look like an invented conclusion" heuristic.
 *   - connector / repair: an id into a small, clinically-reviewed phrase
 *     table (CONNECTOR_TEXT / REPAIR_TEMPLATE_TEXT below) -- Claude picks
 *     from a fixed menu, it does not author the phrase.
 *   - example: illustrative scaffolding for a stalled participant (the
 *     manual's own failure-mode list bans "handing the patient a
 *     pre-formulated answer to ratify", not "helping when they are stuck" --
 *     S07's own step guidance explicitly permits offering numeric anchors).
 *     Always rendered inside a fixed, non-negotiable wrapper phrase so it
 *     reads as illustration, never as fact.
 *
 * Why this closes the S08 Turn 49->50 laundering case (Claude proposed an
 * example belief in one turn, then asserted it as "the belief we confirmed
 * through the trial" the next) without a separate cross-turn ledger: the
 * quote-source haystand below is built ONLY from participant-authored
 * content (their own messages, and confirmedState -- which
 * runtime-context.ts's extractRuntimeState is the sole writer of, and only
 * ever writes verbatim from the participant). Claude's own prior turns --
 * whether they were a quote, a connector, or an example -- are never a
 * valid quote source. An example offered in turn N therefore can never
 * become a "quote" in turn N+1 UNLESS the participant's own subsequent
 * message actually contains it -- at which point it legitimately is their
 * own wording. There is deliberately no exception carved out for "Claude's
 * own recently-approved connector/quote text": the P0-2 lesson already
 * documented in runtime-context.ts (a broader substring match once caused a
 * real regression) argues for the narrowest source set that still works,
 * not the widest one that might.
 */

export const CONNECTOR_IDS = [
  "acknowledge_neutral",
  "understood",
  "check_understanding",
  "lets_continue",
  "anything_to_add",
  "noted_move_on",
  "worksheet_edit_available",
  "worksheet_edit_unavailable",
] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export const REPAIR_TEMPLATE_IDS = [
  "wrong_construct",
  "partial_answer",
  "needs_one_specific",
] as const;
export type RepairTemplateId = (typeof REPAIR_TEMPLATE_IDS)[number];

type LocaleBucket = "ko" | "en";

function localeBucket(locale: string): LocaleBucket {
  return locale.toLowerCase().startsWith("ko") ? "ko" : "en";
}

// Short, content-free turn framing. Deliberately NOT clinical content --
// nothing here can assert, conclude, or interpret anything about the
// participant. Sourced from tone already present in this codebase's own
// approved static messages and systemPrompt's existing "brief
// acknowledgement" guidance (anthropic-dialogue-agent.ts), not invented
// fresh. FLAG FOR CLINICAL REVIEW before this set is trusted in a live RCT
// turn -- see the plan file's Phase 2 note that these phrase tables were
// drafted, not clinically validated.
export const CONNECTOR_TEXT: Record<ConnectorId, Record<LocaleBucket, string>> = {
  acknowledge_neutral: { en: "Thank you for sharing that.", ko: "말씀해 주셔서 감사해요." },
  understood: { en: "I hear that.", ko: "네, 잘 들었어요." },
  check_understanding: { en: "Did I get that right?", ko: "제가 제대로 이해했나요?" },
  lets_continue: { en: "Let's continue.", ko: "이어서 진행해 볼게요." },
  anything_to_add: { en: "Is there anything you'd like to add?", ko: "더 덧붙이고 싶은 게 있으실까요?" },
  noted_move_on: { en: "Understood -- let's move on.", ko: "알겠습니다, 다음으로 넘어갈게요." },
  // Copied verbatim from this codebase's own pre-existing revision_request
  // handling (previously inline in src/test/fakes/dialogue-agent.fake.ts) --
  // moved here as reusable connectors rather than invented fresh.
  worksheet_edit_available: { en: "Of course -- you can edit that directly, and I'll use your updated answer from here on.", ko: "네, 워크시트에서 직접 수정하실 수 있어요. 이후에는 수정하신 내용으로 진행할게요." },
  worksheet_edit_unavailable: { en: "I hear you. Changing an earlier answer isn't automated in this conversation yet, but let's continue and you can tell me the correction.", ko: "말씀 이해했어요. 아직 이 대화에서는 이전 답변을 자동으로 수정할 수는 없지만, 계속 진행하면서 정정하실 내용을 말씀해 주세요." },
};

// Deliberately generic and construct-agnostic: a repair turn's specific
// task is always re-delivered via an "approved_task" part alongside one of
// these, rather than Claude describing the mismatch in its own words (which
// would itself be free-form prose about the participant's answer -- exactly
// what this module exists to prevent). See this file's header comment for
// why localized, construct-specific wording (e.g. "that sounds like an
// emotion, not a thought") is not attempted here: CONSTRUCT_TERMINOLOGY_PATTERNS
// in dialogue-contract-compiler.ts is English-only, so splicing it into a
// Korean repair sentence would produce mixed-language output.
export const REPAIR_TEMPLATE_TEXT: Record<RepairTemplateId, Record<LocaleBucket, string>> = {
  wrong_construct: { en: "That's not quite what I'm looking for here.", ko: "지금 여쭤보는 것과는 조금 다른 것 같아요." },
  partial_answer: { en: "Thank you -- I have part of that.", ko: "네, 일부는 들었어요." },
  needs_one_specific: { en: "Let's narrow that down to one specific example.", ko: "구체적인 예시 하나로 좁혀볼게요." },
};

const EXAMPLE_WRAPPER: Record<LocaleBucket, (text: string) => string> = {
  en: (text) => `For example, something like "${text}."`,
  ko: (text) => `예를 들면 "${text}" 처럼요.`,
};

const QUOTE_WRAPPER: Record<LocaleBucket, (text: string) => string> = {
  en: (text) => `"${text}"`,
  ko: (text) => `"${text}"`,
};

export const messagePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approved_task") }),
  z.object({ kind: z.literal("quote"), text: z.string().min(1) }),
  z.object({ kind: z.literal("connector"), id: z.enum(CONNECTOR_IDS) }),
  z.object({ kind: z.literal("repair"), id: z.enum(REPAIR_TEMPLATE_IDS) }),
  z.object({ kind: z.literal("example"), text: z.string().min(1) }),
]);
export type MessagePart = z.infer<typeof messagePartSchema>;

// Response types that talk ABOUT the participant's own content -- these are
// exactly the ones the manual's "the patient formulates it, not you"
// requirements govern (participant_summary_required, "the patient
// formulates the UA, not you", "the verdict must come from the
// participant"). explain_rationale/explain_term/explain_scale/
// show_required_visual/acknowledge_pause talk about the PROTOCOL, never the
// participant's content, so free prose remains fine there -- see
// dialogue-output-validator.ts's requiresAssembledMessage.
export const PATIENT_CONTENT_RESPONSE_TYPES: ReadonlySet<string> = new Set([
  "acknowledge",
  "reflect_and_ask",
  "clarify",
  "repair",
  "restore_context",
  "request_missing_field",
]);

// Originally a progressive rollout (S08 first). Widened to all eight sessions
// by the user's 2026-09-11 decision (.claude/TASK_SCOPE.json
// note2026_09_11_reflect_and_confirm): assistant summaries/conclusions are
// allowed again, but only through summarize_and_confirm, which always ends
// in a confirmation question. That guarantee holds only if no OTHER
// patient-content response type can carry free prose -- i.e. only if every
// session is gated. Live fallback rate and tone for S01-S07 still need
// measuring (audit:sessions:constrained with a real key).
export const MESSAGE_COMPOSITION_ENABLED_SESSIONS: ReadonlySet<string> = new Set(["tbct-s01", "tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"]);

/** The contract-level half of the gate -- knowable before Claude has chosen
 * a responseType, so the system prompt (built from the contract alone) can
 * decide whether to even mention the assembly requirement.
 *
 * Every turn of an enabled session, regardless of field ownership. This
 * used to gate only turns whose own field (assistantMustNotSupply) or node
 * (nodeRequiresProtectedField, note2026_09_07) was participant-owned. The
 * 2026-09-11 mock-Claude audit (Reflect-and-Confirm follow-up) showed why
 * that is not enough once free prose is the channel being closed: on the
 * 13 of 272 prompts whose field is a pure administrative flag ("do you have
 * the rating card?", the scale presentation, the three-person preview), a
 * model could still ship an invented conclusion about the participant as
 * ordinary prose with no confirmation question -- 5 such turns reached the
 * participant across S01/S02/S06. What a turn may SAY about the participant
 * does not depend on which field the turn happens to record. */
export function contractMayRequireAssembly(contract: DialogueContract): boolean {
  return MESSAGE_COMPOSITION_ENABLED_SESSIONS.has(contract.sessionId);
}

export function requiresAssembledMessage(contract: DialogueContract, decision: Pick<DialogueDecision, "responseType">): boolean {
  return contractMayRequireAssembly(contract) && PATIENT_CONTENT_RESPONSE_TYPES.has(decision.responseType);
}

function normalizeForQuoteMatch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s.,!?~'"“”‘’「」『』()—–\-:;]/g, "");
}

/** Flattens confirmedState's arbitrary JSON-ish values into candidate quote
 * strings, depth-capped at 3 so a pathological nested value can't blow this
 * up -- confirmedState is always a flat-ish Record<string, unknown> of
 * already-extracted field values in practice (dialogue-contract-compiler.ts's
 * confirmedStateFor). */
function flattenToStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => flattenToStrings(item, depth + 1));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap((item) => flattenToStrings(item, depth + 1));
  return [];
}

/** The ONLY sources a "quote" part may be verified against -- every one of
 * them is either the participant's own words this turn, the participant's
 * own words in the last few turns, or a canonical field value that
 * extractRuntimeState (runtime-context.ts) wrote verbatim from the
 * participant. Deliberately excludes contract.currentTaskText/
 * therapeuticObjective/participantRationale/expectedConstruct (protocol
 * content, not participant content -- those belong in an "approved_task"
 * part, never a "quote") and every one of Claude's OWN past turns in
 * recentContext (see this file's header comment for why: that is exactly
 * the S08 Turn 49->50 laundering path). */
function collectQuoteSources(contract: DialogueContract): string[] {
  const sources: string[] = [];
  if (contract.lastParticipantMessage) sources.push(contract.lastParticipantMessage);
  for (const message of contract.recentContext) {
    if (message.role === "patient") sources.push(message.content);
  }
  sources.push(...flattenToStrings(contract.confirmedState));
  return sources;
}

const MIN_QUOTE_LENGTH = 6;

/** True/false, never "looks suspicious" -- see this file's header comment.
 * A normalized quote of at least MIN_QUOTE_LENGTH chars must appear EXACTLY
 * (after normalization) in one of the sources. An earlier draft of this
 * function also tolerated a Korean ending-inflection change (trimming the
 * quote's last two characters before matching, for cases like "망쳤어요" vs
 * "망쳤다"), but the message-composition.test.ts regression fixture built
 * from S08 Turn 3's real violation ("결국 나는 부족한 사람이라는 뜻인 것
 * 같아요" smoothed into "결국 나는 부족한 사람이다") showed that same
 * tolerance also accepts dropping an entire hedge clause ("-라는 뜻인 것
 * 같아요") whenever it happens to be exactly two normalized characters
 * longer than the replacement ending -- precisely the P0-2 lesson already
 * documented in runtime-context.ts (a broader substring match caused a real
 * regression before): the narrower rule that cannot be gamed is the only
 * one kept. If a participant's own verb ending genuinely needs to be
 * reflected, quote them exactly as they said it. */
function isVerifiedQuote(text: string, sources: string[]): boolean {
  const normalizedQuote = normalizeForQuoteMatch(text);
  if (normalizedQuote.length < MIN_QUOTE_LENGTH) return false;
  return sources.some((source) => normalizeForQuoteMatch(source).includes(normalizedQuote));
}

/** Reflect-and-Confirm (.claude/TASK_SCOPE.json note2026_09_11): the fixed
 * question every assistant summary ends with -- the existing
 * check_understanding connector, not new wording. */
export const SUMMARY_CHECK_QUESTION = CONNECTOR_TEXT.check_understanding;

const MAX_SUMMARY_LENGTH = 300;
// Formal/polite Korean interrogative endings. "?" alone would miss "…하셨나요."
// typed with a full stop; "니까" is left out because "…했으니까" (because)
// is an ordinary declarative.
const KOREAN_QUESTION_ENDING = /(?:나요|까요|습니까|는지요|인가요)$/;

function containsQuestion(text: string) {
  if (/[?？]/.test(text)) return true;
  return text.split(/[.!。\n]+/).some((sentence) => KOREAN_QUESTION_ENDING.test(sentence.trim()));
}

export type SummaryCheckAssemblyResult = { ok: true; text: string; summaryText: string } | { ok: false; reason: string };

/** Server-side assembly of a summarize_and_confirm turn: Claude's summary
 * body followed by SUMMARY_CHECK_QUESTION, which Claude never writes itself.
 * Every rejection is a checkable fact about the text (not a judgment of its
 * clinical quality): the body may not ask anything -- the confirmation is
 * the turn's only question, and the next task is held back until it is
 * answered (runtime-execution-api.ts's deliverReflectionCheckReplyTurn). */
export function assembleSummaryCheck(summary: string, contract: DialogueContract): SummaryCheckAssemblyResult {
  if (!contract.summaryCheckAllowed) return { ok: false, reason: "summary_check_not_allowed" };
  const body = summary.replace(/\s+/g, " ").trim();
  if (!body) return { ok: false, reason: "empty_summary" };
  if (body.length > MAX_SUMMARY_LENGTH) return { ok: false, reason: "summary_too_long" };
  const task = normalizeForQuoteMatch(contract.currentTaskText);
  if (task.length >= MIN_QUOTE_LENGTH && normalizeForQuoteMatch(body).includes(task)) return { ok: false, reason: "summary_contains_task" };
  if (containsQuestion(body)) return { ok: false, reason: "summary_contains_question" };
  return { ok: true, text: `${body} ${SUMMARY_CHECK_QUESTION[localeBucket(contract.locale)]}`, summaryText: body };
}

export type MessageAssemblyResult = { ok: true; text: string } | { ok: false; reason: string };

const MAX_ASSEMBLED_LENGTH = 700;

/** Deterministic, server-side assembly -- Claude never writes the final
 * string for a gated turn; it only points at pieces the server already
 * trusts (see this file's header comment). Every rejection reason here is a
 * checked fact about the transcript, not a guess about phrasing. */
export function assembleMessage(parts: MessagePart[], contract: DialogueContract): MessageAssemblyResult {
  if (!parts.length) return { ok: false, reason: "empty_message_parts" };
  const bucket = localeBucket(contract.locale);
  const quoteSources = collectQuoteSources(contract);
  const pieces: string[] = [];

  for (const part of parts) {
    switch (part.kind) {
      case "approved_task":
        pieces.push(contract.currentTaskText);
        break;
      case "connector":
        pieces.push(CONNECTOR_TEXT[part.id][bucket]);
        break;
      case "repair":
        pieces.push(REPAIR_TEMPLATE_TEXT[part.id][bucket]);
        break;
      case "quote":
        if (!isVerifiedQuote(part.text, quoteSources)) return { ok: false, reason: "misquoted_participant" };
        pieces.push(QUOTE_WRAPPER[bucket](part.text.trim()));
        break;
      case "example":
        pieces.push(EXAMPLE_WRAPPER[bucket](part.text.trim()));
        break;
    }
  }

  const text = pieces.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, reason: "empty_message_parts" };
  if (text.length > MAX_ASSEMBLED_LENGTH) return { ok: false, reason: "assembled_message_too_long" };
  return { ok: true, text };
}
