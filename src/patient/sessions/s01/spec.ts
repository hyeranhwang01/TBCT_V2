import type { SessionSourceMetadata, SessionSpec } from "@/shared/protocol/source-fidelity-catalog";

// S01 redesign (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign). The
// flow follows the real first counseling session recorded 2026-09-11, step
// by step as decided by the researcher: problems and goals, the treatment
// structure, the participant's own case (situation -> feelings -> thought ->
// behavior/body -> link and friend comparison -> returning-arrows cycle)
// BEFORE the three-person example, a stepwise three-person conclusion, the
// manual's return to the participant's own case, the manual's cognitive
// distortions step, and concrete homework. Every node carries an explicit
// `objective`: without one the dialogue agent would be grounded on the raw
// manual range, which forbids personal questions before the three-person
// example. Prompt ids are positional (source-fidelity-catalog.ts), so
// messages.ts, turn-rules.ts and the tests are keyed to this exact order --
// s01/messages.test.ts guards the Korean text coverage.

const metadata: SessionSourceMetadata = {
  number: 1,
  id: "tbct-s01",
  title: "Introduction to the TBCT Model",
  titleKo: "TBCT 모델 소개",
  techniqueName: "Cognitive Conceptualization Diagram (CCD), Level 1",
  acronym: "CCD Level 1",
  sourceLineStart: 18,
  sourceLineEnd: 222,
  sourceSessionHash: "44c5389a6ad419119c6b2fa0dc61273d5a8ef501bb53e17f13e09b711b3b7a39",
  contextRange: [23, 47],
  // The manual's own "Tone and Style" section -- this range becomes the
  // dialogue agent's tone guidance. It used to point at the Phase 1-3
  // overview ([32, 47]), which told the agent to review distortions and
  // mention the Intra-TR, neither of which the redesigned flow does.
  roleRange: [180, 193],
  languageRange: [22, 22],
  openingRange: [53, 65],
  requiredActionsRange: [66, 159],
  restrictionsRange: [160, 222],
  safetyRange: [160, 181],
};

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "mandatory-opening",
      title: "Session Opening",
      titleKo: "세션 시작 - 도입",
      type: "session_start",
      source: [53, 65],
      requiredFields: ["sessionOpeningAcknowledged"],
      objective: "Welcome the participant warmly in one or two sentences and move straight on. Do not ask about feelings, history or problems in this turn -- the next step asks about their difficulties.",
      prompts: [
        { slug: "warm-acknowledgement", type: "opening", source: [53, 65], marker: "That sounds like a lot to be carrying", completionEffect: { type: "record_opening_acknowledgement" } },
      ],
    },
    {
      slug: "problems-and-goals",
      title: "Problems and Goals",
      titleKo: "문제와 목표",
      type: "question",
      source: [263, 279],
      requiredFields: ["s01Problems", "s01RepresentativeProblem", "s01Goal"],
      objective: "Following the real first session: ask which difficulties the participant would like help with, one at a time and with one concrete example, until they have nothing to add; let them choose from their own list the difficulty that best represents the others; then ask how they would like that difficulty to be when counseling ends, and how achieving it would feel or change their life. Never suggest difficulties or goals, never diagnose, and say 'when counseling ends' rather than a number of sessions.",
      prompts: [
        { slug: "main-difficulty", type: "question", source: [263, 279], patientText: "What difficulties would you like some help with these days?", outputFields: ["s01Problems"], validation: { kind: "array" } },
        { slug: "difficulty-example", type: "question", source: [263, 279], patientText: "Could you give me one concrete example of when that shows up?", outputFields: ["s01ProblemExample"] },
        { slug: "other-difficulty", type: "follow_up", source: [263, 279], patientText: "Is there any other difficulty you would like help with?", outputFields: ["s01Problems"], validation: { kind: "array" }, activationCondition: { field: "s01ProblemsNoMore", operator: "not_equals", value: true } },
        { slug: "other-difficulty-more", type: "follow_up", source: [263, 279], patientText: "Anything else you would like help with? It's fine to say there isn't.", outputFields: ["s01Problems"], validation: { kind: "array" }, activationCondition: { field: "s01ProblemsNoMore", operator: "not_equals", value: true } },
        // Skipped when the participant named only one difficulty: s01/turn-rules.ts
        // records that one as representative and sets s01RepresentativeAuto,
        // because asking "which of these is the biggest" about a list of one
        // reads as if the session were not listening (2026-09-13 live session).
        { slug: "representative-difficulty", type: "question", source: [263, 279], patientText: "Of the difficulties you mentioned, which one feels like the biggest -- the one that sits underneath the others? You can simply say 'the second one'.", outputFields: ["s01RepresentativeProblem"], activationCondition: { field: "s01RepresentativeAuto", operator: "not_equals", value: true } },
        { slug: "goal-at-end", type: "question", source: [334, 350], patientText: "When counseling ends, how would you like [representative difficulty] to be different?", outputFields: ["s01Goal"] },
        { slug: "goal-benefit", type: "question", source: [334, 350], patientText: "If that happened, how would you feel, and what would change in your daily life?", outputFields: ["s01GoalBenefit"] },
      ],
    },
    {
      slug: "treatment-structure",
      title: "Treatment Structure and Practice",
      titleKo: "상담의 방식과 연습",
      type: "orientation",
      source: [48, 49],
      requiredFields: ["treatmentCommitment"],
      objective: "As in the real first session, explain briefly that this work is built together and that practice between conversations matters: of the 168 hours in a week the conversation takes only about one, so what the participant tries in the rest of the week makes much of the difference. Then ask whether they are willing to work this way. Do not assign any exercise yet.",
      prompts: [
        { slug: "collaboration-and-practice", type: "explanation", source: [48, 49], patientText: "This works best as something we build together. A week has 168 hours, and our conversation takes only about one of them, so the small practice you do outside our conversations makes a big difference." },
        { slug: "practice-commitment", type: "question", source: [48, 49], patientText: "Would you be willing to work on it together this way?", outputFields: ["treatmentCommitment"], validation: { kind: "boolean" } },
      ],
    },
    {
      slug: "own-situation",
      title: "Own Situation",
      titleKo: "나의 상황",
      type: "question",
      source: [66, 74],
      requiredFields: ["situationThoughtDistinction"],
      participantRationale: "Picking one concrete moment helps separate what actually happened from the thought your mind added about it, and makes it possible to see how a thought, a feeling and what you did connect in a real moment rather than in general.",
      objective: "Ask for one recent moment (within about the last week) when the representative difficulty showed up. If the participant is vague or cannot think of one, offer everyday examples: a task that had to get done, a presentation, having to meet someone. If the answer is long, the participant writes their own one-line version for the worksheet -- never write, shorten or rephrase it for them. Do not ask about thoughts, feelings or behavior yet, and do not ask whether it is a situation or a thought.",
      prompts: [
        { slug: "recent-moment", type: "question", source: [66, 74], patientText: "In the past week or so, was there a moment when [representative difficulty] showed up? What was happening?", outputFields: ["situationThoughtDistinction"], validation: { kind: "participant_articulated_distinction" } },
        { slug: "situation-examples", type: "follow_up", source: [66, 74], patientText: "It can be something small -- for example a task you had to get done, a presentation, or having to meet someone. Did anything like that happen recently?", outputFields: ["situationThoughtDistinction"], activationCondition: { field: "situationNeedsExamples", operator: "equals", value: true } },
        { slug: "write-situation-line", type: "question", source: [66, 74], patientText: "If you wrote that on the worksheet in one short line, how would you put it?", outputFields: ["situationLine"], activationCondition: { field: "situationNeedsLine", operator: "equals", value: true } },
      ],
    },
    {
      slug: "own-emotions",
      title: "Own Feelings",
      titleKo: "그때의 감정",
      type: "question",
      source: [35, 35],
      requiredFields: ["personalEmotion", "personalEmotionIntensity"],
      objective: "Ask about the participant's feelings in that moment FIRST, before the thought, as in the real first session. Collect up to three feelings, one at a time, each with a 0-100 intensity. Accept the participant's own emotion words; never suggest feelings.",
      prompts: [
        { slug: "first-emotion", type: "question", source: [35, 35], patientText: "At that moment, how did you feel?", outputFields: ["personalEmotion"] },
        { slug: "first-emotion-intensity", type: "rating", source: [35, 35], patientText: "If 0 is not at all and 100 is as strong as it gets, how strong was that feeling?", outputFields: ["personalEmotionIntensity"], validation: { kind: "rating", min: 0, max: 100 } },
        { slug: "second-emotion", type: "question", source: [35, 35], patientText: "Was there any other feeling at the same time?", outputFields: ["personalSecondEmotion"] },
        { slug: "second-emotion-intensity", type: "rating", source: [35, 35], patientText: "And how strong was that one, from 0 to 100?", outputFields: ["personalSecondEmotionIntensity"], validation: { kind: "rating", min: 0, max: 100 }, activationCondition: { field: "personalSecondEmotion", operator: "exists" } },
        { slug: "third-emotion", type: "question", source: [35, 35], patientText: "Anything else you felt?", outputFields: ["personalThirdEmotion"], activationCondition: { field: "personalEmotionsNoMore", operator: "not_equals", value: true } },
        { slug: "third-emotion-intensity", type: "rating", source: [35, 35], patientText: "How strong was that, from 0 to 100?", outputFields: ["personalThirdEmotionIntensity"], validation: { kind: "rating", min: 0, max: 100 }, activationCondition: { field: "personalThirdEmotion", operator: "exists" } },
      ],
    },
    {
      slug: "own-thought",
      title: "Own Thought",
      titleKo: "그때 스친 생각",
      type: "question",
      source: [34, 35],
      requiredFields: ["openingInitialThought", "s01ThoughtBeliefPercent"],
      objective: "Move from the feeling to the thought: ask why they felt that way and what went through their mind at that moment. Accept uncertainty. If the answer is long, the participant writes their own one-line version for the worksheet -- never shorten or rephrase it for them. Then ask how strongly they believed the thought at the time, 0-100.",
      prompts: [
        { slug: "thought-behind-emotion", type: "question", source: [34, 35], patientText: "You mentioned feeling [their emotion]. Why do you think you felt that way -- what went through your mind at that moment?", outputFields: ["openingInitialThought"] },
        { slug: "write-thought-line", type: "question", source: [34, 35], patientText: "If you wrote that thought on the worksheet in one short line, how would you put it?", outputFields: ["thoughtLine"], activationCondition: { field: "thoughtNeedsLine", operator: "equals", value: true } },
        { slug: "thought-belief", type: "rating", source: [34, 35], patientText: "Back then, how strongly did you believe that thought, from 0 (not at all) to 100 (completely)?", outputFields: ["s01ThoughtBeliefPercent"], validation: { kind: "rating", min: 0, max: 100 } },
      ],
    },
    {
      slug: "own-behavior-body",
      title: "Own Behavior and Body",
      titleKo: "그때의 행동과 몸의 반응",
      type: "question",
      source: [36, 36],
      requiredFields: ["personalBehavior", "personalBodySensations"],
      objective: "Ask what the participant did, offering everyday examples only if they are stuck, then whether they did anything else, then what they noticed in their body. Accept their own words.",
      prompts: [
        { slug: "first-behavior", type: "question", source: [36, 36], patientText: "What did you do at that moment?", outputFields: ["personalBehavior"] },
        { slug: "behavior-examples", type: "follow_up", source: [36, 36], patientText: "For example, people sometimes leave, go quiet, cry, or try to fix it right away. What was it like for you?", outputFields: ["personalBehavior"], activationCondition: { field: "personalBehaviorNeedsExamples", operator: "equals", value: true } },
        { slug: "second-behavior", type: "question", source: [36, 36], patientText: "Did you do anything else?", outputFields: ["personalSecondBehavior"] },
        { slug: "body", type: "question", source: [36, 36], patientText: "And what did you notice in your body -- for example tension, trembling, or your heart racing?", outputFields: ["personalBodySensations"] },
        { slug: "body-examples", type: "follow_up", source: [36, 36], patientText: "Even something small counts -- a warm face, a tight chest, shaky hands. Was there anything like that?", outputFields: ["personalBodySensations"], activationCondition: { field: "personalBodySensationsNeedsExamples", operator: "equals", value: true } },
      ],
    },
    {
      slug: "link-and-friend",
      title: "Link Check and Friend Comparison",
      titleKo: "연결 확인과 친구 비교",
      type: "dialogue",
      source: [34, 37],
      requiredFields: ["friendThought"],
      objective: "Help the participant see the chain on their own worksheet: situation, then thought, then feeling, then behavior and body. Point out that the arrow from the situation to the thought is dotted -- the same situation does not force the same thought -- then ask whether a close friend in the same situation would have thought exactly the same, and what the friend might have thought. Ask; do not lecture.",
      prompts: [
        { slug: "link-check", type: "question", source: [34, 37], patientText: "Looking at the worksheet: the situation, then the thought, then the feeling, then what you did and felt in your body. Can you see how they connect?", outputFields: ["cycleLinkRecognized"], validation: { kind: "boolean" } },
        { slug: "dotted-line", type: "explanation", source: [34, 37], patientText: "The arrow from the situation to the thought is dotted. It means the same situation does not have to lead to the same thought." },
        { slug: "friend-same-thought", type: "question", source: [34, 37], patientText: "If a close friend had been in exactly the same situation, do you think they would have had exactly the same thought?", outputFields: ["friendWouldThinkSame"], validation: { kind: "boolean" } },
        { slug: "friend-thought", type: "question", source: [34, 37], patientText: "What might your friend have thought instead?", outputFields: ["friendThought"] },
      ],
    },
    {
      slug: "returning-arrows",
      title: "Returning Arrows",
      titleKo: "되돌아오는 화살표 (순환고리)",
      type: "dialogue",
      source: [130, 140],
      requiredFields: ["cycleAfterBehaviorEmotion", "cycleReinforcedThought", "cycleSafetyStrategy"],
      objective: "Explore, in the participant's own words, how their cycle feeds itself: after what they did, how they felt; which thought got stronger; what they usually do to keep it from happening (only if stuck, mention avoiding or preparing and planning ahead); whether that connects to the difficulty they named at the start; and how it works right away versus over time. Let the participant make each link. Never use the words belief, assumption or core belief.",
      prompts: [
        { slug: "after-behavior-feeling", type: "question", source: [130, 140], patientText: "After [their behavior], how did you feel?", outputFields: ["cycleAfterBehaviorEmotion"] },
        { slug: "thought-strengthened", type: "question", source: [130, 140], patientText: "When you feel that way, which thought gets stronger?", outputFields: ["cycleReinforcedThought"] },
        { slug: "usual-prevention", type: "question", source: [130, 140], patientText: "To keep that from happening again, what do you usually do?", outputFields: ["cycleSafetyStrategy"] },
        { slug: "usual-prevention-hint", type: "follow_up", source: [130, 140], patientText: "Some people avoid situations like that, and some prepare or plan ahead a lot. Is either of those close to what you do?", outputFields: ["cycleSafetyStrategy"], activationCondition: { field: "cycleSafetyStrategyNeedsExamples", operator: "equals", value: true } },
        { slug: "problem-link", type: "question", source: [130, 140], patientText: "Does that connect to [representative difficulty], the difficulty you mentioned at the start?", outputFields: ["cycleProblemLink"] },
        { slug: "short-long-term", type: "question", source: [130, 140], patientText: "When you do that, how does it feel right away? And how does it work out over time?", outputFields: ["cycleShortLongTermEffect"] },
      ],
    },
    {
      slug: "three-person-preview",
      title: "Three-Person Example",
      titleKo: "세 사람 예시",
      type: "orientation",
      source: [75, 85],
      requiredFields: ["threePersonPreviewComplete"],
      objective: "After the participant's own cycle, introduce a neutral example with three people: seeing the same principle in other people, from a little distance, makes it clearer. Then present the scene exactly as written. Do not introduce any other scenario (no job interview).",
      participantRationale: "Three people hearing exactly the same words can react in completely different ways. Walking through their reactions makes it easier to see how a thought, not just what happened, shapes how someone feels and acts.",
      prompts: [
        { slug: "preview", type: "explanation", source: [75, 85], patientText: "Now let's look at the same idea through other people's eyes. It is often easier to see from a little distance, when it isn't about you.", outputFields: ["threePersonPreviewComplete"] },
        // Text comes from messages.ts: the scene generated for this session
        // (s01/generation.ts, stored by s01/turn-rules.ts), or the fixed
        // real-session scene below.
        { slug: "scene", type: "instruction", source: [82, 85], patientText: "As they say goodbye, a counselor says the same thing to three people they have just met: “It was nice to meet you. You seem like a good person. See you next week.”" },
      ],
    },
    {
      slug: "first-person",
      title: "Three-Person Example - First Person",
      titleKo: "첫 번째 사람",
      type: "dialogue",
      source: [86, 92],
      requiredFields: ["candidateOneEmotion", "candidateOneThought", "candidateOneBehavior", "candidateOneBodySensations"],
      objective: "Person 1 heard the remark in the scene. The participant works out everything: first how person 1 might feel (start with a positive reaction), then which thought would lead to that feeling, then how they would act, then what they might notice in their body. Do not supply the thought. Scene only -- no interviewer, no job application.",
      prompts: [
        { slug: "candidate-one-emotion", type: "question", source: [86, 92], patientText: "Hearing that, how might the first person feel? Let's start with a positive reaction.", outputFields: ["candidateOneEmotion"] },
        { slug: "candidate-one-thought", type: "question", source: [86, 92], patientText: "For them to feel that way, what thought might have gone through their mind?", outputFields: ["candidateOneThought"] },
        { slug: "candidate-one-behavior", type: "question", source: [86, 92], patientText: "With that thought and feeling, how might they act?", outputFields: ["candidateOneBehavior"] },
        { slug: "candidate-one-body", type: "question", source: [86, 92], patientText: "And how might their body feel?", outputFields: ["candidateOneBodySensations"] },
      ],
    },
    {
      slug: "second-person",
      title: "Three-Person Example - Second Person",
      titleKo: "두 번째 사람",
      type: "dialogue",
      source: [93, 104],
      requiredFields: ["candidateTwoThought", "candidateTwoBehavior", "candidateTwoBodySensations"],
      objective: "Person 2 heard exactly the same remark but felt suspicious. The participant infers the thought behind that feeling (the stored example thought is offered only if they are stuck), then how person 2 would act and what they might notice in their body. Do not supply the thought unprompted. Scene only -- no interviewer, no job application.",
      prompts: [
        { slug: "candidate-two-thought", type: "question", source: [93, 104], patientText: "The second person heard exactly the same words but felt suspicious. What thought might have made them feel that way?", outputFields: ["candidateTwoThought"] },
        { slug: "candidate-two-thought-hint", type: "follow_up", source: [93, 104], patientText: "For example, a thought like '[person two hint]' could do it. What might the second person have thought?", outputFields: ["candidateTwoThought"], activationCondition: { field: "candidateTwoThoughtNeedsHint", operator: "equals", value: true } },
        { slug: "candidate-two-behavior", type: "question", source: [93, 104], patientText: "Feeling suspicious like that, how might they act?", outputFields: ["candidateTwoBehavior"] },
        { slug: "candidate-two-body", type: "question", source: [93, 104], patientText: "And how might their body feel?", outputFields: ["candidateTwoBodySensations"] },
      ],
    },
    {
      slug: "third-person",
      title: "Three-Person Example - Third Person",
      titleKo: "세 번째 사람",
      type: "dialogue",
      source: [105, 117],
      requiredFields: ["candidateThreeThought", "candidateThreeBehavior", "candidateThreeBodySensations"],
      objective: "Person 3 heard exactly the same remark and got angry. The participant infers the thought behind that feeling (the stored example thought is offered only if they are stuck), then how person 3 would act and what they might notice in their body. Do not supply the thought unprompted. Scene only -- no interviewer, no job application.",
      prompts: [
        { slug: "candidate-three-thought", type: "question", source: [105, 117], patientText: "The third person heard the same words and got angry. What thought might have made them angry?", outputFields: ["candidateThreeThought"] },
        { slug: "candidate-three-thought-hint", type: "follow_up", source: [105, 117], patientText: "For example, a thought like '[person three hint]' could do it. What might the third person have thought?", outputFields: ["candidateThreeThought"], activationCondition: { field: "candidateThreeThoughtNeedsHint", operator: "equals", value: true } },
        { slug: "candidate-three-behavior", type: "question", source: [105, 117], patientText: "Feeling angry like that, how might they act?", outputFields: ["candidateThreeBehavior"] },
        { slug: "candidate-three-body", type: "question", source: [105, 117], patientText: "And how might their body feel?", outputFields: ["candidateThreeBodySensations"] },
      ],
    },
    {
      slug: "three-person-conclusion",
      title: "Three-Person Conclusion",
      titleKo: "세 사람 예시 정리",
      type: "summary",
      source: [123, 126],
      requiredFields: ["threePersonModelInsight"],
      objective: "Help the participant reach the conclusion themselves, one step at a time: was the situation the same or different for the three people; were their feelings the same; were their actions the same; then what made the difference. If they answer 'the feelings', ask what made the feelings differ. Never state the conclusion yourself.",
      prompts: [
        { slug: "situation-same", type: "question", source: [123, 126], patientText: "For those three people, was the situation the same or different?", outputFields: ["comparisonSituation"] },
        { slug: "feelings-compared", type: "question", source: [123, 126], patientText: "And were their feelings the same or different?", outputFields: ["comparisonFeelings"] },
        { slug: "actions-compared", type: "question", source: [123, 126], patientText: "And what about their actions?", outputFields: ["comparisonActions"] },
        { slug: "what-made-difference", type: "question", source: [123, 126], patientText: "The situation was the same, so what do you think made the difference?", outputFields: ["threePersonModelInsight"] },
        { slug: "emotion-cause-follow-up", type: "question", source: [123, 126], patientText: "And what made their feelings different in the first place?", outputFields: ["comparisonFeelingCause"], activationCondition: { field: "conclusionAnsweredEmotion", operator: "equals", value: true } },
      ],
    },
    {
      slug: "return-to-own-case",
      title: "Return to Own Case",
      titleKo: "나의 경험으로 돌아오기",
      type: "dialogue",
      source: [127, 139],
      requiredFields: ["ownCasePatternInsight", "ownCaseActualOutcome"],
      objective: "Return to the participant's own moment with the manual's bridge -- this is the planned next step, not revisiting an earlier task. Let them find the same pattern there (what made their feeling), then ask what actually happened afterwards. Only if what they feared did not happen, ask what that tells them. Do not repeat the earlier cycle questions and do not interpret for them.",
      prompts: [
        { slug: "return-bridge", type: "transition", source: [127, 129], marker: "Now, let's go back to what you mentioned earlier", patientText: "Now, let's go back to what you mentioned earlier about [their situation]. With what you've just seen, let's look at how this same pattern shows up in your own experience." },
        { slug: "what-made-feeling", type: "question", source: [130, 135], patientText: "The three people felt differently depending on their thoughts. In your own situation, what do you think made you feel [their emotion]?", outputFields: ["ownCasePatternInsight"] },
        { slug: "what-happened", type: "question", source: [136, 136], patientText: "After [their behavior], what actually happened in that situation?", outputFields: ["ownCaseActualOutcome"] },
        { slug: "outcome-meaning", type: "question", source: [139, 139], patientText: "So what does it tell you that what you feared didn't actually happen?", outputFields: ["ownCaseOutcomeMeaning"], activationCondition: { field: "fearedOutcomeDidNotMaterialize", operator: "equals", value: true } },
      ],
    },
    {
      slug: "participant-summary",
      title: "Participant Summary",
      titleKo: "참여자 요약",
      type: "summary",
      source: [141, 144],
      requiredFields: ["participantSummary"],
      objective: "Invite the participant to put into their own words what they noticed about how their thoughts, feelings and behavior connect. Do not summarize for them.",
      prompts: [
        { slug: "participant-summary", type: "summary", source: [141, 144], marker: "Before we move on", patientText: "Before we move on, I'd like to ask you: in your own words, what did you notice or understand about how your thoughts, emotions, and behaviors connect in that situation?", outputFields: ["participantSummary"], validation: { kind: "participant_summary_required" } },
      ],
    },
    {
      slug: "cognitive-distortions",
      title: "Introducing Cognitive Distortions",
      titleKo: "인지 왜곡 소개",
      type: "question",
      source: [145, 155],
      requiredFields: ["participantSelectedDistortions"],
      participantRationale: "Automatic thoughts often follow a handful of common patterns. Naming the pattern in your own thought makes it easier to question later, rather than just having it feel automatically true.",
      objective: "Follow the manual: point the participant to the list of 15 cognitive distortions shown beside the conversation, introduce the idea briefly, invite them to read two or three, and ask whether any seem to fit the thought they noticed. The participant chooses; do not name, suggest or rank a distortion unless they explicitly ask. Do not go through all fifteen. Then ask what difference it would make if the thought were a distortion.",
      prompts: [
        { slug: "show-list", type: "worksheet_instruction", source: [146, 146], patientText: "Beside our conversation there is a list of 15 common thinking patterns, called cognitive distortions.", outputFields: ["distortionListPresented"] },
        { slug: "intro-distortions", type: "explanation", source: [145, 155], marker: "These negative automatic thoughts", patientText: "These negative automatic thoughts we've been looking at — they sometimes have a name in cognitive therapy. We call them cognitive distortions. Not every automatic thought is a distortion, but some of them are errors or exaggerations in our thinking that are worth examining.", outputFields: ["distortionsIntroductionAcknowledged"] },
        { slug: "read-a-few", type: "question", source: [148, 149], patientText: "Could you read through two or three of them?", outputFields: ["distortionListRead"], validation: { kind: "boolean" } },
        { slug: "identify-distortion", type: "question", source: [145, 155], marker: "Looking at what went through your mind", patientText: "Looking at what went through your mind in that situation — do any of these distortions seem to fit? It's fine if none of them feel like a match.", outputFields: ["participantSelectedDistortions"] },
        // Only when the participant explicitly asks for suggestions
        // (s01/turn-rules.ts); runtime-orchestrator.ts then grounds this turn
        // on registry-validated candidates (s01/distortion-candidates.ts).
        { slug: "suggested-candidates", type: "question", source: [154, 154], patientText: "Here are a few patterns that might be worth comparing with your thought. Does any of them feel familiar? It's fine if none of them do.", outputFields: ["participantSelectedDistortions"], activationCondition: { field: "distortionSuggestionRequested", operator: "equals", value: true } },
        { slug: "meaning-of-distortion", type: "question", source: [145, 155], marker: "If you discovered that this thought", patientText: "If you discovered that this thought might be a cognitive distortion — a kind of error in thinking — what difference would that make?", outputFields: ["distortionMeaning"] },
      ],
    },
    {
      slug: "homework-closing",
      title: "Homework and Closing",
      titleKo: "숙제와 마무리",
      type: "session_complete",
      source: [156, 159],
      terminal: true,
      objective: "Give this week's practice concretely, as in the real first session: keep the cognitive distortions list nearby and, whenever such a thought comes up, write a short example in the 'My examples' column of the matching distortion; you will look at it together next time. Ask whether they can do it. Do not mention the Intrapersonal Thought Record, do not summarize the session and do not ask for feedback. Close with one short goodbye.",
      prompts: [
        { slug: "homework-assignment", type: "worksheet_instruction", source: [156, 157], patientText: "This week, keep the cognitive distortions list nearby. Whenever a thought like this comes up, write a short example in the 'My examples' column of the pattern it fits. We'll look at them together next time.", outputFields: ["dailyObservationPractice"] },
        { slug: "homework-commitment", type: "question", source: [156, 157], patientText: "Do you think you can do that?", outputFields: ["homeworkCommitment"], validation: { kind: "boolean" } },
        { slug: "goodbye", type: "closing", source: [159, 159], patientText: "Thank you for sharing today. See you next time.", completionEffect: { type: "complete_session" } },
      ],
    },
  ],
};
