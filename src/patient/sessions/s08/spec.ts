import { sourceText } from "@/lib/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/lib/protocol/source-fidelity-catalog";

const metadata: SessionSourceMetadata = {
  number: 8,
  id: "tbct-s08",
  title: "Trial One",
  titleKo: "첫 번째 시도",
  techniqueName: "Trial One",
  acronym: "TBTR",
  sourceLineStart: 1537,
  sourceLineEnd: 1651,
  sourceSessionHash: "b53082bbf7fac347ef2b04002a661a82af815f1307c531236d4b6f610305634e",
  contextRange: [1537, 1548],
  roleRange: [1537, 1548],
  languageRange: [1549, 1574],
  openingRange: [1549, 1574],
  requiredActionsRange: [1578, 1632],
  restrictionsRange: [1634, 1651],
  safetyRange: [1634, 1651],
};

// The verdict is the one answer the assistant may never supply, so it has to
// accept however the participant naturally states it -- typed, transcribed, or
// in the session language -- rather than only the canonical snake_case token.
const VERDICT_ALIASES: Record<string, string[]> = {
  guilty: ["guilty as charged", "i find the defendant guilty", "유죄", "유죄입니다", "유죄예요"],
  not_guilty: ["not guilty", "innocent", "i find the defendant not guilty", "무죄", "무죄입니다", "무죄예요"],
};

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "investigation-and-core-belief",
      title: "Step 1 - Investigation and Core Belief",
      titleKo: "1단계 - 조사 및 핵심 신념",
      type: "session_start",
      source: [1578, 1578],
      requiredFields: ["trialMaterialsReady", "chargeOrientationReaction", "distressingSituation", "automaticThought", "coreBelief"],
      safetyRuleIds: ["TBCT-S08-CRISIS-STOP"],
      restrictions: [sourceText([1549, 1574])],
      prompts: [
        // The participant guide promises the guide checks the Trial One
        // worksheet and appeal form are to hand before beginning.
        {
          slug: "trial-materials-ready",
          type: "confirmation",
          source: [1578, 1578],
          patientText: "Before we begin, one quick check: the Trial One worksheet and the Preparation for the Appeal record sit alongside our conversation and fill in as we go — the same forms from your guide. Do you have them in view?",
          outputFields: ["trialMaterialsReady"],
          validation: { kind: "boolean" },
        },
        // "A quick word first — the belief as a charge": a short orientation
        // to the idea underneath the whole method, BEFORE any of the work.
        // The session used to open cold on "describe a distressing
        // situation", so a participant met the courtroom framing for the
        // first time in Step 3, half an hour in.
        {
          slug: "belief-as-charge-orientation",
          type: "explanation",
          source: [1578, 1578],
          patientText: "Before anything else, a short word about the idea underneath today's method. A harsh belief about yourself works rather like an accusation you have been carrying without ever getting to answer it. We tend to treat something like \"I am a failure\" as a plain fact rather than a claim that could be examined and tested. Putting it on trial is simply a way of finally examining it — with all the fairness a real court would demand.",
          outputFields: ["chargeAsAccusationExplained"],
        },
        // "It's a short orientation, not a lecture, and you'll be asked what
        // you make of it before moving on."
        { slug: "orientation-reaction", type: "question", source: [1578, 1578], patientText: "What do you make of that?", outputFields: ["chargeOrientationReaction"] },
        {
          slug: "distressing-situation",
          type: "question",
          source: [1578, 1578],
          patientText: "Please identify a distressing situation and the automatic thought it triggered. What actually happened, and what thought went through your mind?",
          outputFields: ["distressingSituation", "automaticThought"],
        },
        { slug: "downward-arrow", type: "question", source: [1578, 1578], marker: "If that thought were true", outputFields: ["coreBelief"], validation: { kind: "participant_generated_core_belief" } },
      ],
    },
    {
      slug: "baseline-ratings",
      title: "Step 2 - Baseline Belief and Emotion Ratings",
      titleKo: "2단계 - 기저 신념·감정 평가",
      type: "assessment",
      source: [1579, 1579],
      requiredFields: ["coreBeliefBaselinePercent", "baselineEmotion", "baselineEmotionIntensityPercent"],
      prompts: [
        { slug: "core-belief-rating", type: "rating", source: [1579, 1579], patientText: "From 0 to 100%, how much do you believe this core belief right now?", outputFields: ["coreBeliefBaselinePercent"], validation: { kind: "rating", min: 0, max: 100, stateScaleEveryTime: true } },
        { slug: "baseline-emotion", type: "question", source: [1579, 1579], patientText: "What emotion do you feel when you believe this charge?", outputFields: ["baselineEmotion"] },
        { slug: "baseline-emotion-rating", type: "rating", source: [1579, 1579], patientText: "From 0 to 100%, how intense is that emotion right now?", outputFields: ["baselineEmotionIntensityPercent"], validation: { kind: "rating", min: 0, max: 100, stateScaleEveryTime: true } },
      ],
    },
    {
      slug: "courtroom-orientation",
      title: "Step 3 - Courtroom Orientation",
      titleKo: "3단계 - 법정 절차 안내",
      type: "orientation",
      source: [1580, 1580],
      requiredFields: ["courtroomOrientationAcknowledged", "charge"],
      restrictions: [sourceText([1549, 1574])],
      prompts: [
        // Source order for Step 3: propose the courtroom and orient the four
        // roles FIRST, then frame the core belief as the formal charge. The
        // two prompts used to run the other way around.
        { slug: "roles-orientation", type: "instruction", source: [1580, 1580], patientText: "We will examine one of your core beliefs in a symbolic internal courtroom. You will move through the roles of defendant, prosecutor, defense attorney, and juror while I guide the process. In a moment I will state the charge this court will consider.", outputFields: ["courtroomOrientationAcknowledged"], validation: { kind: "courtroom_roles_understood" } },
        // No `marker` here on purpose: Step 3's source line only offers
        // "The charge is: I am a failure." as an illustrative example of
        // the pattern, not literal script text, but marker-extraction
        // can't tell the difference -- it would otherwise become this
        // prompt's verbatim/fallback text and get spoken to every
        // participant regardless of what core belief they actually gave
        // in Step 1. runtime-static-message.ts's contextualPatientText
        // builds the real, participant-specific charge from the
        // coreBelief field instead; the completionEffect below persists
        // that same value into the charge field once delivered.
        { slug: "state-charge", type: "explanation", source: [1580, 1580], outputFields: ["charge"], completionEffect: { type: "copy_field", from: "coreBelief", to: "charge" } },
      ],
    },
    {
      slug: "defendant-chair",
      title: "Step 4 - Defendant Chair",
      titleKo: "4단계 - 피고인석",
      type: "dialogue",
      source: [1582, 1582],
      requiredFields: ["defendantRoleReady", "defendantPreProsecutionBeliefPercent", "defendantPreProsecutionEmotionIntensityPercent"],
      restrictions: [sourceText([1549, 1574])],
      prompts: [
        { slug: "enter-defendant-role", type: "role_transition", source: [1582, 1582], patientText: "Please move into the defendant's role and take a moment to settle there before we continue.", outputFields: ["defendantRoleReady"], validation: { kind: "slow_explicit_role_transition", requiresReadyConfirmation: true } },
        { slug: "defendant-pre-prosecution-ratings", type: "rating", source: [1582, 1582], patientText: "As the defendant, rate both values from 0 to 100%: how much you believe the charge, and how intense the emotion feels.", outputFields: ["defendantPreProsecutionBeliefPercent", "defendantPreProsecutionEmotionIntensityPercent"], validation: { kind: "paired_ratings", min: 0, max: 100, stateScaleEveryTime: true } },
      ],
    },
    {
      slug: "prosecutor-imagery",
      title: "Step 5 - Prosecutor Imagery",
      titleKo: "5단계 - 검사 심상화",
      type: "visualization",
      source: [1583, 1584],
      requiredFields: ["prosecutorImagery"],
      restrictions: [sourceText([1549, 1574]), sourceText([1583, 1584])],
      prompts: [
        { slug: "visualize-prosecutor", type: "question", source: [1583, 1584], marker: "Imagine the person who will accuse", outputFields: ["prosecutorImagery"], validation: { kind: "role_imagery", fields: ["sex", "age", "appearance", "manner", "expression"], disallowCloseFamilyOrFriend: true } },
      ],
    },
    {
      slug: "prosecution-evidence",
      title: "Step 6 - Prosecution Evidence",
      titleKo: "6단계 - 검찰 측 증거",
      type: "dialogue",
      source: [1585, 1589],
      requiredFields: ["prosecutionEvidence"],
      restrictions: [sourceText([1549, 1574]), sourceText([1585, 1589])],
      prompts: [
        // requiresThirdPerson does NOT belong on these readiness-confirmation
        // prompts -- it's a rule about how the participant describes the
        // defendant's actions while arguing a courtroom role (see
        // violatesThirdPersonRequirement in runtime-context.ts), not about how
        // they confirm being settled in the role. Applying it here rejected
        // every natural "I'm ready"/"I am ready now" answer as a first-person
        // violation and deadlocked the session (matches enter-defendant-role
        // and post-verdict-defendant below, which never had it).
        { slug: "enter-prosecutor-role", type: "role_transition", source: [1585, 1589], outputFields: ["prosecutorRoleReady"], validation: { kind: "slow_explicit_role_transition", requiresReadyConfirmation: true } },
        {
          slug: "prosecution-evidence",
          type: "question",
          source: [1585, 1589],
          outputFields: ["prosecutionEvidence"],
          validation: { kind: "array", minItems: 2, maxItems: 4, oneAtATime: true, participantSuppliesEvidence: true, acrossLife: true, requiresThirdPerson: true },
          // Re-asks for one piece of evidence at a time. The sufficiency rule
          // (runtime-context.ts LIST_SUFFICIENCY_RULES) keeps inviting the
          // next piece up to the source's "three, exceptionally four" -- it
          // no longer stops the moment the 2nd piece lands -- and honors an
          // explicit "no more" once at least two are collected.
          executionMode: "repeat_until",
          maxIterations: 6,
          completionCondition: { kind: "field", field: "prosecutionEvidenceSufficient", operator: "equals", value: true },
        },
      ],
    },
    {
      slug: "defendant-return-defense-imagery",
      title: "Step 7 - Defendant Return and Defense Imagery",
      titleKo: "7단계 - 피고인 복귀 및 변호인 심상화",
      type: "visualization",
      source: [1591, 1592],
      requiredFields: ["defendantPostProsecutionBeliefPercent", "defendantPostProsecutionEmotionIntensityPercent", "defenseImagery"],
      restrictions: [sourceText([1549, 1574]), sourceText([1591, 1592])],
      prompts: [
        { slug: "return-to-defendant", type: "role_transition", source: [1591, 1592], outputFields: ["defendantPostProsecutionBeliefPercent", "defendantPostProsecutionEmotionIntensityPercent"], validation: { kind: "paired_ratings_after_readback", min: 0, max: 100, stateScaleEveryTime: true } },
        { slug: "visualize-defense", type: "question", source: [1591, 1592], outputFields: ["defenseImagery"], validation: { kind: "role_imagery", fields: ["sex", "age", "appearance", "manner", "expression"], disallowCloseFamilyOrFriend: true } },
      ],
    },
    {
      slug: "defense-evidence",
      title: "Step 8 - Defense Evidence",
      titleKo: "8단계 - 변호 측 증거",
      type: "dialogue",
      source: [1593, 1598],
      requiredFields: ["defenseEvidence"],
      restrictions: [sourceText([1549, 1574]), sourceText([1593, 1598])],
      prompts: [
        { slug: "enter-defense-role", type: "role_transition", source: [1593, 1598], outputFields: ["defenseRoleReady"], validation: { kind: "slow_explicit_role_transition", requiresReadyConfirmation: true } },
        {
          slug: "defense-evidence",
          type: "question",
          source: [1593, 1598],
          outputFields: ["defenseEvidence"],
          validation: { kind: "array", minItems: 2, maxItems: 4, oneAtATime: true, concreteExamplesRequired: true, requiresThirdPerson: true },
          executionMode: "repeat_until",
          maxIterations: 6,
          completionCondition: { kind: "field", field: "defenseEvidenceSufficient", operator: "equals", value: true },
        },
        { slug: "concrete-defense-evidence", type: "clarification", source: [1593, 1598], marker: "concrete example", activationCondition: { field: "defenseEvidenceIsVague", operator: "equals", value: true }, outputFields: ["defenseEvidence"] },
      ],
    },
    {
      slug: "defendant-post-defense",
      title: "Step 9 - Defendant Post-Defense Re-assessment",
      titleKo: "9단계 - 변론 후 재평가",
      type: "assessment",
      source: [1600, 1600],
      requiredFields: ["defendantPostDefenseBeliefPercent", "defendantPostDefenseEmotionIntensityPercent"],
      restrictions: [sourceText([1549, 1574])],
      prompts: [
        { slug: "return-to-defendant", type: "role_transition", source: [1600, 1600], outputFields: ["defendantPostDefenseBeliefPercent", "defendantPostDefenseEmotionIntensityPercent"], validation: { kind: "paired_ratings", min: 0, max: 100, stateScaleEveryTime: true } },
      ],
    },
    {
      slug: "prosecution-rebuttal",
      title: "Step 10 - Prosecution Rebuttal",
      titleKo: "10단계 - 검찰 측 반박",
      type: "dialogue",
      source: [1601, 1601],
      requiredFields: ["prosecutionRebuttals"],
      restrictions: [sourceText([1549, 1574]), sourceText([1601, 1601])],
      prompts: [
        { slug: "return-to-prosecutor", type: "role_transition", source: [1601, 1601], outputFields: ["prosecutorRoleReady"], validation: { kind: "slow_explicit_role_transition", requiresReadyConfirmation: true } },
        // One rebuttal PER defense item, presented individually and never
        // grouped (source line 1601). The loop quotes the next unrebutted
        // defense item each iteration (static-messages/s08.ts) and completes
        // when every item has a rebuttal -- or the prosecutor concedes one
        // ("cannot rebut"), which Step 11's unrebutted-defense-note records.
        {
          slug: "rebut-each-defense-item",
          type: "question",
          source: [1601, 1601],
          marker: "The defense said",
          outputFields: ["prosecutionRebuttals"],
          validation: { kind: "array", oneRebuttalPerDefenseItem: true, requiresButPhrase: true, assistantMustNotCoach: true, requiresThirdPerson: true },
          executionMode: "repeat_until",
          maxIterations: 6,
          completionCondition: { kind: "field", field: "prosecutionRebuttalsComplete", operator: "equals", value: true },
        },
      ],
    },
    {
      slug: "defendant-post-rebuttal",
      title: "Step 11 - Defendant Post-Rebuttal Re-assessment",
      titleKo: "11단계 - 반박 후 재평가",
      type: "assessment",
      source: [1602, 1602],
      requiredFields: ["defendantPostRebuttalBeliefPercent", "defendantPostRebuttalEmotionIntensityPercent", "unrebuttedDefenseEvidence"],
      prompts: [
        { slug: "return-to-defendant", type: "role_transition", source: [1602, 1602], outputFields: ["defendantPostRebuttalBeliefPercent", "defendantPostRebuttalEmotionIntensityPercent"], validation: { kind: "paired_ratings", min: 0, max: 100, stateScaleEveryTime: true } },
        { slug: "unrebutted-defense-note", type: "reflection", source: [1602, 1602], marker: "unable to find a rebuttal", outputFields: ["unrebuttedDefenseEvidence"] },
      ],
    },
    {
      slug: "defense-surrebuttal",
      title: "Step 12 - Defense Surrebuttal",
      titleKo: "12단계 - 변호 측 재반박",
      type: "dialogue",
      source: [1604, 1604],
      requiredFields: ["defenseSurrebuttals", "thereforeConclusions"],
      restrictions: [sourceText([1549, 1574]), sourceText([1604, 1604])],
      prompts: [
        { slug: "return-to-defense", type: "role_transition", source: [1604, 1604], outputFields: ["defenseRoleReady"], validation: { kind: "slow_explicit_role_transition", requiresReadyConfirmation: true } },
        // One surrebuttal PER rebuttal: each iteration reads back the pair
        // (the defense's own evidence + the prosecution's rebuttal of it) and
        // asks the defense to answer that specific rebuttal.
        {
          slug: "surrebut-each-pair",
          type: "question",
          source: [1604, 1604],
          marker: "The prosecution said",
          outputFields: ["defenseSurrebuttals"],
          validation: { kind: "array", oneSurrebuttalPerRebuttal: true, requiresThirdPerson: true },
          executionMode: "repeat_until",
          maxIterations: 6,
          completionCondition: { kind: "field", field: "defenseSurrebuttalsComplete", operator: "equals", value: true },
        },
        // Each surrebutted pair receives its own participant-completed
        // "Therefore..." conclusion (source line 1604) -- one per pair, not
        // one for the whole argument. Requires the per-prompt iteration
        // counter in runtime-state-reducer.ts: this node has two repeat_until
        // loops, which used to share one budget.
        {
          slug: "participant-therefore",
          type: "follow_up",
          source: [1604, 1604],
          marker: "Therefore",
          outputFields: ["thereforeConclusions"],
          validation: { kind: "array", perEvidencePair: true, participantGenerated: true, assistantMustNotSupply: true, requiresThirdPerson: true },
          executionMode: "repeat_until",
          maxIterations: 6,
          completionCondition: { kind: "field", field: "thereforeConclusionsComplete", operator: "equals", value: true },
        },
      ],
    },
    {
      slug: "defendant-post-surrebuttal",
      title: "Step 13 - Defendant Post-Surrebuttal Re-assessment",
      titleKo: "13단계 - 재반박 후 재평가",
      type: "assessment",
      source: [1605, 1606],
      requiredFields: ["defendantPostSurrebuttalBeliefPercent", "defendantPostSurrebuttalEmotionIntensityPercent"],
      prompts: [
        { slug: "return-to-defendant", type: "role_transition", source: [1605, 1606], outputFields: ["defendantPostSurrebuttalBeliefPercent", "defendantPostSurrebuttalEmotionIntensityPercent"], validation: { kind: "paired_ratings", min: 0, max: 100, stateScaleEveryTime: true } },
      ],
    },
    {
      slug: "jury-deliberation",
      title: "Step 14 - Jury Deliberation and Verdict",
      titleKo: "14단계 - 배심원 평의 및 평결",
      type: "dialogue",
      source: [1609, 1616],
      requiredFields: ["juryOrientation", "juryReview", "verdict"],
      restrictions: [sourceText([1549, 1574]), sourceText([1609, 1616])],
      prompts: [
        { slug: "enter-jury-role", type: "role_transition", source: [1609, 1616], outputFields: ["juryOrientation"], validation: { kind: "slow_explicit_role_transition", requiresReadyConfirmation: true, privateJuryRoom: true } },
        { slug: "juror-role", type: "question", source: [1609, 1616], marker: "What is the role of a juror", outputFields: ["juryOrientation"] },
        // "question" + repeat_until: the jury must actually review each of
        // the four evidence blocks in turn (minItems:4) instead of
        // completing on one generic reflection.
        {
          slug: "review-four-blocks",
          type: "question",
          source: [1609, 1616],
          outputFields: ["juryReview"],
          validation: { kind: "array", minItems: 4, maxItems: 4, blocks: ["prosecution", "defense", "prosecution_rebuttal", "defense_surrebuttal"], oneItemAtATime: true },
          executionMode: "repeat_until",
          // The jury must review all four evidence blocks, so the completion
          // condition needs four accepted answers. maxIterations was also 4 --
          // zero slack: one duplicate or rejected juror answer consumed an
          // iteration and repeatLimitReached force-completed the review with a
          // block never examined. Two spare turns keep the four-block review
          // intact without letting the loop run away.
          maxIterations: 6,
          completionCondition: { kind: "field", field: "juryReviewCount", operator: "greater_than", value: 3 },
        },
        { slug: "participant-verdict", type: "question", source: [1609, 1616], marker: "verdict: guilty or not guilty", outputFields: ["verdict"], validation: { kind: "enum", values: ["guilty", "not_guilty"], aliases: VERDICT_ALIASES, participantGenerated: true, assistantMustNotSupply: true, challengeGuiltyThroughEvidenceReview: true } },
        {
          slug: "guilty-verdict-recheck",
          type: "clarification",
          source: [1609, 1616],
          patientText: "Before that verdict is announced, look back once more at the defense evidence and the defense's responses to the prosecution. Considering all four blocks again, do you still find the defendant guilty, or does this second look change the verdict?",
          activationCondition: { field: "verdict", operator: "equals", value: "guilty" },
          outputFields: ["verdict"],
          validation: { kind: "enum", values: ["guilty", "not_guilty"], aliases: VERDICT_ALIASES, participantGenerated: true, assistantMustNotSupply: true },
        },
      ],
    },
    {
      slug: "court-officer-announcement",
      title: "Step 15 - Court Officer Announcement",
      titleKo: "15단계 - 법정 경위의 선고",
      type: "dialogue",
      source: [1617, 1617],
      requiredFields: ["verdictAnnounced"],
      restrictions: [sourceText([1617, 1617])],
      prompts: [
        { slug: "announce-verdict", type: "role_transition", source: [1617, 1617], marker: "formally announce the verdict", outputFields: ["verdictAnnounced"], validation: { kind: "participant_announces_verdict", physicalPositionChange: true } },
      ],
    },
    {
      slug: "defendant-post-verdict",
      title: "Step 16 - Defendant Post-Verdict Ratings",
      titleKo: "16단계 - 평결 후 재평가",
      type: "assessment",
      source: [1618, 1618],
      requiredFields: ["defendantPostVerdictBeliefPercent", "defendantPostVerdictEmotionIntensityPercent"],
      prompts: [
        { slug: "post-verdict-defendant", type: "role_transition", source: [1618, 1618], outputFields: ["defendantPostVerdictReady"], validation: { kind: "slow_explicit_role_transition", requiresReadyConfirmation: true } },
        { slug: "post-verdict-ratings", type: "rating", source: [1618, 1618], marker: "now that they have heard the verdict", outputFields: ["defendantPostVerdictBeliefPercent", "defendantPostVerdictEmotionIntensityPercent"], validation: { kind: "paired_ratings_before_discussion", min: 0, max: 100, stateScaleEveryTime: true } },
      ],
    },
    {
      slug: "open-discussion",
      title: "Step 17 - Open Discussion",
      titleKo: "17단계 - 자유 논의",
      type: "dialogue",
      source: [1620, 1627],
      // One field per question: all seven used to write the same
      // `trialDiscussion` string, so each later answer silently overwrote the
      // previous one and six of the seven discussion answers were lost.
      requiredFields: ["trialExperience", "prosecutionSatisfaction", "defenseDemonstration", "preferredAlly", "goodDefenseTraits", "personDefinition", "upwardArrowReflection"],
      prompts: [
        { slug: "trial-experience", type: "question", source: [1620, 1627], marker: "What was it like", outputFields: ["trialExperience"] },
        // If the participant answers that the prosecution was NOT satisfied,
        // the source's "the prosecution may be requesting an appeal" bridge
        // into Step 19 is delivered conversationally -- see the
        // step-specific guidance for this prompt in
        // dialogue-contract-compiler.ts.
        { slug: "prosecution-satisfaction", type: "question", source: [1620, 1627], marker: "Was the prosecution satisfied", outputFields: ["prosecutionSatisfaction"] },
        { slug: "defense-demonstration", type: "question", source: [1620, 1627], marker: "What did the defense want", outputFields: ["defenseDemonstration"] },
        { slug: "preferred-ally", type: "question", source: [1620, 1627], marker: "Who would you prefer", outputFields: ["preferredAlly"] },
        { slug: "good-defense", type: "question", source: [1620, 1627], marker: "What does a good defense attorney", outputFields: ["goodDefenseTraits"] },
        { slug: "what-defines-person", type: "question", source: [1620, 1627], marker: "What defines a person", outputFields: ["personDefinition"] },
        { slug: "upward-arrow", type: "question", source: [1620, 1627], marker: "If the defense and the jury are correct", outputFields: ["upwardArrowReflection"] },
      ],
    },
    {
      slug: "positive-belief",
      title: "Step 18 - Positive Belief",
      titleKo: "18단계 - 긍정적 신념",
      type: "question",
      source: [1628, 1628],
      requiredFields: ["positiveBelief"],
      restrictions: [sourceText([1628, 1628])],
      prompts: [
        { slug: "participant-positive-belief", type: "question", source: [1628, 1628], marker: "positive belief must come from the participant", outputFields: ["positiveBelief"], validation: { kind: "participant_generated", participantGenerated: true, assistantMustNotSupply: true, writeToAppealRecord: true } },
      ],
    },
    {
      slug: "appeal-preparation",
      title: "Step 19 - Appeal Preparation",
      titleKo: "19단계 - 항소 준비",
      type: "homework",
      source: [1630, 1630],
      requiredFields: ["appealEvidence", "appealHomeworkAcknowledged"],
      prompts: [
        {
          slug: "appeal-evidence",
          // "question", not "worksheet_instruction": this prompt requires
          // the participant to actually supply evidence turn after turn,
          // and the passive "worksheet_instruction" type would otherwise
          // be treated as complete on assistant delivery alone.
          type: "question",
          source: [1630, 1630],
          marker: "identify at least two",
          outputFields: ["appealEvidence"],
          validation: { kind: "array", minItems: 2, maxItems: 3, supportsField: "positiveBelief" },
          executionMode: "repeat_until",
          maxIterations: 5,
          completionCondition: { kind: "field", field: "appealEvidenceSufficient", operator: "equals", value: true },
        },
        { slug: "daily-appeal-homework", type: "instruction", source: [1630, 1630], marker: "daily task", outputFields: ["appealHomeworkAcknowledged"] },
      ],
    },
    {
      slug: "positive-belief-rating",
      title: "Step 20 - Positive Belief Rating",
      titleKo: "20단계 - 긍정적 신념 평가",
      type: "assessment",
      source: [1631, 1631],
      requiredFields: ["positiveBeliefPercent"],
      prompts: [
        { slug: "positive-belief-rating", type: "rating", source: [1631, 1631], marker: "how much they believe", outputFields: ["positiveBeliefPercent"], validation: { kind: "rating", min: 0, max: 100, stateScaleEveryTime: true } },
      ],
    },
    {
      slug: "original-charge-final-ratings",
      title: "Step 21 - Original Charge Final Ratings",
      titleKo: "21단계 - 원래 혐의 최종 평가",
      type: "session_complete",
      source: [1632, 1632],
      requiredFields: ["originalChargeFinalBeliefPercent", "originalChargeFinalEmotionIntensityPercent", "trialClosingSummary"],
      restrictions: [sourceText([1634, 1651])],
      terminal: true,
      prompts: [
        { slug: "original-charge-final-ratings", type: "rating", source: [1632, 1632], marker: "re-assess their final level of belief", outputFields: ["originalChargeFinalBeliefPercent", "originalChargeFinalEmotionIntensityPercent"], validation: { kind: "paired_ratings", min: 0, max: 100, stateScaleEveryTime: true } },
        // The source closes Step 21 by comparing the final ratings with the
        // baseline "warmly". The comparison is composed from the recorded
        // fields (static-messages/s08.ts) and persisted verbatim into
        // trialClosingSummary by applyPromptCompletionEffect, exactly like
        // S07's plan summary -- then the session completes on delivery.
        { slug: "trial-closing", type: "closing", source: [1632, 1632], outputFields: ["trialClosingSummary"], validation: { kind: "warm_before_after_comparison" }, completionEffect: { type: "complete_session" } },
      ],
    },
    {
      slug: "safety-pause",
      title: "Safety Pause and Support",
      titleKo: "안전을 위한 일시 중지 및 지원",
      type: "clinician_escalation",
      source: [1634, 1651],
      safetyRuleIds: ["TBCT-S08-CRISIS-STOP"],
      terminal: true,
      prompts: [
        { slug: "stop-trial", type: "instruction", source: [1634, 1651], outputFields: ["safetyEscalation"], completionEffect: { type: "pause_session" }, safetyRuleIds: ["TBCT-S08-CRISIS-STOP"] },
      ],
    },
  ],
  extraEdges: [
    { sourceSlug: "investigation-and-core-belief", targetSlug: "safety-pause", edgeType: "safety", source: [1634, 1651], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 1 },
  ],
};
