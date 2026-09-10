import { sourceText } from "@/lib/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/lib/protocol/source-fidelity-catalog";

const metadata: SessionSourceMetadata = {
  number: 3,
  id: "tbct-s03",
  title: "Intrapersonal Thought Record (Intra-TR)",
  titleKo: "개인 내적 사고 기록 (Intra-TR)",
  techniqueName: "Intrapersonal Thought Record (Intra-TR)",
  acronym: "Intra-TR",
  sourceLineStart: 430,
  sourceLineEnd: 745,
  sourceSessionHash: "2a3686ef5660f60d28fa1a59783e03a3d29763faaf223ad9e0a08e50d5644745",
  contextRange: [471, 482],
  roleRange: [441, 454],
  languageRange: [441, 454],
  openingRange: [455, 470],
  requiredActionsRange: [483, 698],
  restrictionsRange: [699, 724],
  safetyRange: [455, 470],
};

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "safety-check",
      title: "Safety Protocol",
      titleKo: "안전 프로토콜",
      type: "session_start",
      source: [455, 470],
      requiredFields: ["safetyCheck"],
      safetyRuleIds: ["TBCT-S03-CRISIS-PAUSE"],
      restrictions: [sourceText([455, 470])],
      nextSlug: "intra-tr-introduction",
      prompts: [
        {
          // 세션로그 §9-3, §12-1 [P0 · 회귀]: mandatory safety check가
          // patientText 없이 marker에만 의존해 generic fallback으로
          // 대체되고 있었다 -- Arm 3(AI-only) 참가자에게는 이게 유일한
          // 초기 스크리닝이라 최우선으로 복원. validation/completionEffect는
          // 건드리지 않음.
          slug: "safety-check",
          type: "opening",
          source: [455, 470],
          marker: "Before we start, how are you doing today",
          patientText: "Before we start, how are you doing today? Is there anything urgent or distressing that you feel I should know about before we begin?",
          outputFields: ["safetyCheck"],
          validation: { kind: "safety_check" },
          completionEffect: { type: "evaluate_safety" },
          safetyRuleIds: ["TBCT-S03-CRISIS-PAUSE"],
        },
      ],
    },
    {
      slug: "intra-tr-introduction",
      title: "Introducing the Intra-TR",
      titleKo: "Intra-TR 소개",
      type: "orientation",
      source: [483, 494],
      requiredFields: ["intraTrIntroductionComplete"],
      // §6.16: session-wide "invite elaboration once, then accept" pattern
      // (STRUCTURAL RULES) applies throughout Q1-Q14, not just evidence
      // collection (§6.9) -- recorded here since this is the session's own
      // orientation node.
      restrictions: [sourceText([483, 494]), "If a patient gives a very brief answer, invite elaboration once (\"Can you tell me a little more about that?\"), then accept whatever they offer next without further pressing."],
      prompts: [
        // 세션로그 §12-2 [P0]: verbatim, system prompt에 그대로 있음.
        // P0-3 (same class of bug as S02's first-session-opening): this is a
        // one-way introduction with no question asked -- outputFields:
        // ["intraTrIntroductionComplete"] previously made it an
        // input-required prompt (generic outputFields.length > 0 fallback in
        // promptRequiresPatientInput), so a participant's "네" was rejected as
        // a non-answer. Record the field deterministically on delivery
        // instead of waiting on an answer that was never actually being
        // asked for -- intraTrIntroductionComplete is never branched on
        // elsewhere (grep-verified), only used as node-level requiredFields
        // metadata.
        { slug: "fourteen-question-introduction", type: "opening", source: [483, 494], marker: "Today we are going to work with something called", patientText: "Today we are going to work with something called the Intrapersonal Thought Record, or Intra-TR. It is a structured set of 14 questions that will help you examine a thought that is causing you distress. We'll go step by step together. There are no right or wrong answers — your honest responses are what matter most.", completionEffect: { type: "set_field", field: "intraTrIntroductionComplete", value: true } },
        { slug: "ccd-connection", type: "explanation", source: [483, 494], marker: "You may remember the diagram", patientText: "You may remember the diagram we worked on before, with the situation, automatic thought, emotion, and behavior. The Intra-TR uses exactly those same pieces, but takes you further — all the way to a new conclusion and a new way of feeling and acting.", outputFields: ["intraTrIntroductionComplete"] },
        // §6.3 [신규 B-12]: system prompt v4's session-start contract had no
        // corresponding prompt. Appended after the two orientation prompts
        // (no ID shift); verbatim text at §Appendix A-7.
        {
          slug: "redirection-contract",
          type: "confirmation",
          source: [483, 494],
          patientText: "I may redirect you sometimes to keep us on track — not because what you're saying isn't valuable, but to make sure we complete all fourteen questions together. Is that okay?",
          outputFields: ["redirectionContractAcknowledged"],
          validation: { kind: "boolean" },
        },
        // Manual fidelity fix (S03 improvement plan, P0): the participant
        // pre-reading manual (p.3, "What to have ready before you start")
        // states "The guide will check you have it before you begin" for
        // the Intra-TR worksheet -- no prompt asked this. Appended last in
        // this node (no ID shift for the three prompts above).
        {
          slug: "worksheet-readiness-check",
          type: "confirmation",
          source: [483, 494],
          patientText: "Before we begin, do you have your Intra-TR worksheet open or nearby? It has the fourteen questions printed out, in case it's useful to follow along.",
          outputFields: ["worksheetReady"],
          validation: { kind: "boolean" },
        },
      ],
    },
    {
      slug: "q1-situation",
      title: "Q1 - Situation",
      titleKo: "Q1 - 상황",
      type: "question",
      source: [501, 510],
      requiredFields: ["situation"],
      prompts: [
        {
          // §6.4: marker previously cut the sentence after "distress?",
          // dropping the "as if it were happening right now" clause that
          // asks for a specific, present-tense moment.
          slug: "describe-situation",
          type: "question",
          source: [501, 510],
          marker: "Can you describe a recent situation",
          patientText: "Can you describe a recent situation that has been causing you distress? Try to describe it as if it were happening right now — what is going on?",
          outputFields: ["situation"],
          validation: { kind: "text" },
        },
        { slug: "specific-moment", type: "clarification", source: [501, 510], marker: "Can you give me a specific moment", patientText: "Can you give me a specific moment — a place, a time, something that actually happened?", activationCondition: { field: "situationIsAbstract", operator: "equals", value: true }, outputFields: ["situation"] },
      ],
    },
    {
      slug: "q2-automatic-thought",
      title: "Q2a - Automatic Thought",
      titleKo: "Q2a - 자동적 사고",
      type: "question",
      source: [511, 528],
      requiredFields: ["automaticThought"],
      nextSlug: "q2b-at-belief",
      prompts: [
        { slug: "automatic-thought", type: "question", source: [511, 528], marker: "At that exact moment", patientText: "At that exact moment, what goes through your mind? What is the thought that pops up automatically?", outputFields: ["automaticThought"], validation: { kind: "text" } },
        { slug: "emotion-to-thought-redirect", type: "clarification", source: [511, 528], marker: "When you feel overwhelmed", patientText: "When you feel overwhelmed in that moment, what is the thought underneath it — what does your mind tell you is happening or is true?", activationCondition: { field: "automaticThoughtReportedAsFeeling", operator: "equals", value: true }, outputFields: ["automaticThought"] },
      ],
    },
    {
      slug: "factual-thought-meaning",
      title: "Q2a - Factual Automatic Thought Follow-up",
      titleKo: "Q2a - 사실 여부 확인",
      type: "condition",
      source: [511, 528],
      requiredFields: ["workingAutomaticThought", "factualThoughtConfirmed"],
      nextSlug: "q2b-at-belief",
      restrictions: [sourceText([511, 528])],
      prompts: [
        { slug: "factual-thought-meaning", type: "follow_up", source: [511, 528], marker: "I can see that is true", patientText: "I can see that is true. What is it about that thought that causes you the most distress? What does it mean to you — or what do you fear will happen as a result?", outputFields: ["workingAutomaticThought"] },
        { slug: "confirm-working-thought", type: "confirmation", source: [511, 528], marker: "So the thought we'll be working with", patientText: "So the thought we'll be working with is not just that [factual event] will happen, but that [underlying belief]. Does that feel right?", outputFields: ["factualThoughtConfirmed"], validation: { kind: "boolean" } },
      ],
    },
    {
      slug: "q2b-at-belief",
      title: "Q2b - Belief in the Automatic Thought",
      titleKo: "Q2b - 자동적 사고에 대한 믿음",
      type: "assessment",
      source: [529, 536],
      requiredFields: ["automaticThoughtBeliefPercent"],
      prompts: [
        // §6.5 [신규 B-5]: when the factual-AT branch (factual-thought-meaning
        // above) produced a workingAutomaticThought, this prompt's marker
        // alone doesn't say which thought is being rated. static-messages/
        // s03.ts now readbacks `workingAutomaticThought ?? automaticThought`
        // directly into this question, and offers the "believed it more at
        // the time than now" choice inline (see manual: "clarify... which
        // feels more alive and important to examine? Record the percentage
        // that corresponds to the version they choose") -- folded into the
        // same single prompt rather than a separate clarification step, so
        // the participant's own answer already reflects their choice with no
        // extra turn or field needed.
        { slug: "rate-at-belief", type: "rating", source: [529, 536], marker: "How much do you believe that thought", outputFields: ["automaticThoughtBeliefPercent"], validation: { kind: "rating", min: 0, max: 100 } },
      ],
    },
    {
      slug: "q3-emotion",
      title: "Q3 - Emotion and Intensity",
      titleKo: "Q3 - 감정과 강도",
      type: "assessment",
      source: [537, 550],
      requiredFields: ["primaryEmotion", "primaryEmotionIntensityPercent"],
      prompts: [
        { slug: "primary-emotion", type: "question", source: [537, 550], marker: "When you have that thought", patientText: "When you have that thought, what emotion do you feel?", outputFields: ["primaryEmotion"] },
        { slug: "strongest-emotion", type: "clarification", source: [537, 550], marker: "Which one feels strongest", patientText: "Which one feels strongest right now?", activationCondition: { field: "multipleEmotionsReported", operator: "equals", value: true }, outputFields: ["primaryEmotion"] },
        { slug: "emotion-intensity", type: "rating", source: [537, 550], marker: "How strong is that emotion", patientText: "How strong is that emotion, from 0 to 100%?", outputFields: ["primaryEmotionIntensityPercent"], validation: { kind: "rating", min: 0, max: 100 } },
      ],
    },
    {
      slug: "q4-behavior-body-summary",
      title: "Q4 - Behavior, Body, and Participant Summary",
      titleKo: "Q4 - 행동, 신체 반응, 참여자 요약",
      type: "assessment",
      source: [551, 572],
      requiredFields: ["behavior", "bodySensations", "participantSummary"],
      prompts: [
        { slug: "behavior", type: "question", source: [551, 572], marker: "What do you do when you have that thought", patientText: "What do you do when you have that thought and feel that emotion? What is your impulse — what do you actually do, or want to do?", outputFields: ["behavior"] },
        { slug: "body-sensations", type: "question", source: [551, 572], marker: "And what do you notice in your body", patientText: "And what do you notice in your body at that moment?", outputFields: ["bodySensations"] },
        {
          // §6.6 [종결 C-6]: A안 확정 -- four elements verbatim (situation,
          // thought, emotion, body); behavior is covered by cycle-note
          // immediately after, not duplicated here. See §Appendix A-8.
          slug: "participant-summary",
          type: "summary",
          source: [551, 572],
          marker: "Before we continue, could you summarize",
          patientText: "Before we continue, could you summarize in your own words what we've covered so far — the situation, the thought, the emotion, and what happens in your body?",
          outputFields: ["participantSummary"],
          validation: { kind: "participant_summary_required" },
        },
        // Manual fidelity fix (S03 improvement plan, P2): the manual (p.2-3)
        // says the guide "leads mostly by asking, not lecturing," but this
        // reflection was a flat interpretive statement with no question.
        // Added one question in the middle -- everything else unchanged.
        { slug: "cycle-note", type: "reflection", source: [551, 572], marker: "You can see how this pattern", patientText: "You can see how this pattern tends to maintain itself — the thought feeds the emotion, the emotion drives the behavior, and the behavior reinforces the thought. Does that match what you're noticing, or does something feel different? Now let's examine it more closely.", outputFields: ["cycleSummaryAcknowledged"] },
      ],
    },
    {
      slug: "q5-q7-behavior-and-distortion",
      title: "Q5-Q7 - Behavior Pros, Cons, and Cognitive Distortion",
      titleKo: "Q5-Q7 - 행동의 장단점과 인지 왜곡",
      type: "question",
      source: [573, 596],
      requiredFields: ["behaviorPros", "behaviorCons", "cognitiveDistortion"],
      prompts: [
        {
          // §6.7 [교체 C-3]: the rationale for asking this ("even a small
          // sense of relief counts") is IN the source question itself --
          // marker previously cut the sentence there. Restoring the full
          // sentence (원칙 P) rather than adding a new explanatory sentence
          // in front of it.
          slug: "behavior-pros",
          type: "question",
          source: [573, 596],
          marker: "Are there any advantages or benefits",
          patientText: "Are there any advantages or benefits to behaving that way — even temporarily? Even a small sense of relief counts.",
          outputFields: ["behaviorPros"],
        },
        {
          slug: "behavior-pros-follow-up",
          type: "follow_up",
          source: [573, 596],
          marker: "We tend to do things for a reason",
          patientText: "We tend to do things for a reason, even if it doesn't serve us well in the long run. Is there any momentary comfort or relief in it?",
          activationCondition: { field: "behaviorProsDenied", operator: "equals", value: true },
          outputFields: ["behaviorPros"],
        },
        { slug: "behavior-cons", type: "question", source: [573, 596], marker: "And what are the disadvantages", patientText: "And what are the disadvantages or costs of behaving that way?", outputFields: ["behaviorCons"] },
        // §6.8 [신규 B-6]: cognitiveDistortion has no validation.kind (free
        // text) and requiredFields only checks presence, so a "none" /
        // "not sure" answer already satisfies completion today -- no
        // structural change needed here, just confirming that reading in
        // code (verified against runtime-context.ts's required-field
        // presence check before writing this).
        { slug: "cognitive-distortion", type: "question", source: [573, 596], marker: "Looking at your automatic thought", patientText: "Looking at your automatic thought — referring to the list of cognitive distortions you have — which distortion does this thought seem to represent?", outputFields: ["cognitiveDistortion"] },
      ],
    },
    {
      slug: "q8-q9-evidence",
      title: "Q8-Q9 - Evidence Examination",
      titleKo: "Q8-Q9 - 근거 검토",
      type: "question",
      source: [597, 616],
      requiredFields: ["evidenceFor", "evidenceAgainst"],
      restrictions: [sourceText([597, 616])],
      prompts: [
        {
          // §6.9 [교체 C-4]: minItems:2 contradicted the source's own pair
          // of requirements -- "at least one prompt for more" AND "if the
          // patient genuinely cannot find more after one prompt, accept
          // that and move on." minItems:2 only implemented the first half
          // and blocked completion forever on a genuine single-evidence
          // answer. evidence-for-more's own single-condition activation
          // (evidenceForCount < 2) already asks exactly once more -- once
          // this prompt fires and completes (even with the same single
          // item, or a "none" answer), it is marked completed and never
          // re-asked (see runtime-step-resolver.ts's completedPromptItemIds
          // tracking), so no extra "already asked once" flag is needed to
          // prevent a repeat loop.
          slug: "evidence-for",
          type: "question",
          source: [597, 616],
          marker: "Is there any evidence that supports",
          patientText: "Is there any evidence that supports this automatic thought — things that seem to confirm it is true? Try to think of two or three examples if you can.",
          outputFields: ["evidenceFor"],
          validation: { kind: "array", minItems: 1, maxItems: 3, promptOnceIfSingle: true },
        },
        { slug: "evidence-for-more", type: "follow_up", source: [597, 616], marker: "Can you think of one or two more", patientText: "Can you think of one or two more — what is one specific example that comes to mind?", activationCondition: { field: "evidenceForCount", operator: "less_than", value: 2 }, outputFields: ["evidenceFor"] },
        {
          // §6.9 -- same fix as evidence-for above.
          slug: "evidence-against",
          type: "question",
          source: [597, 616],
          marker: "Now, on the other side",
          patientText: "Now, on the other side — is there any evidence that does NOT support this thought? Anything that suggests the thought might not be entirely true? Again, try to think of two or three things.",
          outputFields: ["evidenceAgainst"],
          validation: { kind: "array", minItems: 1, maxItems: 3, promptOnceIfSingle: true },
        },
        {
          slug: "evidence-against-direction",
          type: "follow_up",
          source: [597, 616],
          marker: "Think about recent days or weeks",
          patientText: "Think about recent days or weeks — have you done anything that contradicts this thought, even partially? Some helpful directions: your general health, recent behaviors, past experiences of coping, feedback from others, or objective facts.",
          activationCondition: { field: "evidenceAgainstCount", operator: "less_than", value: 2 },
          outputFields: ["evidenceAgainst"],
        },
      ],
    },
    {
      slug: "q10-conclusion",
      title: "Q10 - Balanced Conclusion",
      titleKo: "Q10 - 균형 잡힌 결론",
      type: "question",
      source: [617, 634],
      requiredFields: ["balancedConclusion", "conclusionTherefore", "conclusionBeliefPercent"],
      restrictions: [sourceText([617, 634])],
      prompts: [
        { slug: "balanced-conclusion", type: "question", source: [617, 634], marker: "Taking all of this evidence together", patientText: "Taking all of this evidence together — both the evidence for and against the thought — what do you conclude? What does the full picture suggest?", outputFields: ["balancedConclusion"] },
        { slug: "therefore-extension", type: "follow_up", source: [617, 634], marker: "Can you take that further", patientText: "Can you take that further? What does that mean for you going forward? Starting with 'Therefore…'", outputFields: ["conclusionTherefore"] },
        // "네" bug fix: this is a real yes/no readback confirmation ("Does
        // that capture your conclusion accurately?") like confirm-working-thought
        // above, but was missing validation.kind: "boolean" -- without it, a
        // plain "네" fell through to the generic meaningful-text check and
        // was rejected as filler ("give a short concrete example") instead
        // of setting conclusionReadBackComplete=true and advancing to
        // conclusion-belief (whose validation.requiresField gates on it).
        { slug: "full-conclusion-readback", type: "confirmation", source: [617, 634], marker: "So your conclusion is", outputFields: ["conclusionReadBackComplete"], validation: { kind: "boolean" } },
        { slug: "conclusion-belief", type: "rating", source: [617, 634], marker: "How much do you believe that entire conclusion", outputFields: ["conclusionBeliefPercent"], validation: { kind: "rating", min: 0, max: 100, requiresField: "conclusionReadBackComplete" } },
      ],
    },
    {
      slug: "q11-new-emotions",
      title: "Q11 - New Emotions",
      titleKo: "Q11 - 새로운 감정",
      type: "assessment",
      source: [635, 658],
      requiredFields: ["positiveEmotions", "originalEmotionRerating", "newEmotionIntensities"],
      restrictions: [sourceText([635, 658])],
      prompts: [
        { slug: "positive-emotions-first", type: "question", source: [635, 658], marker: "Now that you have reached this conclusion", patientText: "Now that you have reached this conclusion, what positive emotions do you feel — if any?", outputFields: ["positiveEmotions"] },
        // §6.11 [신규]: marker contained the literal "[emotion named at
        // Q3a]" placeholder with no static message to substitute it --
        // static-messages/s03.ts now resolves it from the real
        // `primaryEmotion` value (or generates nothing if it's unset).
        { slug: "original-negative-emotion", type: "question", source: [635, 658], marker: "And what about [emotion named at Q3a]", outputFields: ["originalEmotionRerating"], validation: { kind: "same_field_reference", field: "primaryEmotion" } },
        // §6.12 [신규]: had neither marker nor patientText -- guaranteed
        // generic fallback. static-messages/s03.ts now names which
        // emotion(s) are being rated from positiveEmotions + (if still
        // present) primaryEmotion, matching allowedEmotionSources below.
        { slug: "emotion-intensities", type: "rating", source: [635, 658], outputFields: ["newEmotionIntensities"], validation: { kind: "rating", min: 0, max: 100, allowedEmotionSources: ["positiveEmotions", "primaryEmotion"] } },
      ],
    },
    {
      slug: "q12-q14-final-evaluation",
      title: "Q12-Q14 - Intended Action and Final Evaluation",
      titleKo: "Q12-Q14 - 실천 계획과 최종 평가",
      type: "assessment",
      source: [659, 686],
      requiredFields: ["intendedActions", "newBodySensations", "revisedAutomaticThoughtBeliefPercent", "globalEvaluation"],
      prompts: [
        { slug: "intended-action", type: "question", source: [659, 686], marker: "What do you intend to do now", patientText: "What do you intend to do now, given this new conclusion? What concrete actions come to mind?", outputFields: ["intendedActions"] },
        // §6.13 [신규 B-13]: intendedActions is this node's own requiredField,
        // so "exists" is always true once this prompt completes -- a
        // constant-true condition, not a genuine "if specific" gate. Left
        // as-is rather than repointed at a not-yet-populated specificity
        // field: doing that would make this prompt never fire (no writer
        // for that field exists without new semantic-classification logic,
        // which is out of this task's scope), which is worse than the
        // current always-fire behavior. Deferred (P2) pending a real
        // specificity signal.
        { slug: "action-plan-bridge", type: "transition", source: [659, 686], marker: "Those sound like the beginning", patientText: "Those sound like the beginning of an action plan. We can develop that in more detail — either now or in our next session.", activationCondition: { field: "intendedActions", operator: "exists" } },
        { slug: "new-body-sensations", type: "question", source: [659, 686], marker: "What do you notice in your body now", patientText: "What do you notice in your body now, compared to before?", outputFields: ["newBodySensations"] },
        // §6.14: repeatExactField retained for documentation, but
        // static-messages/s03.ts now readbacks `workingAutomaticThought ??
        // automaticThought` (not always the original automaticThought) so a
        // participant who went through the factual-AT branch (§6.5) is
        // re-rating the thought they actually worked with all session.
        { slug: "repeat-exact-at", type: "rating", source: [659, 686], marker: "How much do you now believe the original automatic thought", outputFields: ["revisedAutomaticThoughtBeliefPercent"], validation: { kind: "rating", min: 0, max: 100, repeatExactField: "automaticThought" } },
        // Same defect class as S04's final-emotional-check (S04's comment
        // there cites S07's readiness enum as the original precedent):
        // matchEnumChoice (runtime-deterministic-input.ts) only accepts an
        // exact match against `values` or a listed alias -- a natural
        // answer missing the leading article ("little better" instead of
        // "a little better") matched neither, so a real en-US transcript
        // got stuck re-asking this exact final question until it paused.
        { slug: "global-evaluation", type: "question", source: [659, 686], marker: "And overall, how are you now", patientText: "And overall, how are you now — compared to how you felt at the beginning of this exercise? Would you say you feel: the same, a little better, or much better?", outputFields: ["globalEvaluation"], validation: { kind: "enum", values: ["same", "a little better", "much better"], aliases: {
          "same": ["the same", "same as before", "no change", "not different", "그대로", "그대로예요", "똑같아요", "같아요", "비슷해요", "변화 없어요", "변함없어요", "그대로인 것 같아요"],
          "a little better": ["little better", "a bit better", "a little bit better", "somewhat better", "slightly better", "조금 나아졌어요", "조금 나아짐", "약간 나아졌어요", "조금 괜찮아졌어요", "조금 나아진 것 같아요", "약간 좋아졌어요"],
          "much better": ["a lot better", "way better", "significantly better", "so much better", "많이 나아졌어요", "많이 나아짐", "훨씬 나아졌어요", "훨씬 좋아졌어요", "많이 괜찮아졌어요", "많이 좋아졌어요"],
        } } },
      ],
    },
    {
      slug: "closing",
      title: "Closing the Session",
      titleKo: "세션 마무리",
      type: "session_complete",
      source: [687, 698],
      restrictions: [sourceText([699, 724])],
      terminal: true,
      prompts: [
        // §7.3 arm-중립화: "share it with your therapist" -> "study clinician"
        // (Protocol V9 Arm 3에는 담당 therapist가 없음, §Appendix A-13과 동일 원칙).
        { slug: "closing-review", type: "closing", source: [687, 698], marker: "You did important work today", patientText: "You did important work today. You took a distressing thought and examined it honestly and carefully. The conclusion you reached is yours — based on your own evidence and your own reasoning. I encourage you to review what you wrote and, if possible, share it with your study clinician at your next appointment.", outputFields: ["closingReview"] },
        { slug: "action-plan-offer", type: "transition", source: [687, 698], marker: "If you'd like, we can also", patientText: "If you'd like, we can also begin working on an action plan based on what you intend to do. Just let me know.", outputFields: ["actionPlanOffer"], completionEffect: { type: "complete_session" } },
      ],
    },
    {
      slug: "safety-pause",
      title: "Safety Pause and Escalation",
      titleKo: "안전을 위한 일시 중지 및 보고",
      type: "clinician_escalation",
      source: [455, 470],
      safetyRuleIds: ["TBCT-S03-CRISIS-PAUSE"],
      terminal: true,
      prompts: [
        { slug: "pause-and-escalate", type: "instruction", source: [455, 470], outputFields: ["safetyEscalation"], completionEffect: { type: "pause_session" }, safetyRuleIds: ["TBCT-S03-CRISIS-PAUSE"] },
      ],
    },
  ],
  extraEdges: [
    // §6.1 [교체 C-5]: system prompt v4 says crisis-level content can occur
    // "at any point during the session," but until now the only crisis edge
    // left this node reachable from safety-check alone -- Q7/Q10/etc. had no
    // path to safety-pause at all. One edge per remaining node below closes
    // that gap. All crisis edges use priority 0 (strictly below every other
    // conditional edge's priority 1, e.g. the factual-thought edge just
    // below) so a tie can never let a non-safety branch win the alphabetical
    // edge-ID tiebreak in runtime-state-reducer.ts when both conditions are
    // true in the same turn.
    { sourceSlug: "safety-check", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "intra-tr-introduction", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q1-situation", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q2-automatic-thought", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "factual-thought-meaning", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q2b-at-belief", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q3-emotion", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q4-behavior-body-summary", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q5-q7-behavior-and-distortion", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q8-q9-evidence", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q10-conclusion", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q11-new-emotions", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q12-q14-final-evaluation", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "closing", targetSlug: "safety-pause", edgeType: "safety", source: [455, 470], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "q2-automatic-thought", targetSlug: "factual-thought-meaning", edgeType: "conditional", source: [511, 528], label: "Factual thought", condition: { field: "automaticThoughtIsFactual", operator: "equals", value: true }, priority: 1 },
  ],
};
