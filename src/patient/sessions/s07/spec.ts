import { sourceText } from "@/lib/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/lib/protocol/source-fidelity-catalog";

const metadata: SessionSourceMetadata = {
  number: 7,
  id: "tbct-s07",
  title: "Consensual Role-Play (CRP)",
  titleKo: "합의된 역할극 (CRP)",
  techniqueName: "Consensual Role-Play (CRP)",
  acronym: "CRP",
  sourceLineStart: 1276,
  sourceLineEnd: 1536,
  sourceSessionHash: "acba4ae74192dc898936ec6a7fb3d927577e5f7eefddb564a116aef967fb3e2b",
  contextRange: [1289, 1317],
  roleRange: [1289, 1317],
  languageRange: [1319, 1351],
  openingRange: [1475, 1479],
  requiredActionsRange: [1370, 1477],
  restrictionsRange: [1478, 1536],
  safetyRange: [1496, 1536],
  reviewRanges: [
    {
      range: [1328, 1351],
      warning: "The supplied multilingual glossary contains visible encoding/transcription corruption. Preserve it verbatim and require source-owner review.",
    },
    {
      range: [1491, 1536],
      warning: "The supplied failure-mode excerpt contains visible encoding/transcription corruption. Preserve it verbatim and require source-owner review.",
    },
  ],
};

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "opening-consent",
      title: "Session Opening and Consent",
      titleKo: "세션 시작 및 동의",
      type: "session_start",
      source: [1475, 1479],
      requiredFields: ["crpConsent", "crpWorksheetReady"],
      safetyRuleIds: ["TBCT-S07-CRISIS-STOP"],
      restrictions: [sourceText([1475, 1479])],
      prompts: [
        // Both prompts used to write `crpConsent`: the free-text offer stored
        // whatever the participant said, and the boolean confirmation one turn
        // later silently overwrote it. The offer keeps its own field so consent
        // has a single writer (the explicit boolean) and the participant's own
        // words are not lost.
        { slug: "crp-offer", type: "opening", source: [1475, 1479], marker: "I'd like to propose", outputFields: ["crpOfferResponse"], validation: { kind: "informed_consent", noPressure: true } },
        { slug: "crp-consent", type: "confirmation", source: [1475, 1479], marker: "Would you like to try it", outputFields: ["crpConsent"], validation: { kind: "boolean" } },
        // The participant guide promises "The guide will check you have it
        // before you begin" of the CRP worksheet -- the session used to open
        // straight into Step 0 without ever mentioning it.
        { slug: "crp-worksheet-ready", type: "confirmation", source: [1475, 1479], outputFields: ["crpWorksheetReady"], validation: { kind: "boolean" } },
      ],
    },
    {
      slug: "language-and-principles",
      title: "Language Lock and Core Principles",
      titleKo: "언어 고정 및 핵심 원칙",
      type: "orientation",
      source: [1289, 1369],
      requiredFields: ["sessionLanguage", "languageLocked", "crpPrinciplesAcknowledged"],
      restrictions: [sourceText([1319, 1369])],
      prompts: [
        { slug: "language-lock", type: "instruction", source: [1319, 1326], outputFields: ["sessionLanguage", "languageLocked"], validation: { kind: "language_lock_from_first_substantive_message" } },
        { slug: "both-parts-healthy", type: "explanation", source: [1353, 1369], marker: "Reason and Emotion are two functions", outputFields: ["crpPrinciplesAcknowledged"] },
        { slug: "live-avoidance-notice", type: "clarification", source: [1353, 1369], marker: "I noticed you went quiet", activationCondition: { field: "liveAvoidanceObserved", operator: "equals", value: true }, outputFields: ["liveAvoidanceAcknowledged"] },
      ],
    },
    {
      slug: "step-zero-psychoeducation",
      title: "Step 0 - Psychoeducation",
      titleKo: "0단계 - 심리 교육",
      type: "orientation",
      source: [1370, 1379],
      requiredFields: ["ambivalenceAcknowledged"],
      prompts: [
        // "question", not "explanation": Step 0's psychoeducation invites a
        // reaction ("how does that land for you?") rather than moving on the
        // moment it is delivered -- an explanation-typed prompt completed on
        // delivery and never waited for one.
        { slug: "ambivalence-normalization", type: "question", source: [1370, 1379], outputFields: ["ambivalenceAcknowledged"] },
      ],
    },
    {
      slug: "decisional-balance",
      title: "Step 1 - Decisional Balance",
      titleKo: "1단계 - 의사 결정 저울",
      type: "question",
      source: [1380, 1391],
      requiredFields: ["desiredOrFearedAction", "disadvantages", "advantages"],
      restrictions: [sourceText([1380, 1391])],
      prompts: [
        { slug: "action-in-own-words", type: "question", source: [1380, 1391], outputFields: ["desiredOrFearedAction"], validation: { kind: "participant_owned_text" } },
        // Both lists are collected one item at a time up to the source's cap
        // of seven, ending early when the participant says there is nothing
        // more -- a single-turn question could only ever store one blob.
        {
          slug: "disadvantages-first",
          type: "question",
          source: [1380, 1391],
          marker: "What are the downsides",
          outputFields: ["disadvantages"],
          validation: { kind: "array", disadvantagesBeforeAdvantages: true, maxItems: 7 },
          executionMode: "repeat_until",
          maxIterations: 8,
          completionCondition: { kind: "field", field: "disadvantagesSufficient", operator: "equals", value: true },
        },
        {
          slug: "advantages-second",
          type: "question",
          source: [1380, 1391],
          marker: "What are the upsides",
          outputFields: ["advantages"],
          validation: { kind: "array", maxItems: 7, afterField: "disadvantages" },
          executionMode: "repeat_until",
          maxIterations: 8,
          completionCondition: { kind: "field", field: "advantagesSufficient", operator: "equals", value: true },
        },
      ],
    },
    {
      slug: "weigh-ambivalence",
      title: "Step 2 - Weigh Ambivalence",
      titleKo: "2단계 - 양가감정 저울질하기",
      type: "assessment",
      source: [1392, 1407],
      requiredFields: ["emotionDisadvantageWeight", "reasonAdvantageWeight", "ambivalenceSplitNamed"],
      restrictions: [sourceText([1392, 1407])],
      prompts: [
        { slug: "emotion-weight", type: "rating", source: [1392, 1407], marker: "Emotion", outputFields: ["emotionDisadvantageWeight"], validation: { kind: "rating", min: 0, max: 100, perspective: "emotion" } },
        { slug: "reason-weight", type: "rating", source: [1392, 1407], marker: "Reason", outputFields: ["reasonAdvantageWeight"], validation: { kind: "rating", min: 0, max: 100, perspective: "reason" } },
        // "The guide will name the split plainly as a conflict between, say,
        // 'your Reason' and 'your Emotion,' and then let it stand." Stating
        // it is the step's own clinical act -- the two numbers used to be
        // collected and then simply left unremarked. Composed from the two
        // recorded weights (static-messages/s07.ts) and delivered without
        // interpretation, so naming the split never becomes evaluating it.
        { slug: "name-the-split", type: "explanation", source: [1392, 1407], outputFields: ["ambivalenceSplitNamed"], validation: { kind: "state_split_without_interpretation" } },
      ],
    },
    {
      slug: "empty-chair-dialogue",
      title: "Step 3 - Empty-Chair Dialogue",
      titleKo: "3단계 - 빈 의자 대화",
      type: "dialogue",
      source: [1408, 1432],
      requiredFields: ["emotionReasonDialogue"],
      restrictions: [sourceText([1408, 1432])],
      prompts: [
        { slug: "chair-arrangement", type: "role_transition", source: [1408, 1432], outputFields: ["chairArrangementConfirmed"], validation: { kind: "role_arrangement_confirmed" } },
        { slug: "emotion-to-reason", type: "role_transition", source: [1408, 1432], marker: "Emotion, speak directly to Reason", outputFields: ["emotionReasonDialogue"], validation: { kind: "array", therapistSilence: true, maxItems: 8 } },
        {
          slug: "continue-dialogue",
          type: "follow_up",
          source: [1408, 1432],
          marker: "Is there more",
          outputFields: ["emotionReasonDialogue"],
          validation: { kind: "array", maxItems: 8 },
          // "Several exchanges is a floor, not a target. Do not close Step 3
          // early." The sufficiency rule (runtime-context.ts) keeps the
          // dialogue going to six utterances -- alternating the chairs via
          // the composed prompt text in static-messages/s07.ts -- and honors
          // "nothing more" only after at least three utterances, so one
          // premature stop earns a gentle invitation to stay instead of
          // closing the step.
          executionMode: "repeat_until",
          maxIterations: 7,
          completionCondition: { kind: "field", field: "emotionReasonDialogueSufficient", operator: "equals", value: true },
        },
      ],
    },
    {
      slug: "consensus-chair",
      title: "Step 4 - Consensus Chair",
      titleKo: "4단계 - 합의 의자",
      type: "dialogue",
      source: [1433, 1441],
      requiredFields: ["consensusLearning", "consensusSurprise", "consensusEmotionIntent", "consensusPartsNeeds"],
      prompts: [
        { slug: "consensus-transition", type: "role_transition", source: [1433, 1441], outputFields: ["consensusChairReady"], validation: { kind: "role_transition_confirmed" } },
        // The source asks for at least two learnings; a single-turn question
        // accepted one answer and moved on.
        {
          slug: "consensus-learning",
          type: "question",
          source: [1433, 1441],
          marker: "What did you learn",
          outputFields: ["consensusLearning"],
          validation: { kind: "array", minItems: 2 },
          executionMode: "repeat_until",
          maxIterations: 4,
          completionCondition: { kind: "field", field: "consensusLearningSufficient", operator: "equals", value: true },
        },
        // Both Step 4 questions used to write `consensusLearning`, so the
        // answer to "what surprised you?" silently overwrote the answer to
        // "what did you learn?" -- two distinct debrief answers collapsed
        // into one stored value.
        { slug: "consensus-surprise", type: "question", source: [1433, 1441], marker: "What surprised you", outputFields: ["consensusSurprise"] },
        // The debrief asks about the CONVERSATION, not only its conclusion:
        // "What did Emotion turn out to be trying to do? What did each part
        // seem to need?" Both were missing, so the Consensus chair only ever
        // reported an outcome.
        { slug: "consensus-emotion-intent", type: "question", source: [1433, 1441], outputFields: ["consensusEmotionIntent"] },
        { slug: "consensus-parts-needs", type: "question", source: [1433, 1441], outputFields: ["consensusPartsNeeds"] },
      ],
    },
    {
      slug: "consensus-reweight",
      title: "Step 5 - Reassess Weights",
      titleKo: "5단계 - 무게 다시 평가하기",
      type: "assessment",
      source: [1442, 1449],
      requiredFields: ["consensusAdvantageWeight", "consensusDisadvantageWeight"],
      restrictions: [sourceText([1442, 1449])],
      prompts: [
        { slug: "consensus-weights", type: "rating", source: [1442, 1449], marker: "re-weigh advantages", outputFields: ["consensusAdvantageWeight", "consensusDisadvantageWeight"], validation: { kind: "consensus_weights", noEditorializing: true } },
      ],
    },
    {
      slug: "decision",
      title: "Step 6 - Decision",
      titleKo: "6단계 - 결정",
      type: "assessment",
      source: [1450, 1461],
      requiredFields: ["implementationReadiness", "colourCodedScopeAcknowledged"],
      restrictions: [sourceText([1450, 1461])],
      prompts: [
        // Step 6 records exactly two outcomes ("Yes, I'm ready" / "No, I'm not
        // ready"); the source's rule is that a conditional or undecided answer
        // is reflected back and never rounded UP to readiness, so "undecided"
        // is an alias of not_ready rather than a third value.
        { slug: "readiness-decision", type: "question", source: [1450, 1461], marker: "Are you ready to implement", outputFields: ["implementationReadiness"], validation: { kind: "enum", values: ["ready", "not_ready"], aliases: { ready: ["yes", "yes i am ready", "yes i'm ready", "i am ready", "i'm ready", "준비됨", "준비됐어요", "준비되었어요", "네 준비됐어요"], not_ready: ["no", "no i am not ready", "no i'm not ready", "i am not ready", "i'm not ready", "undecided", "not sure", "아직 준비 안 됨", "아직 준비 안 됐어요", "준비 안 됨", "준비 안 됐어요", "아직 결정 못함", "잘 모르겠어요"] }, notReadyIsValid: true, forbiddenValues: ["I will do it"] } },
        { slug: "prepare-later", type: "follow_up", source: [1450, 1461], marker: "Would you like to be ready later", activationCondition: { field: "implementationReadiness", operator: "equals", value: "not_ready" }, outputFields: ["laterReadinessPreparation"] },
        // Safety boundary carried over from the exposure work, stated just
        // before the plan is built: green items are the participant's to
        // practise alone; anything at the yellow or red end is done WITH
        // their therapist, never alone. CRP produces the decision and the
        // plan -- not permission to attempt a distressing item unaccompanied
        // -- and nothing in this session used to say so.
        { slug: "green-only-scope", type: "explanation", source: [1450, 1461], outputFields: ["colourCodedScopeAcknowledged"] },
      ],
    },
    {
      slug: "action-plan",
      title: "Step 7 - Action Plan",
      titleKo: "7단계 - 실천 계획",
      type: "activity",
      source: [1462, 1477],
      requiredFields: ["proposedActions", "possibleObstacles", "obstacleSolutions", "implementationPlan", "supportPeople", "followUpPlan"],
      restrictions: [sourceText([1462, 1477])],
      prompts: [
        // "question", not "worksheet_instruction": each of these six fields
        // is participant-owned and must actually be supplied by them.
        // worksheet_instruction is a passive type that completes as soon as
        // the assistant delivers it, so all six fields were structurally
        // guaranteed to stay empty regardless of what the patient typed.
        { slug: "proposed-actions", type: "question", source: [1462, 1477], outputFields: ["proposedActions"], validation: { kind: "action_plan_field", fieldIndex: 1, participantOwned: true } },
        { slug: "possible-obstacles", type: "question", source: [1462, 1477], outputFields: ["possibleObstacles"], validation: { kind: "action_plan_field", fieldIndex: 2, participantOwned: true } },
        { slug: "obstacle-solutions", type: "question", source: [1462, 1477], outputFields: ["obstacleSolutions"], validation: { kind: "action_plan_field", fieldIndex: 3, participantOwned: true } },
        { slug: "implementation-plan", type: "question", source: [1462, 1477], outputFields: ["implementationPlan"], validation: { kind: "action_plan_field", fieldIndex: 4, participantOwned: true } },
        { slug: "support-people", type: "question", source: [1462, 1477], outputFields: ["supportPeople"], validation: { kind: "action_plan_field", fieldIndex: 5, participantOwned: true } },
        { slug: "follow-up", type: "question", source: [1462, 1477], outputFields: ["followUpPlan"], validation: { kind: "action_plan_field", fieldIndex: 6, participantOwned: true, assistantMustNotSupply: true } },
      ],
    },
    {
      slug: "closing",
      title: "Closing and Failure-Mode Guardrails",
      titleKo: "마무리 및 유의 사항",
      type: "session_complete",
      source: [1478, 1536],
      safetyRuleIds: ["TBCT-S07-CRISIS-STOP"],
      restrictions: [sourceText([1478, 1536])],
      terminal: true,
      prompts: [
        { slug: "plan-summary", type: "closing", source: [1478, 1536], outputFields: ["crpPlanSummary"], validation: { kind: "plan_summary_without_praise_or_persuasion" }, completionEffect: { type: "complete_session" } },
      ],
    },
    {
      slug: "safety-pause",
      title: "Safety Pause and Support",
      titleKo: "안전을 위한 일시 중지 및 지원",
      type: "clinician_escalation",
      source: [1496, 1536],
      safetyRuleIds: ["TBCT-S07-CRISIS-STOP"],
      terminal: true,
      prompts: [
        { slug: "stop-crp", type: "instruction", source: [1496, 1536], outputFields: ["safetyEscalation"], completionEffect: { type: "pause_session" }, safetyRuleIds: ["TBCT-S07-CRISIS-STOP"] },
      ],
    },
  ],
  extraEdges: [
    { sourceSlug: "opening-consent", targetSlug: "safety-pause", edgeType: "safety", source: [1496, 1536], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 1 },
  ],
};
