import { claimRuntimePatientTurn, claimRuntimeSessionStart, commitRuntimeAssistantTurn, saveRuntimeEscalation, saveRuntimeLog, updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { cleanupExpiredTriggerSuppressions, findActiveTriggerSuppression, updateTriggerSuppression } from "@/shared/data/repositories/safety-event-repository";
import { createRuntimeCheckpoint, getRuntimeSession, getRuntimeSessionForTurn, setRuntimeSessionStatus } from "@/shared/api/runtime-session-api";
import { runMemoryRetrieval } from "@/shared/api/longitudinal-memory-api";
import { extractMemoryCandidates, generateSessionSummary } from "@/shared/api/session-summary-api";
import { createSafetyEvent, findOpenSafetyEventByTriggerKey, patchSafetyEvent, placeSessionOnSafetyHold } from "@/shared/api/safety-operations-api";
import { getRuntimeParticipant } from "@/shared/api/participant-api";
import { mergeExtractedRuntimeContext, extractRuntimeState, isExplicitPatientRefusal, violatesThirdPersonRequirement, normalizeText, looksLikeMetaQuestionAboutTheProcess, looksLikeMeaningClarificationRequest, looksLikeS02ExplanationRequest } from "@/shared/runtime/runtime-context";
import { detectLanguageSwitchRequest } from "@/shared/runtime/language-switch-detector";
import { describePatientInputForDisplay } from "@/shared/runtime/patient-input-display";
import { executeRuntimeNodeMessage } from "@/shared/runtime/runtime-node-executor";
import { runSafetyOrchestrator } from "@/shared/runtime/runtime-safety-orchestrator";
import { createRuntimeExecutionTrace } from "@/shared/runtime/runtime-execution-tracer";
import { isPatientFacingLocaleConsistent } from "@/shared/runtime/runtime-output-validator";
import { injectLongitudinalMemory } from "@/shared/memory/memory-context-injector";
import { projectRuntimeFieldsToWorksheet } from "@/shared/worksheet/worksheet-projection";
import { isDialogueAgentEnabled, resolveDialogueAgentMessage } from "@/shared/dialogue-agent/dialogue-agent-orchestrator";
import { resolveBracketPlaceholders, resolveStaticPatientMessage } from "@/shared/runtime/runtime-static-message";
import { MAX_SUMMARIES_PER_CHECK, REFLECTION_ASK_WHAT_DIFFERS, REFLECTION_MOVE_ON, classifyReflectionCheckReply, findPendingReflectionCheck, reflectionText, type PendingReflectionCheck, type ReflectionCheckResolution } from "@/shared/runtime/reflection-check";
import { composeCrpPlanSummary } from "@/patient/sessions/s07/messages";
import { composeTrialClosingSummary } from "@/patient/sessions/s08/messages";
import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import { loadRuntimeRelease, normalizeRuntimeSessionState } from "@/shared/runtime/runtime-release-loader";
import { PASSIVE_PROMPT_TYPES as PASSIVE_CLARIFICATION_PROMPT_TYPES, acknowledgedOnDeliveryFields, resolvePromptLocaleText } from "@/shared/runtime/runtime-release-normalizer";
import { reduceRuntimeState } from "@/shared/runtime/runtime-state-reducer";
import { assertRuntimeTransition } from "@/shared/runtime/runtime-state-machine";
import { evaluateRuntimeCondition, resolveActiveRuntimeStep } from "@/shared/runtime/runtime-step-resolver";
import type { ProtocolReleaseVersion } from "@/types/protocol-runtime";
import type { PatientInput, RuntimeCycleResult, RuntimeMessage, RuntimeSession, RuntimeSessionStatus, RuntimeSessionView, SessionExecutionLog } from "@/types/runtime-session";

async function submitPatientInputOnServer(sessionId: string, patientInput: PatientInput, options: { clientTurnId?: string; expectedSessionVersion?: number; locale?: string }): Promise<RuntimeCycleResult> {
  const response = await fetch("/api/runtime/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, patientInput, options }),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: RuntimeCycleResult; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.result) throw new Error(payload?.error ?? `Patient turn failed (${response.status})`);
  return payload.result;
}
import type { SafetyTriggerSuppression } from "@/types/safety-operations";

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") {
    return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeLog(runtimeSessionId: string, stage: SessionExecutionLog["stage"], status: SessionExecutionLog["status"], summary: string, extra: Partial<SessionExecutionLog> = {}): SessionExecutionLog {
  return {
    id: makeId("RLOG"),
    runtimeSessionId,
    timestamp: new Date().toISOString(),
    stage,
    status,
    summary,
    ...extra,
  };
}

function mergePromptItemIds(...collections: Array<string[] | undefined>) {
  return [...new Set(collections.flatMap((collection) => collection ?? []))];
}

export function getPromptCompletionEffectType(promptItem: PromptItem) {
  return typeof promptItem.completionEffect?.type === "string" ? promptItem.completionEffect.type : "advance_prompt";
}

export function applyPromptCompletionEffect(runtimeContext: RuntimeSession["runtimeContext"], promptItem: PromptItem, locale = "en-US"): RuntimeSession["runtimeContext"] {
  const validationKind = String((promptItem.validation as { kind?: unknown } | null)?.kind ?? "");
  const ratingValues = (value: unknown): number[] => {
    if (Array.isArray(value)) return value.flatMap(ratingValues);
    if (typeof value === "number" && Number.isFinite(value)) return [value];
    if (typeof value === "string") return [...value.matchAll(/\b[0-5]\b/g)].map((match) => Number(match[0]));
    return [];
  };
  if (validationKind === "calculated_problem_totals") {
    const ratings = ratingValues(runtimeContext.fields.problemRatings);
    return { ...runtimeContext, fields: { ...runtimeContext.fields, totalProblemScore: ratings.reduce((sum, value) => sum + value, 0), yellowRedProblemsCount: ratings.filter((value) => value >= 4).length } };
  }
  if (validationKind === "calculated_goal_totals") {
    const ratings = ratingValues(runtimeContext.fields.goalRatings);
    return { ...runtimeContext, fields: { ...runtimeContext.fields, totalGoalsScore: ratings.reduce((sum, value) => sum + value, 0), yellowRedGoalsCount: ratings.filter((value) => value >= 4).length } };
  }
  // S07's closing summarizes the six action-plan fields back to the
  // participant and then completes the session on delivery -- it never waits
  // for an answer, so nothing could ever write crpPlanSummary and the field
  // stayed empty in every completed run. Record the exact string that was
  // spoken (composeCrpPlanSummary is the same composer the static-message
  // resolver uses) so the message and the stored summary cannot drift.
  if (validationKind === "plan_summary_without_praise_or_persuasion") {
    return { ...runtimeContext, fields: { ...runtimeContext.fields, crpPlanSummary: composeCrpPlanSummary(runtimeContext.fields, locale) } };
  }
  // S08's Step 21 closing works the same way: the warm before/after
  // comparison is spoken on delivery and completes the session, so the
  // identical composed string is recorded here rather than left unwritten.
  if (validationKind === "warm_before_after_comparison") {
    return { ...runtimeContext, fields: { ...runtimeContext.fields, trialClosingSummary: composeTrialClosingSummary(runtimeContext.fields, locale) } };
  }
  const effect = promptItem.completionEffect;
  // Copies an already-confirmed field's value into a second field this
  // prompt is nominally "about" but never independently collects -- e.g.
  // S08's state-charge explanation restates the core belief (captured back
  // in Step 1) as the formal charge, so the charge field needs the same
  // value rather than a fresh, never-asked-for participant answer.
  if (effect?.type === "copy_field" && typeof effect.from === "string" && typeof effect.to === "string") {
    const sourceValue = runtimeContext.fields[effect.from];
    if (sourceValue === undefined || sourceValue === "") return runtimeContext;
    return { ...runtimeContext, fields: { ...runtimeContext.fields, [effect.to]: sourceValue } };
  }
  if (effect?.type === "set_field" && typeof effect.field === "string") {
    return { ...runtimeContext, fields: { ...runtimeContext.fields, [effect.field]: effect.value } };
  }
  if (effect?.type === "redirect_to_three_person_example") {
    return { ...runtimeContext, fields: { ...runtimeContext.fields, redirectToThreePersonExample: true } };
  }
  // See acknowledgedOnDeliveryFields: a passive prompt's outputFields can only
  // mean "this content was delivered", and nothing else in the runtime could
  // ever write them.
  const acknowledged = Object.fromEntries(acknowledgedOnDeliveryFields(promptItem).filter((field) => runtimeContext.fields[field] === undefined).map((field) => [field, true]));
  if (Object.keys(acknowledged).length) return { ...runtimeContext, fields: { ...runtimeContext.fields, ...acknowledged } };
  return runtimeContext;
}

function deterministicValidation(finalText: string) {
  return {
    accepted: true,
    corrected: false,
    rejected: false,
    issues: [],
    finalText,
    fallbackRequired: false,
  };
}

const MAX_CLARIFICATION_ATTEMPTS = 3;

/** Names the courtroom role a prompt is spoken from, for the third-person
 * correction below. Keyed on the NODE id, not the prompt slug: Step 10's
 * prompt is "rebut-each-defense-item" but is argued by the PROSECUTOR, so
 * matching the slug would name the wrong role at exactly the moment the
 * correction is meant to remind the participant which role they are in. The
 * node id ("...n10-prosecution-rebuttal") is authored, never participant
 * data, so this stays deterministic. */
const ROLE_NAME_BY_NODE_FRAGMENT: Array<[RegExp, { en: string; ko: string }]> = [
  [/prosecut/, { en: "the prosecutor", ko: "검사" }],
  [/defense|surrebuttal/, { en: "the defense attorney", ko: "변호인" }],
  [/jury|juror/, { en: "a juror", ko: "배심원" }],
];

export function courtroomRoleNameForNode(nodeId: string) {
  return ROLE_NAME_BY_NODE_FRAGMENT.find(([pattern]) => pattern.test(nodeId))?.[1];
}

async function deliverClarificationTurn(input: {
  session: RuntimeSession;
  node: ClinicalStageNode;
  promptItem: PromptItem;
  runtimePromptItem: import("@/types/protocol-runtime").RuntimePromptItem;
  release: ProtocolReleaseVersion;
  runtimeState: NonNullable<RuntimeSession["runtimeState"]>;
  patientMessage: RuntimeMessage;
  reason: string;
  missingFields?: string[];
  recentAssistantMessages?: string[];
  recentMessages?: RuntimeMessage[];
}) {
  const clarificationAttemptCount = (input.session.runtimeContext.clarificationAttemptCount ?? 0) + 1;
  const missing = new Set(input.missingFields ?? []);
  const isKorean = (input.session.locale ?? "").toLowerCase().startsWith("ko");
  const tr = (en: string, ko: string) => (isKorean ? ko : en);
  // "Passive" nodes (explanation/instruction/transition/etc.) present information rather
  // than ask a question -- a short reply here is usually the patient asking to move on,
  // not an incomplete answer, so it should never be met with "give a concrete example."
  const isPassiveNode = PASSIVE_CLARIFICATION_PROMPT_TYPES.has(input.promptItem.type);
  // S08 Key Principle 3: a first-person slip inside a courtroom role gets ONE
  // gentle, immediate correction naming the role -- not a generic "could you
  // give a concrete example". extractRuntimeState routes only the first such
  // turn here (see its clarificationAttemptCount === 0 gate), so this can
  // never become a loop.
  const roleName = courtroomRoleNameForNode(input.promptItem.nodeId);
  const thirdPersonCorrection = roleName
    && (input.promptItem.validation as { requiresThirdPerson?: boolean } | null)?.requiresThirdPerson
    && violatesThirdPersonRequirement(input.patientMessage.content)
    ? tr(
        `I noticed you said "I" just now -- remember, right now you are speaking as ${roleName.en}, about the defendant. Could you say that again in the third person?`,
        `방금 "저"라고 말씀하셨어요 -- 지금은 ${roleName.ko}(으)로서 피고인에 대해 이야기하시는 중이에요. 3인칭으로 다시 말씀해 주시겠어요?`,
      )
    : undefined;
  // P1 (Session 2 manual-control recovery): "\uc798 \ubaa8\ub974\uaca0\ub294\ub370 \uc124\uba85\ud574\uc8fc\uc138\uc694" /
  // "\ubb34\uc2a8\uc9c8\ubb38\uc774\uc694?" at the rating-card question, or during problem/goal
  // collection, must explain what's actually being asked -- not the
  // generic "give a short concrete example" fallback (adaptiveClarification
  // below), which says nothing about scale cards or problems/goals at all.
  const isS02RatingCardCheck = input.promptItem.id === "tbct-s02-n04-p01-rating-card-check" || input.promptItem.id === "tbct-s02-n08-p01-goal-rating-card-check";
  const isS02ListCollection = missing.has("problems") || missing.has("goals");
  const s02ExplanationClarification = (isS02RatingCardCheck || isS02ListCollection) && looksLikeS02ExplanationRequest(input.patientMessage.content)
    ? isS02RatingCardCheck
      ? tr(
          "The rating scale card is a reference sheet for scoring each problem or goal from 0 to 5. It's fine if you don't have it in front of you -- I'll walk you through what each score means right after this.",
          "\ud3c9\uac00 \ucc99\ub3c4 \uce74\ub4dc\ub294 \ubb38\uc81c\ub098 \ubaa9\ud45c\ub97c 0\uc810\ubd80\ud130 5\uc810\uae4c\uc9c0 \ud3c9\uac00\ud560 \ub54c \ucc38\uace0\ud558\ub294 \uae30\uc900\ud45c\uc608\uc694. \uce74\ub4dc\uac00 \ubc14\ub85c \ubcf4\uc774\uc9c0 \uc54a\uc544\ub3c4 \uad1c\ucc2e\uc544\uc694. \uc81c\uac00 \uac01 \uc810\uc218\uc758 \uc758\ubbf8\ub97c \uc774\uc5b4\uc11c \uc124\uba85\ud574 \ub4dc\ub9b4\uac8c\uc694.",
        )
      : missing.has("problems")
        ? tr(
            "I'm asking about something in your life right now that feels difficult or that you'd like to change. Just one thing that comes to mind is enough -- no need to think of several at once.",
            "\uc9c0\uae08 \uc0dd\ud65c\ud558\uba74\uc11c \ud798\ub4e4\uac8c \ub290\uaef4\uc9c0\ub294 \uac83\uc774\ub098 \ubc14\uafb8\uace0 \uc2f6\uc740 \uac83\uc5d0 \ub300\ud574 \uc5ec\uc5b4\ubcf4\ub294 \uac70\uc608\uc694. \ud55c \ubc88\uc5d0 \uc5ec\ub7ec \uac1c\ub97c \ub5a0\uc62c\ub9ac\uc9c0 \uc54a\uc73c\uc154\ub3c4 \ub418\uace0, \uac00\uc7a5 \uba3c\uc800 \uc0dd\uac01\ub098\ub294 \uac83 \ud558\ub098\uba74 \ucda9\ubd84\ud574\uc694.",
          )
        : tr(
            "I'm asking about something you'd like therapy to help you work toward. Just one thing that comes to mind is enough for now.",
            "\uce58\ub8cc\ub97c \ud1b5\ud574 \uc774\ub8e8\uace0 \uc2f6\uc740 \uac83\uc5d0 \ub300\ud574 \uc5ec\uc5b4\ubcf4\ub294 \uac70\uc608\uc694. \uc9c0\uae08\uc740 \ub5a0\uc624\ub974\ub294 \uac83 \ud558\ub098\ub9cc \ub9d0\uc500\ud574 \uc8fc\uc154\ub3c4 \ub3fc\uc694.",
          )
    : undefined;
  const sourceSpecificClarification = thirdPersonCorrection ?? s02ExplanationClarification ?? (input.promptItem.id === "tbct-s08-n01-p04-distressing-situation"
    ? missing.has("distressingSituation") && !missing.has("automaticThought")
      ? tr("Please describe a specific distressing situation and the important facts of what actually happened.", "\uad6c\uccb4\uc801\uc73c\ub85c \ud798\ub4e4\uc5c8\ub358 \uc0c1\ud669\uacfc \uc2e4\uc81c\ub85c \uc788\uc5c8\ub358 \uc911\uc694\ud55c \uc0ac\uc2e4\uc744 \ub9d0\uc500\ud574 \uc8fc\uc2dc\uaca0\uc5b4\uc694?")
      : missing.has("automaticThought") && !missing.has("distressingSituation")
        ? tr("What automatic thought did that situation trigger?", "\uadf8 \uc0c1\ud669\uc5d0\uc11c \uc5b4\ub5a4 \uc0dd\uac01\uc774 \uc2a4\uccd0 \uc9c0\ub098\uac14\ub098\uc694?")
        : tr("Please identify a specific distressing situation and the automatic thought it triggered. What actually happened, and what went through your mind?", "\uad6c\uccb4\uc801\uc73c\ub85c \ud798\ub4e4\uc5c8\ub358 \uc0c1\ud669\uacfc \uadf8\ub54c \ub5a0\uc624\ub978 \uc0dd\uac01\uc744 \ub9d0\uc500\ud574 \uc8fc\uc2dc\uaca0\uc5b4\uc694? \uc2e4\uc81c\ub85c \ubb34\uc2a8 \uc77c\uc774 \uc788\uc5c8\uace0, \uc5b4\ub5a4 \uc0dd\uac01\uc774 \uc2a4\uccd0 \uc9c0\ub098\uac14\ub098\uc694?")
    : undefined);
  const proposedContent = input.reason === "patient_refusal"
    ? tr(
        "I understand. We can pause here, and you do not need to continue. You can end the session or resume later only if you choose. If it helps, I can summarize what we've covered so far instead.",
        "\uc54c\uaca0\uc2b5\ub2c8\ub2e4. \uc5ec\uae30\uc11c \uba48\ucd94\uc154\ub3c4 \uad1c\ucc2e\uc544\uc694. \uacc4\uc18d\ud558\uc9c0 \uc54a\uc73c\uc154\ub3c4 \ub429\ub2c8\ub2e4. \uc6d0\ud558\uc2dc\uba74 \uc5ec\uae30\uc11c \uc138\uc158\uc744 \ub9c8\uce58\uac70\ub098 \ub098\uc911\uc5d0 \ub2e4\uc2dc \uc774\uc5b4\uac00\uc2e4 \uc218 \uc788\uc5b4\uc694. \uad1c\ucc2e\uc73c\uc2dc\uba74 \uc9c0\uae08\uae4c\uc9c0 \uc774\uc57c\uae30\ud55c \ub0b4\uc6a9\uc744 \uc81c\uac00 \uc694\uc57d\ud574 \ub4dc\ub9b4\uae4c\uc694?",
      )
    : input.reason === "safety_clarification"
      ? tr(
          "I want to make sure I understand you correctly. Are you saying that you may be thinking about dying or harming yourself, or do you mean that things feel overwhelming right now?",
          "\uc81c\uac00 \uc815\ud655\ud788 \uc774\ud574\ud588\ub294\uc9c0 \ud655\uc778\ud558\uace0 \uc2f6\uc5b4\uc694. \uc8fd\uace0 \uc2f6\uac70\ub098 \uc2a4\uc2a4\ub85c\ub97c \ud574\uce58\uace0 \uc2f6\ub2e4\ub294 \uc0dd\uac01\uc774 \ub4e0\ub2e4\ub294 \ub73b\uc778\uac00\uc694, \uc544\ub2c8\uba74 \uc9c0\uae08 \uc0c1\ud669\uc774 \uac10\ub2f9\ud558\uae30 \ud798\ub4e4\uac8c \ub290\uaef4\uc9c4\ub2e4\ub294 \ub73b\uc778\uac00\uc694?",
        )
    : sourceSpecificClarification ?? resolveBracketPlaceholders(resolvePromptLocaleText(input.runtimePromptItem.id, input.runtimePromptItem.clarificationPatientText ?? input.runtimePromptItem.fallbackPatientText, input.session.locale), input.session.runtimeContext);
  const normalizeMessage = (value: string) => value.toLowerCase().replace(/[^a-z0-9\uac00-\ud7a3]+/g, " ").trim();
  const duplicatesRecentQuestion = (input.recentAssistantMessages ?? []).slice(-3).some((message) => normalizeMessage(message) === normalizeMessage(proposedContent));
  // Prefer whichever of this prompt's outputFields is actually still
  // missing, not always outputFields[0] -- a prompt with more than one
  // outputField (e.g. distressingSituation + automaticThought) would
  // otherwise keep re-asking about the FIRST field's pattern forever even
  // after the participant has fully answered it, since outputFields[0]
  // never changes regardless of what's genuinely still unfilled.
  const outputField = input.promptItem.outputFields.find((item) => missing.has(item)) ?? input.promptItem.outputFields[0] ?? "";
  const validation = input.promptItem.validation as { kind?: unknown; values?: unknown; min?: unknown; max?: unknown } | null;
  const enumValues = Array.isArray(validation?.values) ? validation.values.map(String) : [];
  // Every branch below now varies by clarificationAttemptCount (attempt 1
  // vs. 2+) -- previously only the Situation/Thought patterns did, so any
  // other field (Emotion/Behavior/Reaction/Body, enum choices, ratings, the
  // passive-node and generic catch-all lines) sent the EXACT same
  // deterministic text on every one of MAX_CLARIFICATION_ATTEMPTS (3)
  // retries. This is what actually ships whenever the dialogue agent call
  // fails or gets rejected (deterministicFallbackText below), so a run of
  // Claude failures on the same field used to look like the assistant
  // stubbornly repeating itself. See the matching "don't repeat yourself"
  // instruction added to anthropic-dialogue-agent.ts's systemPrompt for the
  // Claude-generated side of the same complaint.
  const isRetry = clarificationAttemptCount >= 2;
  // "boolean" 검증 프롬프트는 type(explanation/instruction/...)이나 필드명
  // 정규식(/Situation|Thought|Emotion|.../ 등, 아래 체인 참고)과 무관하게
  // 항상 예/아니오 재질문을 받아야 한다. isPassiveNode보다 먼저 평가해야
  // 하는 이유: PASSIVE_TYPE_REAL_ANSWER_VALIDATION_KINDS
  // (runtime-release-normalizer.ts)가 이미 "boolean"을 "passive 타입이어도
  // 진짜 답이 필요한 예외"로 규정하고 있음 -- isPassiveNode 분기의
  // "요약해드릴까요?" 문구(discomfort-distress-distinction 등에서 실제로
  // 발생한 버그)나 아래 필드명 정규식 체인의 우연한 오매치(예:
  // confirm-working-thought의 factualThoughtConfirmed가 /Thought/에 매치)는
  // boolean 필드에는 절대 맞지 않는다. enumValues와 동시에 존재하는 boolean
  // 프롬프트는 카탈로그(s01~s08) 전체에 없음을 확인했다.
  const adaptiveClarification = validation?.kind === "boolean"
    ? isRetry
      ? tr("A simple yes or no is enough.", "네 또는 아니요, 둘 중 하나면 충분해요.")
      : tr("Could you answer with a simple yes or no?", "네 또는 아니요로 간단히 답해 주시겠어요?")
    : isPassiveNode
    ? isRetry
      ? tr("Just let me know either way -- would you like a quick summary of what we've covered, or shall we keep going?", "\ud3b8\ud558\uac8c \ub2f5\ud574 \uc8fc\uc2dc\uba74 \ub3fc\uc694 -- \uc9c0\uae08\uae4c\uc9c0 \uc774\uc57c\uae30\ud55c \ub0b4\uc6a9\uc744 \uac04\ub2e8\ud788 \uc694\uc57d\ud574 \ub4dc\ub9b4\uae4c\uc694, \uc544\ub2c8\uba74 \uacc4\uc18d \uc9c4\ud589\ud560\uae4c\uc694?")
      : tr(
          "It sounds like you're ready to move on. Would you like me to summarize what we've covered so far?",
          "\ub2e4\uc74c\uc73c\ub85c \ub118\uc5b4\uac00\uace0 \uc2f6\uc73c\uc2e0 \uac83 \uac19\uc544\uc694. \uc9c0\uae08\uae4c\uc9c0 \uc774\uc57c\uae30\ud55c \ub0b4\uc6a9\uc744 \uc81c\uac00 \uc694\uc57d\ud574 \ub4dc\ub9b4\uae4c\uc694?",
        )
    : enumValues.length
      ? isRetry
        ? tr(`Just pick whichever fits best: ${enumValues.join(" or ")}.`, `\uac00\uc7a5 \uac00\uae4c\uc6b4 \uac83\uc73c\ub85c \uace8\ub77c \uc8fc\uc138\uc694: ${enumValues.join(" \ub610\ub294 ")}.`)
        : tr(`Please choose one of these options: ${enumValues.join(" or ")}.`, `\ub2e4\uc74c \uc911 \ud558\ub098\ub97c \uc120\ud0dd\ud574 \uc8fc\uc138\uc694: ${enumValues.join(" \ub610\ub294 ")}.`)
      : validation?.kind === "rating" || /Percent|Rating|Intensity/i.test(outputField)
        ? isRetry
          ? tr(`Any single number between ${Number(validation?.min ?? 0)} and ${Number(validation?.max ?? 100)} works -- just your best estimate.`, `${Number(validation?.min ?? 0)}\uc5d0\uc11c ${Number(validation?.max ?? 100)} \uc0ac\uc774\uc758 \uc22b\uc790\uba74 \ub3fc\uc694 -- \ub300\ub7b5\uc801\uc778 \ub290\ub08c\uc73c\ub85c \ub9d0\uc500\ud574 \uc8fc\uc154\ub3c4 \uad1c\ucc2e\uc544\uc694.`)
          : tr(`Please enter one number from ${Number(validation?.min ?? 0)} to ${Number(validation?.max ?? 100)}.`, `${Number(validation?.min ?? 0)}\uc5d0\uc11c ${Number(validation?.max ?? 100)} \uc0ac\uc774\uc758 \uc22b\uc790 \ud558\ub098\ub85c \ub2f5\ud574 \uc8fc\uc138\uc694.`)
        : /Situation/i.test(outputField)
          ? clarificationAttemptCount === 1
            ? tr("Could you describe one specific event: where you were, who was involved, and what happened?", "\uad6c\uccb4\uc801\uc73c\ub85c \uc5b4\ub5a4 \uc0c1\ud669\uc774\uc5c8\ub294\uc9c0 \ub9d0\uc500\ud574 \uc8fc\uc2dc\uaca0\uc5b4\uc694? \uc5b4\ub514\uc5d0 \uc788\uc5c8\uace0, \ub204\uad6c\uc640 \uc788\uc5c8\uace0, \ubb34\uc2a8 \uc77c\uc774 \uc788\uc5c8\ub098\uc694?")
            : tr("Please give one brief, concrete moment rather than a general feeling or thought.", "\ub290\ub08c\uc774\ub098 \uc0dd\uac01\uc774 \uc544\ub2c8\ub77c, \uc2e4\uc81c\ub85c \uc788\uc5c8\ub358 \uc9e7\uace0 \uad6c\uccb4\uc801\uc778 \uc21c\uac04 \ud558\ub098\ub97c \ub9d0\uc500\ud574 \uc8fc\uc138\uc694.")
          : /Thought|Belief/i.test(outputField)
            ? clarificationAttemptCount === 1
              ? tr("What exact words went through your mind at that moment?", "\uadf8 \uc21c\uac04 \uc815\ud655\ud788 \uc5b4\ub5a4 \ub9d0\uc774 \uba38\ub9bf\uc18d\uc5d0 \uc2a4\uccd0 \uc9c0\ub098\uac14\ub098\uc694?")
              : tr("If you put the thought into one short sentence, what would it say?", "\uadf8 \uc0dd\uac01\uc744 \ud55c \ubb38\uc7a5\uc73c\ub85c \ud45c\ud604\ud558\uba74 \uc5b4\ub5bb\uac8c \ub420\uae4c\uc694?")
            : /Emotion/i.test(outputField)
              ? isRetry
                ? tr("A single word for the feeling is enough -- anxious, sad, angry, ashamed, relieved, anything like that.", "\uac10\uc815\uc744 \ub098\ud0c0\ub0b4\ub294 \ub2e8\uc5b4 \ud558\ub098\uba74 \ucda9\ubd84\ud574\uc694 -- \ubd88\uc548, \uc2ac\ud514, \ud654, \uc218\uce58\uc2ec, \uc548\ub3c4\uac10 \uac19\uc740 \ub2e8\uc5b4\uc694.")
                : tr("Could you name one specific emotion you felt, such as anxiety, sadness, anger, shame, or relief?", "\uad6c\uccb4\uc801\uc73c\ub85c \uc5b4\ub5a4 \uac10\uc815\uc744 \ub290\ub07c\uc168\ub098\uc694? \uc608\ub97c \ub4e4\uba74 \ubd88\uc548, \uc2ac\ud514, \ud654, \uc218\uce58\uc2ec, \uc548\ub3c4\uac10 \uac19\uc740 \uac10\uc815\uc774 \uc788\uc5b4\uc694.")
              : /Behavior/i.test(outputField)
                ? isRetry
                  ? tr("Just the plain action -- what did you (or would they) actually do?", "\uc2e4\uc81c\ub85c \ud55c \ud589\ub3d9\ub9cc \ub9d0\uc500\ud574 \uc8fc\uc2dc\uba74 \ub3fc\uc694 -- \uc2e4\uc81c\ub85c \ubb34\uc5c7\uc744 \ud558\uc168\ub098\uc694?")
                  : tr("What did you actually do, or what would the person visibly do next?", "\uc2e4\uc81c\ub85c \uc5b4\ub5a4 \ud589\ub3d9\uc744 \ud558\uc168\ub098\uc694, \ub610\ub294 \uadf8 \uc0ac\ub78c\uc774 \ub2e4\uc74c\uc5d0 \uac89\uc73c\ub85c \uc5b4\ub5a4 \ud589\ub3d9\uc744 \ud560\uae4c\uc694?")
                : /Reaction/i.test(outputField)
                  ? isRetry
                    ? tr("Just a quick positive or negative is fine.", "\uae0d\uc815\uc801\uc778\uc9c0 \ubd80\uc815\uc801\uc778\uc9c0\ub9cc \uac04\ub2e8\ud788 \ub2f5\ud574 \uc8fc\uc154\ub3c4 \ub3fc\uc694.")
                    : tr("Would the other person's reaction be positive or negative?", "\uadf8 \uc0ac\ub78c\uc758 \ubc18\uc751\uc740 \uae0d\uc815\uc801\uc77c\uae4c\uc694, \ubd80\uc815\uc801\uc77c\uae4c\uc694?")
                  : /Body|Sensation/i.test(outputField)
                    ? isRetry
                      ? tr("Anything you noticed in your body at all -- even something small -- is fine to share.", "\ubab8\uc5d0\uc11c \ub290\uaef4\uc9c4 \uac70\ub77c\uba74 \ubb34\uc5c7\uc774\ub4e0 \uad1c\ucc2e\uc544\uc694 -- \uc544\uc8fc \uc791\uc740 \uac10\uac01\uc774\ub77c\ub3c4 \ub9d0\uc500\ud574 \uc8fc\uc138\uc694.")
                      : tr("What specific physical sensation did you notice in your body, such as a racing heart or shaky hands?", "\ubab8\uc5d0\uc11c \uad6c\uccb4\uc801\uc73c\ub85c \uc5b4\ub5a4 \uac10\uac01\uc744 \ub290\ub07c\uc168\ub098\uc694? \uc608\ub97c \ub4e4\uba74 \uc2ec\uc7a5\uc774 \ube68\ub9ac \ub6f0\uac70\ub098 \uc190\uc774 \ub5a8\ub9ac\ub294 \ub290\ub08c\uc774 \uc788\uc5b4\uc694.")
                    : isRetry
                      ? tr("Whatever comes to mind first is fine -- just one short, concrete example.", "\uac00\uc7a5 \uba3c\uc800 \ub5a0\uc624\ub974\ub294 \uac83\uc774\uba74 \ub3fc\uc694 -- \uc9e7\uace0 \uad6c\uccb4\uc801\uc778 \uc608 \ud558\ub098\ub9cc \ub9d0\uc500\ud574 \uc8fc\uc138\uc694.")
                      : tr("Could you answer with one brief, specific example that directly addresses the question?", "\uc9c8\ubb38\uc5d0 \ub9de\ub294 \uc9e7\uace0 \uad6c\uccb4\uc801\uc778 \uc608\ub97c \ud558\ub098 \ub4e4\uc5b4 \uc8fc\uc2dc\uaca0\uc5b4\uc694?");
  // sourceSpecificClarification (when this exact prompt has one, e.g. S08's
  // combined distressingSituation+automaticThought field) is a purpose-built,
  // field-aware re-ask -- it must win over the generic adaptiveClarification
  // fallback. Previously "insufficient_input" always chose adaptiveClarification
  // unconditionally, which only ever knows about outputFields[0]
  // ("distressingSituation") and can never ask about a SECOND still-missing
  // field ("automaticThought"). That silently made sourceSpecificClarification
  // dead code for the exact case it exists for: a participant who fully
  // answers the first field but never the second got asked to re-describe
  // the (already-recorded) situation forever, since the generic fallback has
  // no way to point at the field that's actually still missing.
  let content = input.reason === "patient_refusal" || input.reason === "safety_clarification"
    ? proposedContent
    : sourceSpecificClarification ?? (duplicatesRecentQuestion || input.reason === "insufficient_input" ? adaptiveClarification : proposedContent);
  let dialogueOutcome: Awaited<ReturnType<typeof resolveDialogueAgentMessage>> | null = null;
  // Safety and refusal clarifications stay fully deterministic, no
  // exceptions -- only "the participant's answer didn't satisfy this
  // prompt" (insufficient_input) routes through the dialogue agent, and
  // only for enabled sessions. This is exactly the "mechanically repeated
  // clarification" / "wrong construct" / "question not understood" case
  // the dialogue-agent spec targets; deliverClarificationTurn's own
  // deterministic `content` above is what ships if the agent call fails or
  // fails validation.
  if (input.reason === "insufficient_input" && isDialogueAgentEnabled(input.node.sessionId)) {
    dialogueOutcome = await resolveDialogueAgentMessage({
      session: input.session,
      node: input.node,
      sourcePromptItem: input.promptItem,
      runtimePromptItem: input.runtimePromptItem,
      lastParticipantMessage: input.patientMessage.content,
      recentMessages: input.recentMessages ?? [],
      clarificationAttemptCount,
      turnId: makeId("TURN"),
      deterministicFallbackText: content,
      // A clarification re-asks an already-active prompt after an
      // insufficient answer -- by definition never the first prompt of a
      // node or session (those only ever get the normal "ask" path in
      // runtime-orchestrator.ts).
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    content = dialogueOutcome.patientMessage;
  }
  const sessionStatus: RuntimeSessionStatus = input.reason === "patient_refusal" || clarificationAttemptCount >= MAX_CLARIFICATION_ATTEMPTS ? "paused" : "waiting_for_input";
  const assistantMessage: RuntimeMessage = {
    id: makeId("RMSG"),
    runtimeSessionId: input.session.id,
    role: "assistant",
    content,
    status: "validated",
    nodeId: input.node.id,
    promptItemId: input.promptItem.id,
    sourceEvidenceIds: [],
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    metadata: { turnId: makeId("TURN"), turnOutcome: "clarification", clarificationReason: input.reason, dialogueDecision: dialogueOutcome?.decision ?? undefined, dialogueFallbackUsed: dialogueOutcome?.usedFallback },
  };
  const outputValidation = deterministicValidation(content);
  await commitRuntimeAssistantTurn({
    sessionId: input.session.id,
    assistantMessage,
    providerEvent: {
      id: makeId("RPE"),
      runtimeSessionId: input.session.id,
      provider: dialogueOutcome && !dialogueOutcome.usedFallback ? dialogueOutcome.provider : "deterministic",
      model: dialogueOutcome && !dialogueOutcome.usedFallback ? (dialogueOutcome.model ?? "dialogue-agent") : "runtime-clarification",
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      inputSummary: `clarification:${input.reason}`,
      outputText: content,
      createdAt: new Date().toISOString(),
      dialogueResponseType: dialogueOutcome?.decision?.responseType,
      dialogueParticipantResponseState: dialogueOutcome?.decision?.participantResponseState,
      dialogueFallbackUsed: dialogueOutcome?.usedFallback,
    },
    validationEvent: {
      id: makeId("RVE"),
      runtimeSessionId: input.session.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      ...outputValidation,
      createdAt: new Date().toISOString(),
    },
    trace: createRuntimeExecutionTrace({
      runtimeSessionId: input.session.id,
      releaseId: input.release.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      roleId: input.runtimePromptItem.roleId,
      provider: "deterministic",
      model: "runtime-clarification",
      contractHash: `clarification:${input.session.id}:${input.promptItem.id}`,
      validation: outputValidation,
      fallbackUsed: false,
      transitionDecision: "clarification",
      stateChanges: { activeNodeId: input.node.id, activePromptItemId: input.promptItem.id, clarificationReason: input.reason },
      fidelityEvidence: {
        locale: input.session.locale,
        patientFacingText: content,
        activePromptMatches: true,
        patientInputPresent: true,
      },
    }),
    sessionPatch: {
      runtimeContext: {
        ...input.session.runtimeContext,
        lastPatientMessage: input.patientMessage.content,
        clarificationAttemptCount,
        lastClarificationReason: sessionStatus === "paused" ? "maximum_clarification_attempts" : input.reason,
      },
      currentNodeId: input.node.id,
      currentPromptItemId: input.promptItem.id,
      runtimeState: input.runtimeState,
      promptProgressionReason: "clarification_sent",
      status: sessionStatus,
    },
  });
  return { assistantMessage, sessionStatus };
}

// A patient asking mid-session to switch response language ("한국어로
// 해주세요") is not an answer to the active prompt at all, so it must never
// be routed through deliverClarificationTurn -- that would (a) grade it as a
// wrong answer to whatever the current field is, (b) burn one of
// MAX_CLARIFICATION_ATTEMPTS on a request that was never about the clinical
// content, and (c) never touch session.locale, so the reply language
// wouldn't actually change even after three "clarifications." This instead
// updates session.locale immediately, acknowledges the switch in the NEW
// language, and re-delivers the current question's own text (not a
// clarification re-ask) translated into that language -- all deterministic,
// no dialogue-agent/LLM round-trip needed for what is just a housekeeping
// request.
async function deliverLanguageSwitchTurn(input: {
  session: RuntimeSession;
  node: ClinicalStageNode;
  promptItem: PromptItem;
  runtimePromptItem: import("@/types/protocol-runtime").RuntimePromptItem;
  runtimeState: NonNullable<RuntimeSession["runtimeState"]>;
  patientMessage: RuntimeMessage;
  targetLocale: string;
}) {
  const isKorean = input.targetLocale.toLowerCase().startsWith("ko");
  const acknowledgment = isKorean ? "네, 지금부터 한국어로 진행할게요!" : "Sure, I'll continue in English from here!";
  const currentQuestionText = resolveBracketPlaceholders(
    resolvePromptLocaleText(input.runtimePromptItem.id, input.runtimePromptItem.fallbackPatientText, input.targetLocale),
    input.session.runtimeContext,
  );
  const content = `${acknowledgment}\n\n${currentQuestionText}`;
  const assistantMessage: RuntimeMessage = {
    id: makeId("RMSG"),
    runtimeSessionId: input.session.id,
    role: "assistant",
    content,
    status: "validated",
    nodeId: input.node.id,
    promptItemId: input.promptItem.id,
    sourceEvidenceIds: [],
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    metadata: { turnId: makeId("TURN"), turnOutcome: "clarification", clarificationReason: "language_switch" },
  };
  const outputValidation = deterministicValidation(content);
  await commitRuntimeAssistantTurn({
    sessionId: input.session.id,
    assistantMessage,
    providerEvent: {
      id: makeId("RPE"),
      runtimeSessionId: input.session.id,
      provider: "deterministic",
      model: "runtime-language-switch",
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      inputSummary: "clarification:language_switch",
      outputText: content,
      createdAt: new Date().toISOString(),
    },
    validationEvent: {
      id: makeId("RVE"),
      runtimeSessionId: input.session.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      ...outputValidation,
      createdAt: new Date().toISOString(),
    },
    trace: createRuntimeExecutionTrace({
      runtimeSessionId: input.session.id,
      releaseId: input.session.releaseId,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      roleId: input.runtimePromptItem.roleId,
      provider: "deterministic",
      model: "runtime-language-switch",
      contractHash: `language-switch:${input.session.id}:${input.promptItem.id}`,
      validation: outputValidation,
      fallbackUsed: false,
      transitionDecision: "clarification",
      stateChanges: { activeNodeId: input.node.id, activePromptItemId: input.promptItem.id, localeChangedTo: input.targetLocale },
      fidelityEvidence: {
        locale: input.targetLocale,
        patientFacingText: content,
        activePromptMatches: true,
        patientInputPresent: true,
      },
    }),
    sessionPatch: {
      locale: input.targetLocale,
      runtimeContext: {
        ...input.session.runtimeContext,
        lastPatientMessage: input.patientMessage.content,
        lastClarificationReason: "language_switch",
      },
      currentNodeId: input.node.id,
      currentPromptItemId: input.promptItem.id,
      runtimeState: input.runtimeState,
      promptProgressionReason: "clarification_sent",
      status: "waiting_for_input",
    },
  });
  return { assistantMessage, sessionStatus: "waiting_for_input" as RuntimeSessionStatus };
}

// P0-5: sessions where a genuine "I don't understand the question" or "why
// are you asking this?" request must be recognized and explained instead of
// silently stored as if it were the participant's clinical answer -- see
// deliverProcessClarificationTurn. Scoped to S01-S03 (this task's stated
// scope); every other session keeps its exact prior behavior (such a message
// falls through to the normal extraction/clarification pipeline unchanged).
const PROCESS_CLARIFICATION_SESSIONS = new Set(["tbct-s01", "tbct-s02", "tbct-s03"]);

// Deliberately narrow, like detectLanguageSwitchRequest above: only fires
// when the entire message is essentially just the clarification request, so
// a longer message that happens to start with a confused word but also
// carries real clinical content is never silently short-circuited out of
// the normal pipeline.
const PROCESS_CLARIFICATION_MAX_LENGTH = 60;

// CCPH/CCGH scale UX pass: "잘 모르겠어요" / "색깔이 무슨 뜻이에요?" / "4점이랑
// 5점이 뭐가 달라요?" said in answer to the scale-comprehension check must be
// treated as a request to re-explain the scale, not an invalid boolean
// answer -- but this uncertainty phrasing ("잘 모르겠어요") is deliberately
// NOT added to the general-purpose looksLikeMeaningClarificationRequest
// above: that function runs for every S01-S03 prompt, and "잘 모르겠어요" is
// often a genuine, acceptable uncertain clinical answer elsewhere (see
// FIELDS_ACCEPTING_UNCERTAINTY in runtime-context.ts). Scoped narrowly to
// the two scale-comprehension prompts instead, where it can only ever mean
// "I don't understand the scale."
const SCALE_COMPREHENSION_PROMPT_IDS = new Set(["tbct-s02-n04-p03-discomfort-distress-distinction"]);
function looksLikeScaleComprehensionUncertainty(normalized: string) {
  return /^(?:잘\s*)?모르겠어요\??$/.test(normalized) // "(잘) 모르겠어요"
    || /색(?:깔|상)?이?\s*무슨\s*(?:뜻|의미)/.test(normalized) // "색깔이 무슨 뜻이에요?"
    || /점(?:이|들이)?\s*무슨\s*(?:뜻|의미)/.test(normalized) // "점이 무슨 뜻이에요?"
    || /\d\s*점.{0,10}\d\s*점.{0,10}(?:달라|다른가요|차이)/.test(normalized); // "4점이랑 5점이 뭐가 달라요?"
}

function detectProcessClarificationRequest(sessionDefinitionId: string, rawText: string, activePromptId?: string): "rationale" | "meaning" | null {
  if (!PROCESS_CLARIFICATION_SESSIONS.has(sessionDefinitionId)) return null;
  const trimmed = rawText.trim();
  if (!trimmed || trimmed.length > PROCESS_CLARIFICATION_MAX_LENGTH) return null;
  const normalized = normalizeText(trimmed);
  if (looksLikeMetaQuestionAboutTheProcess(normalized)) return "rationale";
  if (looksLikeMeaningClarificationRequest(normalized)) return "meaning";
  if (activePromptId && SCALE_COMPREHENSION_PROMPT_IDS.has(activePromptId) && looksLikeScaleComprehensionUncertainty(normalized)) return "meaning";
  return null;
}

// P0-5: deterministic "explain this question more simply" text, keyed by the
// active prompt's own output field -- same construct-aware idea
// deliverClarificationTurn already uses for INCOMPLETE answers (Situation/
// Thought/Emotion/Behavior/Body), applied here to a different trigger: the
// participant said they don't understand the question at all ("뭘요?", "무슨
// 뜻이에요?"), not that their answer was insufficient. Falls back to the
// prompt's own already-approved text (still re-asks the SAME question, never
// a different one) when no field-specific simplification applies.
function simplifiedMeaningExplanation(input: { outputField: string; approvedPatientText: string; locale: string }) {
  const isKorean = input.locale.toLowerCase().startsWith("ko");
  const tr = (en: string, ko: string) => (isKorean ? ko : en);
  if (/problems?$/i.test(input.outputField)) {
    return tr(
      "I'm asking about something in your life right now that feels difficult or that you'd like to change. You don't need to name several at once -- just the first one that comes to mind is enough.",
      "지금 생활하면서 줄이거나 바꾸고 싶은 어려움을 말하는 거예요. 한 번에 여러 개 말씀하실 필요는 없고, 가장 먼저 떠오르는 것 하나부터 말씀해 주세요.",
    );
  }
  if (/goals?$/i.test(input.outputField)) {
    return tr(
      "I'm asking about something you'd like therapy to help you work toward. Just one thing that comes to mind is enough for now.",
      "치료를 통해 이루고 싶은 것에 대해 여쭤보는 거예요. 지금은 떠오르는 것 하나만 말씀해 주셔도 돼요.",
    );
  }
  if (/situation/i.test(input.outputField)) {
    return tr("I'm asking what actually happened -- a real moment, not a feeling or a thought.", "실제로 있었던 일을 여쭤보는 거예요 -- 감정이나 생각이 아니라, 실제 상황이요.");
  }
  if (/thought|belief/i.test(input.outputField)) {
    return tr("I'm asking what went through your mind at that moment -- the exact words or idea, not the feeling.", "그 순간 머릿속에 스쳐 지나간 생각을 여쭤보는 거예요 -- 감정이 아니라, 어떤 생각이었는지요.");
  }
  if (/emotion/i.test(input.outputField)) {
    return tr("I'm asking what you felt -- a feeling word, like anxious, sad, or angry.", "그때 느끼신 감정을 여쭤보는 거예요 -- 불안, 슬픔, 화 같은 감정 단어로요.");
  }
  if (/behavior/i.test(input.outputField)) {
    return tr("I'm asking what you actually did, or wanted to do, in that moment.", "그 순간 실제로 무엇을 하셨는지, 또는 하고 싶으셨는지를 여쭤보는 거예요.");
  }
  if (/body|sensation/i.test(input.outputField)) {
    return tr("I'm asking what you noticed physically in your body -- like a racing heart or a tight chest.", "몸에서 느껴진 신체적인 감각을 여쭤보는 거예요 -- 심장이 빨리 뛰거나 가슴이 답답한 것처럼요.");
  }
  return tr(`Let me put it more simply. ${input.approvedPatientText}`, `조금 더 쉽게 다시 말씀드릴게요. ${input.approvedPatientText}`);
}

function rationaleExplanation(input: { participantRationale?: string; locale: string }) {
  if (input.participantRationale) return input.participantRationale;
  return input.locale.toLowerCase().startsWith("ko")
    ? "지금 함께 진행하고 있는 과정에 필요한 내용을 확인하기 위해 여쭤보는 거예요."
    : "I'm asking this because it helps with the step we're working on together right now.";
}

// P0-5: a participant asking "뭘요?" / "무슨 뜻이에요?" / "왜 이걸 물어봐요?" is not
// answering the active clinical question -- before this existed, that text
// fell through to normal extraction and, for most fields (no validation.kind
// to reject it), was silently stored as if it WERE the participant's actual
// problem/situation/thought/emotion. Mirrors deliverLanguageSwitchTurn above:
// fully deterministic, keeps the SAME active PromptItem, and -- unlike
// deliverClarificationTurn -- never increments clarificationAttemptCount,
// since a clarification request is not a wrong or incomplete answer.
async function deliverProcessClarificationTurn(input: {
  session: RuntimeSession;
  node: ClinicalStageNode;
  promptItem: PromptItem;
  runtimePromptItem: import("@/types/protocol-runtime").RuntimePromptItem;
  runtimeState: NonNullable<RuntimeSession["runtimeState"]>;
  patientMessage: RuntimeMessage;
  kind: "rationale" | "meaning";
}) {
  // Prefer the session's own live static-message resolver (e.g. S02's
  // scale explanations, which depend on runtime fields like
  // problemScaleCardAvailable and are computed by static-messages/s02.ts,
  // not baked into the compiled RuntimePromptItem at release time) over the
  // compiled fallbackPatientText, which is a generic locale-fallback string
  // for any prompt whose wording is entirely dynamic. Falls back to the
  // compiled text for prompts that have no dynamic override, unchanged from
  // before.
  const currentQuestionText = resolveBracketPlaceholders(
    resolveStaticPatientMessage(input.promptItem, input.session.locale, input.session.runtimeContext)?.patientMessage
      ?? resolvePromptLocaleText(input.runtimePromptItem.id, input.runtimePromptItem.fallbackPatientText, input.session.locale),
    input.session.runtimeContext,
  );
  const outputField = input.promptItem.outputFields[0] ?? "";
  const explanation = input.kind === "rationale"
    ? rationaleExplanation({ participantRationale: input.node.participantRationale, locale: input.session.locale })
    : simplifiedMeaningExplanation({ outputField, approvedPatientText: currentQuestionText, locale: input.session.locale });
  // "meaning" already re-states the question in its own simplified wording
  // for most fields, so appending the original verbatim question again would
  // be redundant; "rationale" explains WHY and must still re-ask the actual
  // task, since a rationale alone answers a different thing than the
  // question itself.
  const content = input.kind === "rationale" ? `${explanation}\n\n${currentQuestionText}` : explanation;
  const assistantMessage: RuntimeMessage = {
    id: makeId("RMSG"),
    runtimeSessionId: input.session.id,
    role: "assistant",
    content,
    status: "validated",
    nodeId: input.node.id,
    promptItemId: input.promptItem.id,
    sourceEvidenceIds: [],
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    metadata: { turnId: makeId("TURN"), turnOutcome: "clarification", clarificationReason: `process_clarification_${input.kind}` },
  };
  const outputValidation = deterministicValidation(content);
  await commitRuntimeAssistantTurn({
    sessionId: input.session.id,
    assistantMessage,
    providerEvent: {
      id: makeId("RPE"),
      runtimeSessionId: input.session.id,
      provider: "deterministic",
      model: "runtime-process-clarification",
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      inputSummary: `clarification:process_clarification_${input.kind}`,
      outputText: content,
      createdAt: new Date().toISOString(),
    },
    validationEvent: {
      id: makeId("RVE"),
      runtimeSessionId: input.session.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      ...outputValidation,
      createdAt: new Date().toISOString(),
    },
    trace: createRuntimeExecutionTrace({
      runtimeSessionId: input.session.id,
      releaseId: input.session.releaseId,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      roleId: input.runtimePromptItem.roleId,
      provider: "deterministic",
      model: "runtime-process-clarification",
      contractHash: `process-clarification:${input.session.id}:${input.promptItem.id}`,
      validation: outputValidation,
      fallbackUsed: false,
      transitionDecision: "clarification",
      stateChanges: { activeNodeId: input.node.id, activePromptItemId: input.promptItem.id },
      fidelityEvidence: {
        locale: input.session.locale,
        patientFacingText: content,
        activePromptMatches: true,
        patientInputPresent: true,
      },
    }),
    sessionPatch: {
      runtimeContext: {
        ...input.session.runtimeContext,
        lastPatientMessage: input.patientMessage.content,
        lastClarificationReason: `process_clarification_${input.kind}`,
        // clarificationAttemptCount is deliberately NOT included/incremented
        // here (P0-5) -- a process-clarification request must never count
        // toward MAX_CLARIFICATION_ATTEMPTS or push the session toward pause.
      },
      currentNodeId: input.node.id,
      currentPromptItemId: input.promptItem.id,
      runtimeState: input.runtimeState,
      promptProgressionReason: "clarification_sent",
      status: "waiting_for_input",
    },
  });
  return { assistantMessage, sessionStatus: "waiting_for_input" as RuntimeSessionStatus };
}

// Reflect-and-Confirm (.claude/TASK_SCOPE.json note2026_09_11): the
// participant is answering the assistant's "did I get that right?" about its
// own summary -- not the active prompt, whose task the summary turn held
// back. Like deliverProcessClarificationTurn above, nothing here writes a
// field, moves runtimeState, or touches clarificationAttemptCount; the
// active prompt simply stays active.
//   - plain yes      -> the held-back task (the dialogue agent may phrase it,
//                       but may not summarize again on this turn)
//   - bare no        -> ask once which part felt different; the check stays open
//   - correction     -> a revised summary with the same confirmation question,
//                       up to MAX_SUMMARIES_PER_CHECK summaries per check
//   - anything else  -> leave the participant's own words exactly as recorded
//                       and ask the task
async function deliverReflectionCheckReplyTurn(input: {
  session: RuntimeSession;
  node: ClinicalStageNode;
  promptItem: PromptItem;
  runtimePromptItem: import("@/types/protocol-runtime").RuntimePromptItem;
  runtimeState: NonNullable<RuntimeSession["runtimeState"]>;
  patientMessage: RuntimeMessage;
  pendingCheck: PendingReflectionCheck;
  recentMessages: RuntimeMessage[];
  sessionToneGuidance?: string;
}) {
  const locale = input.session.locale;
  const currentTaskText = resolveBracketPlaceholders(
    resolveStaticPatientMessage(input.promptItem, locale, input.session.runtimeContext)?.patientMessage
      ?? resolvePromptLocaleText(input.runtimePromptItem.id, input.runtimePromptItem.fallbackPatientText, locale),
    input.session.runtimeContext,
  );
  const moveOnText = `${reflectionText(REFLECTION_MOVE_ON, locale)} ${currentTaskText}`;
  const reply = classifyReflectionCheckReply(input.patientMessage.content);
  const check = input.pendingCheck;
  const agentEnabled = isDialogueAgentEnabled(input.node.sessionId);
  const askDialogueAgent = (options: { deterministicFallbackText: string; summaryCheckAllowed: boolean; reflectionCheckContext?: { previousSummary: string; attempt: number } }) => resolveDialogueAgentMessage({
    session: input.session,
    node: input.node,
    sourcePromptItem: input.promptItem,
    runtimePromptItem: input.runtimePromptItem,
    lastParticipantMessage: input.patientMessage.content,
    recentMessages: input.recentMessages,
    clarificationAttemptCount: input.session.runtimeContext.clarificationAttemptCount ?? 0,
    turnId: makeId("TURN"),
    currentTaskTextOverride: currentTaskText,
    isFirstPromptOfNode: false,
    isFirstPromptOfSession: false,
    sessionToneGuidance: input.sessionToneGuidance,
    ...options,
  });
  const leaveAsParticipantWords: ReflectionCheckResolution = { checkId: check.checkId, outcome: "left_as_participant_words", summaries: check.attempt };
  let content = moveOnText;
  let dialogueOutcome: Awaited<ReturnType<typeof resolveDialogueAgentMessage>> | null = null;
  let nextCheck: PendingReflectionCheck | undefined;
  let resolution: ReflectionCheckResolution | undefined;
  if (reply === "affirm") {
    dialogueOutcome = agentEnabled ? await askDialogueAgent({ deterministicFallbackText: currentTaskText, summaryCheckAllowed: false }) : null;
    content = dialogueOutcome?.patientMessage ?? currentTaskText;
    resolution = { checkId: check.checkId, outcome: "confirmed", summaries: check.attempt };
  } else if (reply === "deny" && !check.askedWhatDiffers) {
    content = reflectionText(REFLECTION_ASK_WHAT_DIFFERS, locale);
    nextCheck = { ...check, askedWhatDiffers: true };
  } else if (reply === "correction" && check.attempt < MAX_SUMMARIES_PER_CHECK && agentEnabled) {
    dialogueOutcome = await askDialogueAgent({ deterministicFallbackText: moveOnText, summaryCheckAllowed: true, reflectionCheckContext: { previousSummary: check.summaryText, attempt: check.attempt } });
    // Anything other than an accepted revised summary (a fallback, or Claude
    // choosing a different response type) ends the check with the
    // participant's own words standing, rather than shipping a turn that
    // might neither re-confirm nor ask the task.
    if (dialogueOutcome.summaryCheck) {
      content = dialogueOutcome.patientMessage;
      nextCheck = { ...check, attempt: check.attempt + 1, summaryText: dialogueOutcome.summaryCheck.summaryText };
    } else {
      resolution = leaveAsParticipantWords;
    }
  } else {
    resolution = leaveAsParticipantWords;
  }
  const assistantMessage: RuntimeMessage = {
    id: makeId("RMSG"),
    runtimeSessionId: input.session.id,
    role: "assistant",
    content,
    status: "validated",
    nodeId: input.node.id,
    promptItemId: input.promptItem.id,
    sourceEvidenceIds: [],
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    metadata: { turnId: makeId("TURN"), turnOutcome: "reflection_check", reflectionReply: reply, reflectionCheck: nextCheck, reflectionCheckResolution: resolution, dialogueDecision: dialogueOutcome?.decision ?? undefined, dialogueFallbackUsed: dialogueOutcome?.usedFallback },
  };
  const outputValidation = deterministicValidation(content);
  const usedDialogueAgent = Boolean(dialogueOutcome && !dialogueOutcome.usedFallback && !dialogueOutcome.excludedBySafety);
  await commitRuntimeAssistantTurn({
    sessionId: input.session.id,
    assistantMessage,
    providerEvent: {
      id: makeId("RPE"),
      runtimeSessionId: input.session.id,
      provider: usedDialogueAgent && dialogueOutcome ? dialogueOutcome.provider : "deterministic",
      model: usedDialogueAgent && dialogueOutcome ? (dialogueOutcome.model ?? "dialogue-agent") : "runtime-reflection-check",
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      inputSummary: `reflection_check:${reply}`,
      outputText: content,
      createdAt: new Date().toISOString(),
      dialogueResponseType: dialogueOutcome?.decision?.responseType,
      dialogueParticipantResponseState: dialogueOutcome?.decision?.participantResponseState,
      dialogueFallbackUsed: dialogueOutcome?.usedFallback,
    },
    validationEvent: {
      id: makeId("RVE"),
      runtimeSessionId: input.session.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      ...outputValidation,
      createdAt: new Date().toISOString(),
    },
    trace: createRuntimeExecutionTrace({
      runtimeSessionId: input.session.id,
      releaseId: input.session.releaseId,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      roleId: input.runtimePromptItem.roleId,
      provider: "deterministic",
      model: "runtime-reflection-check",
      contractHash: `reflection-check:${input.session.id}:${input.promptItem.id}`,
      validation: outputValidation,
      fallbackUsed: false,
      transitionDecision: "clarification",
      stateChanges: { activeNodeId: input.node.id, activePromptItemId: input.promptItem.id },
      fidelityEvidence: {
        locale: input.session.locale,
        patientFacingText: content,
        activePromptMatches: true,
        patientInputPresent: true,
      },
    }),
    sessionPatch: {
      runtimeContext: {
        ...input.session.runtimeContext,
        lastPatientMessage: input.patientMessage.content,
      },
      currentNodeId: input.node.id,
      currentPromptItemId: input.promptItem.id,
      runtimeState: input.runtimeState,
      promptProgressionReason: "clarification_sent",
      status: "waiting_for_input",
    },
  });
  return { assistantMessage, sessionStatus: "waiting_for_input" as RuntimeSessionStatus, reply, resolution };
}

async function deliverSafetyOverrideTurn(input: {
  session: RuntimeSession;
  node: ClinicalStageNode;
  promptItem: PromptItem;
  runtimePromptItem: import("@/types/protocol-runtime").RuntimePromptItem;
  release: ProtocolReleaseVersion;
  runtimeState: NonNullable<RuntimeSession["runtimeState"]>;
  patientMessage: RuntimeMessage;
  safetyContext: RuntimeSession["runtimeContext"];
  safetyResult: import("@/types/runtime-session").SafetyOrchestrationResult;
}) {
  const content = input.safetyResult.fixedResponse;
  if (!content) throw new Error("Safety override requires an approved fixed response.");
  const nextStatus = input.safetyResult.escalationRequired ? "escalated" : "safety_paused";
  const assistantMessage: RuntimeMessage = {
    id: makeId("RMSG"),
    runtimeSessionId: input.session.id,
    role: "assistant",
    content,
    status: "delivered",
    nodeId: input.node.id,
    promptItemId: input.promptItem.id,
    sourceEvidenceIds: [],
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    metadata: { turnId: makeId("TURN"), turnOutcome: "safety_override", patientVisible: true, approvedSafetyRuleId: input.safetyResult.ruleIds[0] },
  };
  const validation = deterministicValidation(content);
  await commitRuntimeAssistantTurn({
    sessionId: input.session.id,
    assistantMessage,
    providerEvent: {
      id: makeId("RPE"),
      runtimeSessionId: input.session.id,
      provider: "deterministic",
      model: "approved-safety-response",
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      inputSummary: `safety:${input.safetyResult.ruleIds.join(",")}`,
      outputText: content,
      createdAt: new Date().toISOString(),
    },
    validationEvent: {
      id: makeId("RVE"),
      runtimeSessionId: input.session.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      ...validation,
      createdAt: new Date().toISOString(),
    },
    trace: createRuntimeExecutionTrace({
      runtimeSessionId: input.session.id,
      releaseId: input.release.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      roleId: input.runtimePromptItem.roleId,
      provider: "deterministic",
      model: "approved-safety-response",
      contractHash: `safety:${input.session.id}:${input.promptItem.id}`,
      validation,
      fallbackUsed: false,
      transitionDecision: "safety_override",
      stateChanges: {
        activeNodeId: input.node.id,
        activePromptItemId: input.promptItem.id,
        suspendedPromptItemId: input.promptItem.id,
        safetyRuleIds: input.safetyResult.ruleIds,
      },
      fidelityEvidence: {
        locale: input.session.locale,
        patientFacingText: content,
        activePromptMatches: true,
        patientInputPresent: true,
        safetyOverrideExpected: true,
        approvedSafetyLocaleException: !isPatientFacingLocaleConsistent(content, input.session.locale),
      },
    }),
    sessionPatch: {
      runtimeContext: {
        ...input.safetyContext,
        lastPatientMessage: input.patientMessage.content,
        riskLevel: input.safetyResult.severity === "high" ? "high" : "medium",
      },
      currentNodeId: input.node.id,
      currentPromptItemId: input.promptItem.id,
      runtimeState: input.runtimeState,
      promptProgressionReason: "safety_paused",
      status: nextStatus,
    },
  });
  return assistantMessage;
}

async function deliverRuntimePrompt(input: {
  session: RuntimeSession;
  node: ClinicalStageNode;
  promptItem: PromptItem;
  release: ProtocolReleaseVersion;
  recentMessages: RuntimeMessage[];
}) {
  const delivered = await executeRuntimeNodeMessage(input.session, input.node, input.promptItem, {
    release: input.release,
    recentMessages: input.recentMessages,
  });
  const reduction = delivered.stateReduction;
  const traceId = makeId("RTX");
  const clientTurnId = input.session.pendingTurnId;
  const patientMessage = clientTurnId
    ? [...input.recentMessages].reverse().find((message) => message.role === "patient" && message.metadata?.clientTurnId === clientTurnId)
    : undefined;
  const turnKind = patientMessage ? "patient_assistant" as const : "assistant_only" as const;
  const sessionVersionBefore = input.session.version ?? 0;
  const sessionVersionAfter = sessionVersionBefore + 1;
  const generatedMessage: RuntimeMessage = {
    ...delivered.generatedMessage,
    metadata: {
      ...delivered.generatedMessage.metadata,
      clientTurnId,
      patientMessageId: patientMessage?.id,
      assistantMessageId: delivered.generatedMessage.id,
      executionTraceId: traceId,
      sessionVersionBefore,
      sessionVersionAfter,
      turnOutcome: turnKind,
    },
  };
  const promptExecutionStatuses = {
    ...(input.session.promptExecutionStatuses ?? {}),
    ...Object.fromEntries(reduction.skippedPromptItemIds.map((id) => [id, "inactive_condition" as const])),
    [input.promptItem.id]: "executed" as const,
  };
  await commitRuntimeAssistantTurn({
    sessionId: input.session.id,
    assistantMessage: generatedMessage,
    providerEvent: {
      id: makeId("RPE"),
      runtimeSessionId: input.session.id,
      provider: delivered.providerResult.provider,
      model: delivered.providerResult.model ?? "unknown",
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      latencyMs: delivered.providerResult.latencyMs,
      inputSummary: delivered.contract.contractHash,
      outputText: generatedMessage.content,
      error: delivered.providerResult.error,
      createdAt: new Date().toISOString(),
      dialogueResponseType: (generatedMessage.metadata?.dialogueDecision as { responseType?: string } | undefined)?.responseType,
      dialogueParticipantResponseState: (generatedMessage.metadata?.dialogueDecision as { participantResponseState?: string } | undefined)?.participantResponseState,
      dialogueFallbackUsed: delivered.fallbackUsed,
    },
    validationEvent: {
      id: makeId("RVE"),
      runtimeSessionId: input.session.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      accepted: delivered.validator.accepted,
      corrected: delivered.validator.corrected,
      rejected: delivered.validator.rejected,
      issues: delivered.validator.issues,
      finalText: generatedMessage.content,
      fallbackRequired: delivered.validator.fallbackRequired,
      createdAt: new Date().toISOString(),
    },
    trace: createRuntimeExecutionTrace({
      id: traceId,
      runtimeSessionId: input.session.id,
      releaseId: input.release.id,
      nodeId: input.node.id,
      promptItemId: input.promptItem.id,
      roleId: delivered.contract.roleId,
      sessionId: delivered.contract.sessionId,
      sequenceIndex: delivered.contract.sequenceIndex,
      provider: delivered.providerResult.provider,
      model: delivered.providerResult.model,
      contractHash: delivered.contract.contractHash,
      validation: delivered.validator,
      fallbackUsed: delivered.fallbackUsed,
      transitionDecision: reduction.transitionDecision,
      modelRecommendedTransition: delivered.response.recommendedTransition,
      deterministicTransitionEvaluation: reduction.transitionDecision,
      committedTransition: reduction.transitionDecision,
      committedNextNodeId: reduction.state.activeNodeId,
      committedNextPromptItemId: reduction.state.activePromptItemId,
      turnAssociation: {
        kind: turnKind,
        clientTurnId,
        patientMessageId: patientMessage?.id,
        assistantMessageId: generatedMessage.id,
        executionTraceId: traceId,
        sessionVersionBefore,
        sessionVersionAfter,
      },
      promptExecutionStatuses,
      stateChanges: {
        activeNodeId: reduction.state.activeNodeId,
        activePromptItemId: reduction.state.activePromptItemId,
        completedPromptItemIds: reduction.state.completedPromptItemIds,
      },
      fidelityEvidence: {
        locale: input.session.locale,
        patientFacingText: generatedMessage.content,
        activePromptMatches: delivered.contract.nodeId === input.node.id && delivered.contract.promptItemId === input.promptItem.id,
        patientInputPresent: Boolean(patientMessage),
        turnKind,
        safetyOverrideExpected: input.session.runtimeContext.riskLevel !== "low" && input.session.runtimeContext.riskSignals.length > 0,
      },
    }),
    sessionPatch: {
      runtimeContext: input.session.runtimeContext,
      currentNodeId: reduction.state.activeNodeId,
      currentPromptItemId: reduction.state.activePromptItemId,
      completedPromptItemIds: reduction.state.completedPromptItemIds,
      skippedPromptItemIds: mergePromptItemIds(input.session.skippedPromptItemIds, reduction.skippedPromptItemIds),
      promptExecutionStatuses,
      runtimeState: reduction.state,
      promptProgressionReason: reduction.transitionDecision === "next_node" ? "node_completed" : reduction.transitionDecision === "next_prompt" ? "prompt_completed" : "prompt_delivered",
      status: reduction.transitionDecision === "waiting_for_input" ? "waiting_for_input" : "active",
    },
  });
  return { ...delivered, generatedMessage };
}

function normalizeInputValue(patientInput: PatientInput) {
  if (Array.isArray(patientInput.value)) {
    return patientInput.value.map((value) => String(value).trim().toLowerCase()).join("|");
  }
  return String(patientInput.value).trim().toLowerCase().replace(/\s+/g, " ");
}

function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `fp-${(hash >>> 0).toString(16)}`;
}

export function createSafetyInputFingerprint(input: {
  runtimeSessionId: string;
  sourceNodeId: string;
  safetyRuleId?: string;
  patientInput: PatientInput;
}) {
  const normalized = normalizeInputValue(input.patientInput);
  const raw = [input.patientInput.kind, normalized.length > 120 ? stableHash(normalized) : normalized, input.runtimeSessionId, input.sourceNodeId, input.safetyRuleId ?? "no-rule"].join("::");
  return stableHash(raw);
}

function createRiskSignalSignature(riskSignals: string[] | undefined) {
  return stableHash((riskSignals ?? []).map((item) => item.trim().toLowerCase()).sort().join("|"));
}

async function getActiveSafetyTriggerSuppressions(input: {
  runtimeSessionId: string;
  sourceNodeId: string;
  safetyRuleId?: string;
  inputFingerprint: string;
}) {
  await cleanupExpiredTriggerSuppressions();
  const match = await findActiveTriggerSuppression(input);
  return match ? [match] : [];
}

function evaluateSafetyTriggerSuppression(input: {
  suppression?: SafetyTriggerSuppression | null;
  executionSequence: number;
  safetyResult: Awaited<ReturnType<typeof runSafetyOrchestrator>>;
  riskSignalSignature: string;
  inputFingerprint: string;
}) {
  const suppression = input.suppression;
  if (!suppression) {
    return { suppressed: false, reason: "not_applicable" as const };
  }
  if (new Date(suppression.expiresAt).getTime() <= Date.now()) {
    return { suppressed: false, reason: "expired" as const };
  }
  if (suppression.inputFingerprint !== input.inputFingerprint) {
    return { suppressed: false, reason: "different_input" as const };
  }
  if ((suppression.safetyRuleId ?? undefined) !== (input.safetyResult.ruleIds[0] ?? undefined)) {
    return { suppressed: false, reason: "different_rule" as const };
  }
  if (suppression.executionSequence !== undefined && suppression.executionSequence !== input.executionSequence) {
    return { suppressed: false, reason: "not_applicable" as const };
  }
  if ((suppression.riskLevel ?? "low") !== (input.safetyResult.severity ?? "low")) {
    return { suppressed: false, reason: "new_risk_signal" as const };
  }
  if ((suppression.riskSignalSignature ?? "") !== input.riskSignalSignature) {
    return { suppressed: false, reason: "new_risk_signal" as const };
  }
  return { suppressed: true, suppressionId: suppression.id, reason: "exact_recent_trigger" as const };
}

async function consumeOrRecordSuppressionUse(suppression: SafetyTriggerSuppression) {
  await updateTriggerSuppression(suppression.id, {
    usageCount: (suppression.usageCount ?? 0) + 1,
    lastUsedAt: new Date().toISOString(),
  });
}

async function ensureSafetyOperationsRecord(input: {
  sessionId: string;
  session: RuntimeSession;
  currentNodeId: string;
  executionSequence: number;
  safetyResult: import("@/types/runtime-session").SafetyOrchestrationResult;
  patientMessageId: string;
  fixedResponseMessageId?: string;
}) {
  const open = await findOpenSafetyEventByTriggerKey({
    runtimeSessionId: input.sessionId,
    sourceNodeId: input.currentNodeId,
    safetyRuleId: input.safetyResult.ruleIds[0],
    executionSequence: input.executionSequence,
  });
  if (open) return open;
  return createSafetyEvent({
    projectId: input.session.projectId,
    participantId: input.session.participantId,
    runtimeSessionId: input.sessionId,
    protocolId: input.session.protocolId,
    protocolVersion: input.session.protocolVersion,
    sessionDefinitionId: input.session.sessionDefinitionId,
    source: "runtime_rule",
    sourceNodeId: input.currentNodeId,
    sourceMessageIds: [input.patientMessageId, ...(input.fixedResponseMessageId ? [input.fixedResponseMessageId] : [])],
    sourceExecutionLogIds: [],
    safetyRuleIds: input.safetyResult.ruleIds,
    executionSequence: input.executionSequence,
    linkedSafetyMemoryIds: [],
    severity: input.safetyResult.severity === "high" ? "high" : input.safetyResult.severity === "medium" ? "medium" : "low",
    urgency: input.safetyResult.severity === "high" ? "urgent" : "priority",
    triggerSummary: input.safetyResult.reason ?? "Safety trigger",
    patientFacingStatus: input.safetyResult.severity === "high" ? "waiting_for_review" : "session_paused",
    sessionHoldRequired: input.safetyResult.action !== "continue",
    sessionResumeAuthorized: false,
    followUpRequired: input.safetyResult.severity !== "low",
    followUpTaskIds: [],
  });
}

export async function startRuntimeSession(sessionId: string) {
  // Guards the created -> preparing transition atomically (SELECT ... FOR
  // UPDATE inside one transaction, same pattern as claimRuntimePatientTurn)
  // -- startRuntimeSession previously had no precondition check at all, so
  // two racing callers (patient-session-page.tsx's auto-start effect and a
  // still-visible, not-yet-disabled manual Start button; or a stray
  // auto-retry) could each read status "created" before either committed,
  // then each independently run the full entry-node execution chain,
  // generating two separate assistant messages for the session's first turn
  // (confirmed live: "the counselor's first message repeats twice"). Only
  // the caller that actually wins the claim proceeds; every other
  // concurrent caller returns early with the current, already-in-progress
  // view instead of re-running the chain.
  const claim = await claimRuntimeSessionStart(sessionId);
  if (!claim.claimed) return null;
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("Runtime session not found");
  const runtimeRelease = loadRuntimeRelease(view.release);
  const runtimeState = normalizeRuntimeSessionState(view.session, runtimeRelease);
  const entryNode = view.nodes.find((node) => node.id === runtimeState.activeNodeId);
  if (!entryNode) throw new Error("Runtime session entry node is missing");
  await updateRuntimeSessionRecord(sessionId, {
    currentNodeId: runtimeState.activeNodeId,
    currentPromptItemId: runtimeState.activePromptItemId,
    runtimeState,
    status: "active",
  });
  void saveRuntimeLog(makeLog(sessionId, "session", "completed", "Session started", { nodeId: runtimeState.activeNodeId })).catch(() => {});
  await createRuntimeCheckpoint(sessionId);
  return executeCurrentNode(sessionId);
}

export async function pauseRuntimeSession(sessionId: string, reason: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("Runtime session not found");
  if (!["active", "waiting_for_input"].includes(view.session.status)) throw new Error("Pause is not allowed in the current state");
  await setRuntimeSessionStatus(sessionId, "paused", { pausedAt: new Date().toISOString() });
  void saveRuntimeLog(makeLog(sessionId, "session", "completed", `Session paused: ${reason}`)).catch(() => {});
  return createRuntimeCheckpoint(sessionId);
}

export async function resumeRuntimeSession(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("Runtime session not found");
  if (view.session.status !== "paused") throw new Error("Resume is not allowed in the current state");
  await setRuntimeSessionStatus(sessionId, "active", {
    resumedAt: new Date().toISOString(),
    // A pause reached via MAX_CLARIFICATION_ATTEMPTS left
    // clarificationAttemptCount sitting at 3+ -- without resetting it here,
    // Resume would only ever grant ONE more attempt before immediately
    // re-pausing on the very next clarification (3+1 >= 3 again), no
    // matter how complete the participant's next answer actually is. A
    // resume is meant to give a genuinely fresh attempt budget, same as
    // any prompt being encountered for the first time.
    runtimeContext: { ...view.session.runtimeContext, clarificationAttemptCount: 0, lastClarificationReason: undefined },
  });
  void saveRuntimeLog(makeLog(sessionId, "session", "completed", "Session resumed")).catch(() => {});
  return executeCurrentNode(sessionId);
}

// executeCurrentNode recurses through a chain of passive (no-patient-input)
// nodes within a single call, persisting status:"active" after each one
// (see the recursive `return executeCurrentNode(sessionId)` calls above) --
// if a later step in that same chain throws (a transient failure delivering
// one node's message, a flaky write, etc.), the whole call aborts but the
// record is left holding whatever status the last *successful* sub-step
// wrote. Nothing else in the app ever revisits that session: the patient
// page has no polling and no case for status "active" beyond an inert
// "being prepared" message, so the session is stuck forever with no
// recovery path. Confirmed live in production (a real session sat at
// status "active", with a real half-delivered node, for 10+ minutes with
// zero change). This just re-invokes the same deterministic executeCurrentNode
// -- safe to call repeatedly, since each node's own delivery is already
// guarded by an `alreadyDelivered` check against existing messages.
export async function retryStalledRuntimeNode(sessionId: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("Runtime session not found");
  if (!["active", "processing"].includes(view.session.status)) {
    throw new Error("Retry is not allowed in the current state");
  }
  void saveRuntimeLog(makeLog(sessionId, "session", "completed", "Session retried after a stalled node")).catch(() => {});
  return executeCurrentNode(sessionId);
}

export async function terminateRuntimeSession(sessionId: string, reason: string) {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error("Runtime session not found");
  if (["completed", "terminated"].includes(view.session.status)) throw new Error("Session cannot be terminated");
  assertRuntimeTransition(view.session.status, "terminated");
  await updateRuntimeSessionRecord(sessionId, { status: "terminated", terminatedAt: new Date().toISOString() });
  void saveRuntimeLog(makeLog(sessionId, "session", "completed", `Session terminated: ${reason}`)).catch(() => {});
  return createRuntimeCheckpoint(sessionId);
}

export async function completeRuntimeSession(sessionId: string) {
  await updateRuntimeSessionRecord(sessionId, { status: "completed", completedAt: new Date().toISOString() });
  void saveRuntimeLog(makeLog(sessionId, "completion", "completed", "Session completed")).catch(() => {});
  const checkpoint = await createRuntimeCheckpoint(sessionId);
  const summary = await generateSessionSummary(sessionId);
  await extractMemoryCandidates(summary.id);
  return checkpoint;
}

export async function executeCurrentNode(sessionId: string, prefetchedView?: RuntimeSessionView): Promise<RuntimeCycleResult> {
  const view = prefetchedView ?? await getRuntimeSessionForTurn(sessionId);
  if (!view) throw new Error("Runtime session not found");
  const session = view.session;
  const runtimeRelease = loadRuntimeRelease(view.release);
  const runtimeState = normalizeRuntimeSessionState(session, runtimeRelease);
  const activeStep = resolveActiveRuntimeStep(runtimeRelease, runtimeState);
  if (!activeStep) {
    const terminalNode = view.nodes.find((item) => item.id === runtimeState.activeNodeId);
    if (terminalNode?.type === "session_complete") {
      await completeRuntimeSession(sessionId);
      return {
        sessionId,
        previousNodeId: session.previousNodeId,
        currentNodeId: terminalNode.id,
        safetyResult: { triggered: false, ruleIds: [], action: "continue", escalationRequired: false },
        fallbackUsed: false,
        sessionStatus: "completed",
        logIds: [],
      };
    }
    const runtimeNode = runtimeRelease.nodes.find((item) => item.id === runtimeState.activeNodeId);
    const transition = runtimeNode?.transitionRules
      .slice()
      .sort((left, right) => left.priority - right.priority)
      .find((rule) => evaluateRuntimeCondition(rule.condition, runtimeState));
    const nextNode = transition && runtimeRelease.nodes.find((item) => item.id === transition.targetNodeId);
    if (runtimeNode && nextNode) {
      const skippedPromptItemIds = mergePromptItemIds(session.skippedPromptItemIds, runtimeNode.promptSequence);
      const nextState = {
        ...runtimeState,
        activeNodeId: nextNode.id,
        activePromptItemId: nextNode.promptSequence[0],
        activePromptIndex: 0,
        completedNodeIds: mergePromptItemIds(runtimeState.completedNodeIds, [runtimeNode.id]),
        completedPromptItemIds: mergePromptItemIds(runtimeState.completedPromptItemIds, runtimeNode.promptSequence),
      };
      await updateRuntimeSessionRecord(sessionId, { currentNodeId: nextNode.id, currentPromptItemId: nextState.activePromptItemId, skippedPromptItemIds, runtimeState: nextState, promptProgressionReason: "prompt_skipped", status: "active" });
      return executeCurrentNode(sessionId);
    }
    await updateRuntimeSessionRecord(sessionId, { status: "failed" });
    throw new Error("Runtime session has no active deterministic step.");
  }
  const node = view.nodes.find((item) => item.id === activeStep.node.id);
  if (!node) throw new Error("Current node is missing");
  const activePromptItem = view.promptItems.find((item) => item.id === activeStep.promptItem.sourcePromptItemId);
  if (!activePromptItem) throw new Error("Current source PromptItem is missing");
  const retrieval = await runMemoryRetrieval({
    participantId: session.participantId,
    runtimeSessionId: session.id,
    protocolId: session.protocolId,
    protocolVersion: session.protocolVersion,
    sessionDefinitionId: session.sessionDefinitionId,
    currentNodeId: node.id,
    currentNodeType: node.type as import("@/types/protocol-runtime").ProtocolNodeType,
    currentClinicalIntent: node.clinicalPurpose ?? node.title,
    maxItems: 5,
  }).catch(() => null);
  const runtimeContext = retrieval ? injectLongitudinalMemory(session.runtimeContext, retrieval.selected) : session.runtimeContext;
  const skippedPromptItemIds = mergePromptItemIds(session.skippedPromptItemIds, activeStep.skippedPromptItemIds);
  const activeSession = { ...session, runtimeContext, skippedPromptItemIds };
  void saveRuntimeLog(makeLog(sessionId, "node_resolution", "completed", `Current node resolved: ${node.title}`, { nodeId: node.id })).catch(() => {});
  const promptItem = activePromptItem;
  if (promptItem) {
    if (activeStep.promptItem.requiresPatientInput) {
      // A repeat_until prompt (e.g. "rate the next item", "collect one more
      // piece of evidence") is meant to be delivered again on every
      // iteration. Without this exemption, "already has one assistant
      // message on file" would skip re-delivery on the second+ iteration,
      // which also skips the commit path that clears the turn claim --
      // leaving the session unable to accept the patient's next answer.
      const alreadyDelivered = activeStep.promptItem.executionMode !== "repeat_until"
        && view.messages.some((message) => message.promptItemId === promptItem.id && message.role === "assistant");
      const delivered = !alreadyDelivered
        ? await deliverRuntimePrompt({ session: activeSession, node, promptItem, release: view.release, recentMessages: view.messages })
        : undefined;
      if (!alreadyDelivered && !delivered) {
        throw new Error("Assistant delivery did not create a runtime message.");
      }
      await updateRuntimeSessionRecord(sessionId, {
        runtimeContext,
        currentNodeId: node.id,
        currentPromptItemId: promptItem.id,
        skippedPromptItemIds,
        runtimeState: delivered?.stateReduction.state ?? session.runtimeState,
        promptProgressionReason: activeStep.skippedPromptItemIds.length ? "prompt_skipped" : "prompt_delivered",
        status: "waiting_for_input",
      });
      await createRuntimeCheckpoint(sessionId);
      return {
        sessionId,
        currentNodeId: node.id,
        currentPromptItemId: promptItem.id,
        safetyResult: { triggered: false, ruleIds: [], action: "continue", escalationRequired: false },
        fallbackUsed: false,
        sessionStatus: "waiting_for_input",
        logIds: [],
      };
    }

    const delivered = view.messages.some((message) => message.promptItemId === promptItem.id && message.role === "assistant")
      ? undefined
      : await deliverRuntimePrompt({ session: activeSession, node, promptItem, release: view.release, recentMessages: view.messages });
    const nextRuntimeState = delivered?.stateReduction.state ?? runtimeState;
    const completedPromptItemIds = nextRuntimeState.completedPromptItemIds;
    const nextContext = applyPromptCompletionEffect(runtimeContext, promptItem, activeSession.locale);
    const completionEffectType = getPromptCompletionEffectType(promptItem);
    if (completionEffectType === "pause_session") {
      await updateRuntimeSessionRecord(sessionId, {
        runtimeContext: nextContext,
        currentNodeId: nextRuntimeState.activeNodeId,
        currentPromptItemId: nextRuntimeState.activePromptItemId,
        completedPromptItemIds,
        skippedPromptItemIds,
        runtimeState: nextRuntimeState,
        promptProgressionReason: "prompt_completed",
        status: "paused",
      });
      await createRuntimeCheckpoint(sessionId);
      return {
        sessionId,
        currentNodeId: node.id,
        currentPromptItemId: promptItem.id,
        safetyResult: { triggered: false, ruleIds: [], action: "pause_session", escalationRequired: false },
        generatedMessage: delivered?.generatedMessage,
        outputValidation: delivered?.validator,
        fallbackUsed: delivered?.fallbackUsed ?? false,
        sessionStatus: "paused",
        logIds: [],
      };
    }
    if (delivered?.stateReduction.transitionDecision === "complete_session") {
      await updateRuntimeSessionRecord(sessionId, {
        runtimeContext: nextContext,
        currentNodeId: nextRuntimeState.activeNodeId,
        currentPromptItemId: nextRuntimeState.activePromptItemId,
        completedPromptItemIds,
        skippedPromptItemIds,
        runtimeState: nextRuntimeState,
        promptProgressionReason: "node_completed",
        status: "active",
      });
      await completeRuntimeSession(sessionId);
      return {
        sessionId,
        currentNodeId: node.id,
        currentPromptItemId: promptItem.id,
        safetyResult: { triggered: false, ruleIds: [], action: "continue", escalationRequired: false },
        generatedMessage: delivered?.generatedMessage,
        outputValidation: delivered?.validator,
        fallbackUsed: delivered?.fallbackUsed ?? false,
        sessionStatus: "completed",
        logIds: [],
      };
    }
    await updateRuntimeSessionRecord(sessionId, {
      runtimeContext: nextContext,
      currentNodeId: nextRuntimeState.activeNodeId,
      currentPromptItemId: nextRuntimeState.activePromptItemId,
      completedPromptItemIds,
      skippedPromptItemIds,
      runtimeState: nextRuntimeState,
      promptProgressionReason: delivered?.stateReduction.transitionDecision === "next_node" ? "node_completed" : "prompt_completed",
      status: "active",
    });
    if (completionEffectType === "complete_session") {
      await completeRuntimeSession(sessionId);
      return {
        sessionId,
        currentNodeId: node.id,
        currentPromptItemId: promptItem.id,
        safetyResult: { triggered: false, ruleIds: [], action: "continue", escalationRequired: false },
        generatedMessage: delivered?.generatedMessage,
        outputValidation: delivered?.validator,
        fallbackUsed: delivered?.fallbackUsed ?? false,
        sessionStatus: "completed",
        logIds: [],
      };
    }
    // No checkpoint here, deliberately -- this is an intermediate step of a
    // passive-node auto-chain (an explanation/transition node that needed no
    // patient input), not a real resting point. createRuntimeCheckpoint is 3
    // sequential DB round trips (src/shared/api/runtime-session-api.ts:308-329),
    // and it used to run once per chained node -- a chain of N passive nodes
    // paid for N checkpoints nobody could usefully restore to (a clinician's
    // restoreRuntimeSession always resumes the LATEST checkpoint, so a
    // mid-chain snapshot of a no-patient-input node was never a meaningfully
    // different rollback target than the one right after this turn's actual
    // patient answer, already captured before this recursion began -- see
    // the createRuntimeCheckpoint call in submitPatientInput). The real
    // resting points -- requiresPatientInput above, pause_session above, and
    // completeRuntimeSession (which checkpoints itself) -- are unaffected.
    return executeCurrentNode(sessionId);
  }

  throw new Error("Runtime session resolved no active source PromptItem.");
}

export async function submitPatientInput(sessionId: string, patientInput: PatientInput, options: { clientTurnId?: string; expectedSessionVersion?: number; locale?: string } = {}): Promise<RuntimeCycleResult> {
  // Collapse the browser's many sequential store/model round trips into one
  // authenticated server turn. The server invocation continues below.
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") return submitPatientInputOnServer(sessionId, patientInput, options);
  // Pure housekeeping (deletes rows past their expiry), unrelated to this
  // turn's own correctness -- getActiveSafetyTriggerSuppressions below
  // (only reached when safetyResult.triggered, i.e. rarely) already does
  // its own cleanupExpiredTriggerSuppressions() call immediately before
  // the read that actually needs a clean table, so this upfront call was
  // never what made a triggered turn's suppression check correct. It ran
  // on every single turn regardless, though -- fire-and-forget instead of
  // paying for it on the hot path every time.
  void cleanupExpiredTriggerSuppressions().catch(() => {});
  const initialView = await getRuntimeSessionForTurn(sessionId);
  if (!initialView) throw new Error("Runtime session not found");
  const initialSession = initialView.session;
  const turnLocale = options.locale ?? initialSession.locale;
  if (initialSession.status === "completed") throw new Error("Completed session does not accept input");
  if (initialSession.status === "processing") {
    return {
      sessionId,
      previousNodeId: initialSession.previousNodeId,
      currentNodeId: initialSession.currentNodeId ?? "unknown",
      currentPromptItemId: initialSession.currentPromptItemId,
      safetyResult: { triggered: false, ruleIds: [], action: "continue", escalationRequired: false },
      turnOutcome: "rejected_duplicate",
      fallbackUsed: false,
      sessionStatus: initialSession.status,
      logIds: [],
    };
  }
  if (initialSession.status !== "waiting_for_input") throw new Error("Session is not waiting for input");
  const runtimeRelease = loadRuntimeRelease(initialView.release);
  const runtimeState = normalizeRuntimeSessionState(initialSession, runtimeRelease);
  const activeStep = resolveActiveRuntimeStep(runtimeRelease, runtimeState);
  if (!activeStep) throw new Error("Runtime session has no active deterministic step.");
  const currentNode = initialView.nodes.find((node) => node.id === activeStep.node.id);
  if (!currentNode) throw new Error("Current node is missing");
  const currentPromptItem = initialView.promptItems.find((promptItem) => promptItem.id === activeStep.promptItem.sourcePromptItemId);
  if (!currentPromptItem) throw new Error("Current source PromptItem is missing");
  if (!activeStep.promptItem.requiresPatientInput) throw new Error("Current PromptItem does not accept patient input");
  // Reflect-and-Confirm: when the last thing on screen is the assistant's
  // own summary ending in "did I get that right?", this reply answers that
  // -- see deliverReflectionCheckReplyTurn. Only a typed/spoken reply or a
  // yes/no can answer it (the patient view offers a free-text box while a
  // check is open -- runtime-session-api.ts); any other structured input
  // (a rating, a choice) is an answer to the held-back prompt itself and is
  // processed as usual.
  const pendingReflectionCheck = patientInput.kind === "text" || patientInput.kind === "boolean" ? findPendingReflectionCheck(initialView.messages) : undefined;
  const clientTurnId = options.clientTurnId ?? makeId("TURN");
  const patientMessage: RuntimeMessage = {
    id: makeId("RMSG"),
    runtimeSessionId: sessionId,
    role: "patient",
    content: describePatientInputForDisplay(patientInput, turnLocale),
    status: "delivered",
    nodeId: currentNode.id,
    promptItemId: currentPromptItem.id,
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    metadata: { inputKind: patientInput.kind, promptItemId: currentPromptItem.id, clientTurnId },
  };
  const extracted = await extractRuntimeState({ patientInput, currentNode, currentPromptItem, currentContext: initialSession.runtimeContext, locale: turnLocale, pendingReflectionCheck: Boolean(pendingReflectionCheck) });
  // Worksheet projection is a best-effort read-side mirror of the canonical
  // extracted fields (src/shared/worksheet/worksheet-projection.ts) -- never
  // allowed to FAIL a real turn (errors are swallowed below), but it IS
  // awaited: this used to be fire-and-forget, which raced the client's own
  // post-turn cache invalidation (see patient-session-page.tsx's refresh())
  // -- the turn's HTTP response could come back and trigger a worksheet
  // refetch before this write had actually landed, so a long conversation
  // would visibly lag behind what the patient just said. Awaiting it here
  // (still a cheap, local write) means "the turn finished" now reliably
  // means "the worksheet projection for it is already there to refetch."
  void projectRuntimeFieldsToWorksheet({ runtimeSessionId: sessionId, sessionDefinitionId: initialSession.sessionDefinitionId, fields: extracted.fields, sourceTurnId: patientMessage.id }).catch(() => {});
  const safetyContext = {
    ...initialSession.runtimeContext,
    riskLevel: extracted.riskLevel,
    riskSignals: extracted.riskSignals,
    lastPatientMessage: patientMessage.content,
  };
  const safetyResult = await runSafetyOrchestrator({ currentNode, extractedState: extracted, runtimeContext: safetyContext });
  const skippedPromptItemIds = mergePromptItemIds(initialSession.skippedPromptItemIds, activeStep.skippedPromptItemIds);
  const claim = await claimRuntimePatientTurn({
    sessionId,
    clientTurnId,
    expectedSessionVersion: options.expectedSessionVersion ?? initialSession.version ?? 0,
    patientMessage,
    turnPatch: { locale: turnLocale, currentPromptItemId: currentPromptItem.id, skippedPromptItemIds },
  });
  if (!claim.claimed) {
    return {
      sessionId,
      previousNodeId: claim.session.previousNodeId,
      currentNodeId: claim.session.currentNodeId ?? "unknown",
      currentPromptItemId: claim.session.currentPromptItemId,
      safetyResult: { triggered: false, ruleIds: [], action: "continue", escalationRequired: false },
      turnOutcome: "rejected_duplicate",
      fallbackUsed: false,
      sessionStatus: claim.session.status,
      logIds: [],
    };
  }
  const view = initialView;
  const session = { ...claim.session, locale: turnLocale };
  if (claim.session.pendingTurnId !== clientTurnId) throw new Error("Patient turn claim was not retained");
  const executionSequence = session.executionLogIds.length + 1;
  // These three fire on every single patient turn and none of them feed
  // this function's return value (logIds is always [] -- nothing ever
  // reads these calls' results) -- awaiting them serially was three full
  // network round-trips of pure added latency on the hot path for a
  // diagnostic audit trail nothing downstream depends on. Fire-and-forget,
  // matching the safety-alert email dispatch pattern below: a slow/failed
  // log write must never delay or fail the patient's actual turn.
  void saveRuntimeLog(makeLog(sessionId, "input", "completed", "Patient input received", { nodeId: currentNode.id, input: { kind: patientInput.kind } })).catch(() => {});
  void saveRuntimeLog(makeLog(sessionId, "state_extraction", "completed", "State extracted", { nodeId: currentNode.id, output: extracted as unknown as Record<string, unknown> })).catch(() => {});
  void saveRuntimeLog(makeLog(sessionId, "safety_check", "completed", safetyResult.triggered ? `Safety triggered: ${safetyResult.action}` : "Safety check passed", { nodeId: currentNode.id, output: safetyResult as unknown as Record<string, unknown> })).catch(() => {});
  if (extracted.riskSignals.includes("ambiguous_safety_language") && !safetyResult.triggered) {
    const clarification = await deliverClarificationTurn({ session, node: currentNode, promptItem: currentPromptItem, runtimePromptItem: activeStep.promptItem, release: view.release, runtimeState, patientMessage, reason: "safety_clarification", missingFields: extracted.missingFields, recentAssistantMessages: view.messages.filter((message) => message.role === "assistant").map((message) => message.content) });
    void saveRuntimeLog(makeLog(sessionId, "safety_check", "completed", "Ambiguous safety language requires neutral clarification", { nodeId: currentNode.id, output: { signals: extracted.riskSignals } })).catch(() => {});
    void createRuntimeCheckpoint(sessionId).catch(() => {});
    return { sessionId, previousNodeId: session.previousNodeId, currentNodeId: currentNode.id, currentPromptItemId: currentPromptItem.id, stateExtraction: extracted, safetyResult, generatedMessage: clarification.assistantMessage, turnOutcome: "clarification", fallbackUsed: false, sessionStatus: clarification.sessionStatus, logIds: [] };
  }
  const isSemanticRefusal = extracted.riskSignals.includes("patient_refusal_semantic");
  if ((isExplicitPatientRefusal(patientMessage.content) || isSemanticRefusal) && !safetyResult.triggered) {
    const refusal = await deliverClarificationTurn({
      session,
      node: currentNode,
      promptItem: currentPromptItem,
      runtimePromptItem: activeStep.promptItem,
      release: view.release,
      runtimeState,
      patientMessage,
      reason: "patient_refusal",
      recentAssistantMessages: view.messages.filter((message) => message.role === "assistant").map((message) => message.content),
    });
    void saveRuntimeLog(makeLog(sessionId, "input", "completed", "Patient declined to continue; session paused without protocol progression", { nodeId: currentNode.id })).catch(() => {});
    void createRuntimeCheckpoint(sessionId).catch(() => {});
    return { sessionId, previousNodeId: session.previousNodeId, currentNodeId: currentNode.id, currentPromptItemId: currentPromptItem.id, stateExtraction: extracted, safetyResult, generatedMessage: refusal.assistantMessage, turnOutcome: "clarification", fallbackUsed: false, sessionStatus: refusal.sessionStatus, logIds: [] };
  }
  // Checked before the normal missing-fields/clarification branch below --
  // otherwise a request like "한국어로 해주세요" gets graded as a wrong answer
  // to whatever the active clinical field is (it has no plausible connection
  // to e.g. "what automatic thought went through your mind"), burns a
  // clarification attempt, and never actually changes the reply language.
  // See language-switch-detector.ts for why this stays purely deterministic.
  const languageSwitchLocale = safetyResult.triggered ? null : detectLanguageSwitchRequest(patientMessage.content);
  if (languageSwitchLocale) {
    const languageSwitch = await deliverLanguageSwitchTurn({ session, node: currentNode, promptItem: currentPromptItem, runtimePromptItem: activeStep.promptItem, runtimeState, patientMessage, targetLocale: languageSwitchLocale });
    void saveRuntimeLog(makeLog(sessionId, "input", "completed", `Patient asked to switch response language to ${languageSwitchLocale}`, { nodeId: currentNode.id })).catch(() => {});
    void createRuntimeCheckpoint(sessionId).catch(() => {});
    return { sessionId, previousNodeId: session.previousNodeId, currentNodeId: currentNode.id, currentPromptItemId: currentPromptItem.id, stateExtraction: extracted, safetyResult, generatedMessage: languageSwitch.assistantMessage, turnOutcome: "clarification", fallbackUsed: false, sessionStatus: languageSwitch.sessionStatus, logIds: [] };
  }
  // Reflect-and-Confirm (.claude/TASK_SCOPE.json note2026_09_11): after the
  // safety/refusal/language branches above, which always keep precedence,
  // and before every branch that would grade this reply as an answer to the
  // active prompt -- it isn't one. extractRuntimeState already skipped field
  // extraction for it (pendingReflectionCheck), so a triggered safety result
  // still falls through to the safety route below unchanged.
  if (pendingReflectionCheck && !safetyResult.triggered) {
    const reflectionReply = await deliverReflectionCheckReplyTurn({
      session,
      node: currentNode,
      promptItem: currentPromptItem,
      runtimePromptItem: activeStep.promptItem,
      runtimeState,
      patientMessage,
      pendingCheck: pendingReflectionCheck,
      recentMessages: [...view.messages, patientMessage],
      sessionToneGuidance: runtimeRelease.policies.sessionPolicies?.[session.sessionDefinitionId]?.toneGuidance,
    });
    void saveRuntimeLog(makeLog(sessionId, "input", "completed", `Participant replied to a summary check (${reflectionReply.reply}${reflectionReply.resolution ? `, ${reflectionReply.resolution.outcome}` : ", still open"})`, { nodeId: currentNode.id })).catch(() => {});
    void createRuntimeCheckpoint(sessionId).catch(() => {});
    return { sessionId, previousNodeId: session.previousNodeId, currentNodeId: currentNode.id, currentPromptItemId: currentPromptItem.id, stateExtraction: extracted, safetyResult, generatedMessage: reflectionReply.assistantMessage, turnOutcome: "clarification", fallbackUsed: false, sessionStatus: reflectionReply.sessionStatus, logIds: [] };
  }
  // P0-5, checked before the normal missing-fields/clarification branch below
  // for the same reason as the language-switch check above: "뭘요?" / "왜
  // 이걸 물어봐요?" has no plausible connection to whatever the active clinical
  // field is asking, so grading it as a wrong/incomplete answer both burns a
  // clarification attempt toward MAX_CLARIFICATION_ATTEMPTS and -- for fields
  // with no validation.kind to reject it -- can silently store the literal
  // clarification request as if it were the participant's real answer.
  const processClarificationKind = safetyResult.triggered ? null : detectProcessClarificationRequest(session.sessionDefinitionId, patientMessage.content, currentPromptItem.id);
  if (processClarificationKind) {
    const processClarification = await deliverProcessClarificationTurn({ session, node: currentNode, promptItem: currentPromptItem, runtimePromptItem: activeStep.promptItem, runtimeState, patientMessage, kind: processClarificationKind });
    void saveRuntimeLog(makeLog(sessionId, "input", "completed", `Patient asked for a process clarification (${processClarificationKind})`, { nodeId: currentNode.id })).catch(() => {});
    void createRuntimeCheckpoint(sessionId).catch(() => {});
    return { sessionId, previousNodeId: session.previousNodeId, currentNodeId: currentNode.id, currentPromptItemId: currentPromptItem.id, stateExtraction: extracted, safetyResult, generatedMessage: processClarification.assistantMessage, turnOutcome: "clarification", fallbackUsed: false, sessionStatus: processClarification.sessionStatus, logIds: [] };
  }
  if (extracted.missingFields.length && !safetyResult.triggered) {
    const clarification = await deliverClarificationTurn({
      session,
      node: currentNode,
      promptItem: currentPromptItem,
      runtimePromptItem: activeStep.promptItem,
      release: view.release,
      runtimeState,
      patientMessage,
      reason: "insufficient_input",
      missingFields: extracted.missingFields,
      recentAssistantMessages: view.messages.filter((message) => message.role === "assistant").map((message) => message.content),
      recentMessages: view.messages,
    });
    void saveRuntimeLog(makeLog(sessionId, "error", "skipped", "Input validation failed", { nodeId: currentNode.id, output: { missingFields: extracted.missingFields } })).catch(() => {});
    // No protocol state advanced, so a clarification checkpoint only adds
    // three foreground store round-trips while the patient waits.
    void createRuntimeCheckpoint(sessionId).catch(() => {});
    return {
      sessionId,
      previousNodeId: session.previousNodeId,
      currentNodeId: currentNode.id,
      currentPromptItemId: currentPromptItem.id,
      stateExtraction: extracted,
      safetyResult,
      generatedMessage: clarification.assistantMessage,
      turnOutcome: "clarification",
      fallbackUsed: false,
      sessionStatus: clarification.sessionStatus,
      logIds: [],
    };
  }
  if (safetyResult.triggered) {
    const inputFingerprint = createSafetyInputFingerprint({
      runtimeSessionId: sessionId,
      sourceNodeId: currentNode.id,
      safetyRuleId: safetyResult.ruleIds[0],
      patientInput,
    });
    const riskSignalSignature = createRiskSignalSignature(safetyResult.ruleIds);
    const [activeSuppression] = await getActiveSafetyTriggerSuppressions({
      runtimeSessionId: sessionId,
      sourceNodeId: currentNode.id,
      safetyRuleId: safetyResult.ruleIds[0],
      inputFingerprint,
    });
    const suppressionDecision = evaluateSafetyTriggerSuppression({
      suppression: activeSuppression,
      executionSequence,
      safetyResult,
      riskSignalSignature,
      inputFingerprint,
    });
    const safetyMessage = await deliverSafetyOverrideTurn({
      session,
      node: currentNode,
      promptItem: currentPromptItem,
      runtimePromptItem: activeStep.promptItem,
      release: view.release,
      runtimeState,
      patientMessage,
      safetyContext,
      safetyResult,
    });
    const safetyEvent = suppressionDecision.suppressed && activeSuppression
      ? await findOpenSafetyEventByTriggerKey({
        runtimeSessionId: sessionId,
        sourceNodeId: currentNode.id,
        safetyRuleId: safetyResult.ruleIds[0],
        executionSequence: activeSuppression.executionSequence ?? executionSequence,
      })
      : await ensureSafetyOperationsRecord({
        sessionId,
        session,
        currentNodeId: currentNode.id,
        executionSequence,
        safetyResult,
        patientMessageId: patientMessage.id,
        fixedResponseMessageId: safetyMessage.id,
      });
    if (suppressionDecision.suppressed && activeSuppression) {
      await consumeOrRecordSuppressionUse(activeSuppression);
      void saveRuntimeLog(makeLog(sessionId, "safety_check", "completed", "Safety trigger suppression reused existing event", {
        nodeId: currentNode.id,
        output: {
          suppressionId: activeSuppression.id,
          reason: suppressionDecision.reason,
          reusedSafetyEventId: safetyEvent?.id,
        },
      })).catch(() => {});
    }
    if (!safetyEvent) {
      throw new Error("Suppressed safety trigger could not resolve an existing safety event");
    }
    if (safetyResult.escalationRequired) {
      const escalation = await saveRuntimeEscalation({
        id: makeId("ESC"),
        runtimeSessionId: sessionId,
        protocolId: session.protocolId,
        protocolVersion: session.protocolVersion,
        sessionDefinitionId: session.sessionDefinitionId,
        nodeId: currentNode.id,
        safetyRuleId: safetyResult.ruleIds[0],
        linkedSafetyEventId: safetyEvent.id,
        executionSequence,
        severity: safetyResult.severity === "high" ? "high" : "medium",
        triggerSummary: safetyResult.reason ?? "Safety escalation triggered",
        status: "created",
        createdAt: new Date().toISOString(),
      });
      await updateRuntimeSessionRecord(sessionId, { status: "escalated", escalationIds: [...session.escalationIds, escalation.id] });
      await patchSafetyEvent(safetyEvent.id, { linkedEscalationId: escalation.id }, "Linked escalation to safety event");
      void saveRuntimeLog(makeLog(sessionId, "escalation", "completed", "Clinician escalation created", { nodeId: currentNode.id })).catch(() => {});
      if (escalation.severity === "high") {
        // Fire-and-forget, and deliberately routed through a real server
        // route (not a direct sendSafetyAlertEmail import): this module runs
        // entirely in the browser (imported only by "use client" pages), so
        // RESEND_API_KEY/SUPABASE_SERVICE_ROLE_KEY would never be available
        // here -- see src/app/api/notifications/safety-alert/route.ts's own
        // doc comment. Never awaited; a slow/failed dispatch must never
        // delay or fail the patient's turn.
        void getRuntimeParticipant(session.participantId)
          .then((participant) =>
            fetch("/api/notifications/safety-alert", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                participantId: session.participantId,
                participantAlias: participant?.alias ?? session.participantId,
                severity: "high",
                triggerSummary: escalation.triggerSummary,
                assignedClinicianUserId: participant?.assignedClinician,
                locale: session.locale,
              }),
            }),
          )
          .catch((error) => console.error("[runtime-execution-api] failed to dispatch safety alert email", error));
      }
      await createRuntimeCheckpoint(sessionId);
      return {
        sessionId,
        previousNodeId: session.previousNodeId,
        currentNodeId: currentNode.id,
        stateExtraction: extracted,
        safetyResult,
        safetyTriggerSuppressed: suppressionDecision.suppressed,
        suppressionId: suppressionDecision.suppressionId,
        suppressionReason: suppressionDecision.reason,
        reusedSafetyEventId: suppressionDecision.suppressed ? safetyEvent.id : undefined,
        generatedMessage: safetyMessage,
        turnOutcome: "safety_override",
        fallbackUsed: false,
        sessionStatus: "escalated",
        logIds: [],
      };
    }
    await placeSessionOnSafetyHold(sessionId, safetyEvent.id, "Runtime safety trigger requested hold");
    await createRuntimeCheckpoint(sessionId);
    return {
      sessionId,
      previousNodeId: session.previousNodeId,
      currentNodeId: currentNode.id,
      stateExtraction: extracted,
      safetyResult,
      safetyTriggerSuppressed: suppressionDecision.suppressed,
      suppressionId: suppressionDecision.suppressionId,
      suppressionReason: suppressionDecision.reason,
      reusedSafetyEventId: suppressionDecision.suppressed ? safetyEvent.id : undefined,
      generatedMessage: safetyMessage,
      turnOutcome: "safety_override",
      fallbackUsed: false,
      sessionStatus: "safety_paused",
      logIds: [],
    };
  }
  const nextContext = { ...mergeExtractedRuntimeContext(session.runtimeContext, extracted), lastPatientMessage: patientMessage.content, clarificationAttemptCount: 0, lastClarificationReason: undefined };
  const reduction = reduceRuntimeState({
    release: runtimeRelease,
    currentState: runtimeState,
    activeStep,
    // Phase 3: a participant-driven state correction (e.g. rating-loop item
    // removal) is a distinct reducer event from a genuine accepted answer --
    // see reduceRuntimeState's own doc comment for why this must never
    // consume a repeat_until prompt's iteration budget.
    event: extracted.inputDisposition === "state_corrected" ? "patient_state_corrected" : "patient_input_accepted",
    confirmedFields: extracted.fields,
  });
  const completedPromptItemIds = reduction.state.completedPromptItemIds;
  const reducedSkippedPromptItemIds = mergePromptItemIds(skippedPromptItemIds, reduction.skippedPromptItemIds);
  const contextAfterCompletion = applyPromptCompletionEffect(nextContext, currentPromptItem, initialSession.locale);
  const completionEffectType = getPromptCompletionEffectType(currentPromptItem);
  if (completionEffectType === "pause_session") {
    await updateRuntimeSessionRecord(sessionId, {
      runtimeContext: contextAfterCompletion,
      currentNodeId: reduction.state.activeNodeId,
      currentPromptItemId: reduction.state.activePromptItemId,
      completedPromptItemIds,
      skippedPromptItemIds: reducedSkippedPromptItemIds,
      runtimeState: reduction.state,
      promptProgressionReason: "prompt_completed",
      status: "paused",
    });
    await createRuntimeCheckpoint(sessionId);
    return {
      sessionId,
      previousNodeId: session.previousNodeId,
      currentNodeId: currentNode.id,
      currentPromptItemId: currentPromptItem.id,
      stateExtraction: extracted,
      safetyResult,
      fallbackUsed: false,
      sessionStatus: "paused",
      logIds: [],
    };
  }
  const progressedSession = await updateRuntimeSessionRecord(sessionId, {
    runtimeContext: contextAfterCompletion,
    currentNodeId: reduction.state.activeNodeId,
    currentPromptItemId: reduction.state.activePromptItemId,
    completedPromptItemIds,
    skippedPromptItemIds: reducedSkippedPromptItemIds,
    runtimeState: reduction.state,
    promptProgressionReason: reduction.transitionDecision === "next_node" ? "node_completed" : "prompt_completed",
    status: "active",
  });
  if (completionEffectType === "complete_session") {
    await completeRuntimeSession(sessionId);
    return {
      sessionId,
      previousNodeId: session.previousNodeId,
      currentNodeId: currentNode.id,
      currentPromptItemId: currentPromptItem.id,
      stateExtraction: extracted,
      safetyResult,
      fallbackUsed: false,
      sessionStatus: "completed",
      logIds: [],
    };
  }
  if (reduction.transitionDecision === "complete_session") {
    await completeRuntimeSession(sessionId);
    return {
      sessionId,
      previousNodeId: session.previousNodeId,
      currentNodeId: currentNode.id,
      currentPromptItemId: currentPromptItem.id,
      stateExtraction: extracted,
      safetyResult,
      fallbackUsed: false,
      sessionStatus: "completed",
      logIds: [],
    };
  }
  // Everything executeCurrentNode needs is already in memory. Reusing it
  // removes another session + release + messages fetch wave from every turn.
  const cycle = await executeCurrentNode(sessionId, {
    ...view,
    session: progressedSession,
    messages: view.messages.some((message) => message.id === patientMessage.id) ? view.messages : [...view.messages, patientMessage],
  });
  void createRuntimeCheckpoint(sessionId).catch(() => {});
  return {
    ...cycle,
    previousNodeId: currentNode.id,
    currentPromptItemId: currentPromptItem.id,
    nextPromptItemId: cycle.currentPromptItemId,
    stateExtraction: extracted,
    safetyResult,
    turnOutcome: cycle.fallbackUsed ? "fallback" : "normal",
  };
}
