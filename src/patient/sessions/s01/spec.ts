import { sourceText } from "@/lib/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/lib/protocol/source-fidelity-catalog";

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
  roleRange: [32, 47],
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
      title: "Session Opening - Mandatory First Move",
      titleKo: "세션 시작 - 도입",
      type: "session_start",
      source: [53, 74],
      requiredFields: ["sessionOpeningAcknowledged", "situationThoughtDistinction"],
      restrictions: [sourceText([53, 65])],
      prompts: [
        { slug: "warm-acknowledgement", type: "opening", source: [53, 65], marker: "That sounds like a lot to be carrying", completionEffect: { type: "record_opening_acknowledgement" } },
        // Reworded per this task's Opening redesign brief (Phase 1B
        // "Personal Situation Seed"): a plain, low-effort invitation to
        // recall one recent moment, rather than the source's more abstract
        // "quite telegraphically" framing. Still writes
        // situationThoughtDistinction and is still immediately followed by
        // the situation-or-thought Socratic check below -- an older comment
        // here previously argued this field should NOT hold the
        // participant's real personal situation, but the worksheet binding
        // (box-situation, "My situation") and both regression tests in
        // runtime-source-fidelity.test.ts already treat it as exactly that;
        // this redesign builds on that actual behavior rather than the
        // stale comment.
        { slug: "telegraphic-situation", type: "question", source: [66, 74], patientText: "Was there a recent moment that felt a little uncomfortable or stuck with you? It doesn't have to be a big thing.", outputFields: ["situationThoughtDistinction"], validation: { kind: "participant_articulated_distinction" } },
      ],
    },
    {
      slug: "situation-thought-distinction",
      title: "Step 1 - Distinguish Situation from Thoughts and Emotions",
      titleKo: "1단계 - 상황과 생각·감정 구분하기",
      type: "question",
      source: [66, 74],
      requiredFields: ["situationThoughtDistinction", "openingInitialThought"],
      restrictions: [sourceText([66, 74])],
      participantRationale: "This helps separate what actually happened from the thought your mind added about it — that difference is the foundation the rest of this program builds on. We're asking about the thought a little earlier than you might expect; a quick example in a moment will make it clear why that matters just as much as what actually happened.",
      prompts: [
        // NOT outputFields: ["situationThoughtDistinction"] -- source
        // (tbct-source-text.generated.ts:71-76) is explicit that this
        // step is a Socratic check on whether the participant can TELL
        // situation apart from thought ("gently explore whether what
        // they said was a description (situation) or an interpretation
        // (thought)"), unconditionally re-asked after the real situation
        // answer from telegraphic-situation above. Unlike every other
        // "re-ask the same field" clarification in this catalog (e.g.
        // specific-moment/emotion-to-thought-redirect below), this one had
        // no activationCondition gating it to only the cases that
        // actually needed correcting -- it ran for every participant and
        // overwrote the worksheet's "My situation" box with whatever they
        // said in reply to "is that a situation or a thought?" (e.g. "I
        // think it's a situation"), discarding their real answer.
        // 세션로그 §9-1 [P1] 잔여 커버리지: verbatim 복원.
        { slug: "situation-or-thought", type: "clarification", source: [66, 74], marker: "That's interesting", patientText: "That's interesting — is that the situation, or could that be a thought?" },
        // Phase 1C "Initial Thought Probe" (Opening redesign brief §19-21):
        // a first-pass, uncertainty-tolerant look at the automatic thought
        // -- not a full automaticThought-style extraction. Left without a
        // validation.kind so it only goes through the generic
        // meaningful-text check, never the stricter semantic-assessment
        // path; a plain "I don't know" is stored and the session moves on
        // rather than looping (see runtime-context.ts's NON_ANSWER_TEXT fix).
        { slug: "initial-thought-probe", type: "question", source: [66, 74], patientText: "When that happened, what's the first thought that comes to mind? It doesn't have to be exact — whatever comes up is fine.", outputFields: ["openingInitialThought"] },
        // Bridges Phase 1C into the Neutral Example (redesign brief §22):
        // names the "why did you just ask me about my thoughts" moment
        // directly rather than leaving it unaddressed.
        { slug: "personal-example-redirect", type: "transition", source: [73, 74], patientText: "Thanks for sharing that. Looking at your own thought this early on might feel a little unexpected — so let's make it easier with a quick example first, and then we'll come right back to what you shared.", completionEffect: { type: "redirect_to_three_person_example" } },
      ],
    },
    {
      slug: "three-person-example",
      title: "Step 2 - Three-Person Example",
      titleKo: "2단계 - 세 사람 예시",
      type: "orientation",
      source: [75, 85],
      requiredFields: ["threePersonPreviewComplete"],
      restrictions: [sourceText([75, 85])],
      // This node's own source range ([75, 85]) still ends inside the
      // manual's job-interview vignette (the "interviewer's reaction,
      // positive or negative" instruction), left over from before the
      // presentation-vignette redesign -- without an explicit objective
      // here, clinicalPurpose (sourceText(node.source) verbatim) hands the
      // dialogue agent that stale interviewer text as its grounding for
      // this turn, and it gets voiced to the patient even though no
      // interviewer exists anywhere in the redesigned content (confirmed
      // live). Same fix applied to first/second/third-candidate and
      // three-person-conclusion below, whose ranges have the same overlap.
      objective: "Introduce a neutral three-person example before the participant's own situation: three different people who all just gave the same presentation all hear the exact same compliment afterward. The goal is only to set up that comparison -- do not introduce any other scenario (e.g. a job interview).",
      participantRationale: "Three people hearing the exact same words can react in completely different ways. Walking through their reactions makes it easier to see how a thought, not just what happened, shapes how someone feels and acts.",
      prompts: [
        {
          slug: "preview-candidates",
          type: "explanation",
          source: [75, 85],
          patientText: "Before we look at your own situation, I'd like to walk you through three different people in the exact same situation. It's much easier to see the pattern clearly on a neutral example first — and then your own situation becomes far simpler, and less overwhelming.",
          outputFields: ["threePersonPreviewComplete"],
        },
        {
          // Neutral Example vignette per this task's redesign brief: a
          // presentation scene, not the source manual's job-interview scene
          // -- same situation for all three people, only their automatic
          // thought differs. This departs from the source manual's literal
          // wording (sourceFidelityStatus becomes "structured_from_source",
          // not "exact") while keeping its Step 2 teaching point and
          // node/field structure -- see .claude/TASK_SCOPE.json's
          // note2026_08_17 entry for the full rationale.
          slug: "set-up-candidates",
          type: "instruction",
          source: [82, 85],
          patientText: "Imagine three people who each just finished giving a presentation. Afterward, someone says the exact same thing to all three of them: “That was a great presentation.”",
        },
      ],
    },
    {
      // Each person's flow is now just Emotion + Behavior (2 prompts, down
      // from 7-8 including a reaction/arrow cycle or a possibility-recheck
      // clarification branch). The automatic thought is stated by the
      // counselor in the same message that asks for the emotion, not
      // elicited from the participant -- see this task's redesign brief §8
      // ("생각은 상담사가 말해주고, 감정과 행동은 사용자가 스스로 생각해서
      // 답변"). candidateOneThought is still recorded, deterministically via
      // completionEffect, so the worksheet binding (worksheet-bindings/
      // tbct-s01.ts, out of scope) keeps showing it.
      slug: "first-candidate",
      title: "Step 2 - First Person",
      titleKo: "2단계 - 첫 번째 사람",
      type: "dialogue",
      source: [86, 92],
      requiredFields: ["candidateOneEmotion", "candidateOneBehavior"],
      restrictions: [sourceText([86, 92])],
      // See three-person-example's objective comment -- this range still
      // trails into leftover job-interview-vignette text ("interviewing the
      // first three candidates").
      objective: "The first person in the presentation example thought their presentation must have gone well. Ask what emotion and behavior would naturally follow from that specific thought, in the presentation scenario only.",
      prompts: [
        { slug: "candidate-one-emotion", type: "question", source: [86, 92], patientText: "The first person thought, “My presentation must have gone well.” What do you think they'd feel?", outputFields: ["candidateOneEmotion"], completionEffect: { type: "set_field", field: "candidateOneThought", value: "My presentation must have gone well." } },
        { slug: "candidate-one-behavior", type: "question", source: [86, 92], patientText: "And how do you think they'd behave?", outputFields: ["candidateOneBehavior"] },
      ],
    },
    {
      slug: "second-candidate",
      title: "Step 2 - Second Person",
      titleKo: "2단계 - 두 번째 사람",
      type: "dialogue",
      source: [93, 104],
      requiredFields: ["candidateTwoEmotion", "candidateTwoBehavior"],
      restrictions: [sourceText([93, 104])],
      // See three-person-example's objective comment -- this range's tail is
      // where the reported leak's "interviewer reaction" sentences live.
      objective: "The second person, in the exact same presentation situation, thought the compliment was probably just empty flattery. Ask what emotion and behavior would follow from THIS different thought, reinforcing that the same event produces a different feeling and behavior depending on the thought attached to it. Presentation scenario only -- no interviewer, no job application.",
      prompts: [
        { slug: "candidate-two-emotion", type: "question", source: [93, 104], patientText: "Now here's a second person. They thought, “That's probably just empty flattery.” What do you think they'd feel?", outputFields: ["candidateTwoEmotion"], completionEffect: { type: "set_field", field: "candidateTwoThought", value: "That's probably just empty flattery." } },
        { slug: "candidate-two-behavior", type: "question", source: [93, 104], patientText: "And how do you think they'd behave?", outputFields: ["candidateTwoBehavior"] },
      ],
    },
    {
      slug: "third-candidate",
      title: "Step 2 - Third Person",
      titleKo: "2단계 - 세 번째 사람",
      type: "dialogue",
      source: [105, 117],
      requiredFields: ["candidateThreeEmotion", "candidateThreeBehavior"],
      restrictions: [sourceText([105, 117])],
      // See three-person-example's objective comment -- this is the node the
      // reported leak's "interviewer reaction... reinforce the original
      // thought, keeping the whole cycle going" sentences came from verbatim.
      objective: "The third person, again in the exact same presentation situation, thought the compliment might have been sarcastic. Ask what emotion and behavior would follow from this third, still-different thought -- completing the three-way contrast the exercise is built on. Presentation scenario only -- no interviewer, no job application.",
      prompts: [
        { slug: "candidate-three-emotion", type: "question", source: [105, 117], patientText: "And a third person. They thought, “Are they being sarcastic?” What do you think they'd feel?", outputFields: ["candidateThreeEmotion"], completionEffect: { type: "set_field", field: "candidateThreeThought", value: "Are they being sarcastic?" } },
        { slug: "candidate-three-behavior", type: "question", source: [105, 117], patientText: "And how do you think they'd behave?", outputFields: ["candidateThreeBehavior"] },
      ],
    },
    {
      slug: "three-person-conclusion",
      title: "Step 2 - Three-Person Conclusion",
      titleKo: "2단계 - 세 사람 예시 정리",
      type: "summary",
      source: [118, 129],
      requiredFields: ["threePersonModelInsight"],
      restrictions: [sourceText([118, 129])],
      // See three-person-example's objective comment -- this range's head is
      // the third candidate's own leftover "interviewer reaction" sentences.
      objective: "Help the participant put into their own words what the three-person example showed: the same situation and the same words led to three different thoughts, and those thoughts -- not the situation itself -- produced three different feelings and behaviors. Then bridge back to the participant's own earlier situation and thought.",
      prompts: [
        // Merged the source's two-part observation ("what did you notice?"
        // then "what does that tell you?") into one question -- both wrote
        // the same field anyway, and completion is judged on whether the
        // participant grasped the concept in their own words, not on
        // matching either sentence verbatim (redesign brief §11).
        { slug: "three-person-insight", type: "question", source: [118, 129], patientText: "All three people heard the exact same words, but their thoughts were different — and that changed how they felt and what they did. What do you notice from that?", outputFields: ["threePersonModelInsight"] },
        // Now also names the thought captured in Phase 1C (openingInitialThought)
        // alongside the situation, so the bridge into Personal Re-application
        // doesn't need to re-ask either -- see the [their initial thought]
        // bracket added to runtime-static-message.ts.
        { slug: "return-to-personal-example", type: "transition", source: [118, 129], patientText: "Now, let's go back to what you mentioned earlier — [their situation], and the thought that came up: “[their initial thought]”. With what you've just seen, let's look at how that connects to your own emotion and behavior." },
      ],
    },
    {
      // Phase 4 "Return to Your Own Experience" (Opening redesign brief
      // §25-27): situation and thought are already captured (Phase 1B/1C
      // above) and just reflected back by return-to-personal-example, so
      // this node only asks for what is still genuinely missing --
      // Emotion, Behavior, Body -- mirroring the same 2-3 prompt pattern
      // already used for the Neutral Example candidates. Replaces the
      // previous 5-prompt "returning arrows" cycle (thought-to-emotion /
      // emotion-to-behavior / behavior-to-situation / situation-to-thought /
      // outcome-gap), which re-asked about the connection in the abstract
      // rather than asking for the participant's own emotion/behavior/body
      // directly -- the same kind of redundant re-ask this task's Neutral
      // Example pass already eliminated for candidates 2/3. outcome-gap's
      // activationCondition field (fearedOutcomeDidNotMaterialize) was never
      // set anywhere in the codebase (confirmed by repo-wide search) -- an
      // already-dead branch, not a loss of reachable behavior.
      slug: "personal-returning-arrows",
      title: "Step 3 - Returning to Your Own Experience",
      titleKo: "3단계 - 나의 경험으로 돌아오기",
      type: "dialogue",
      source: [130, 140],
      requiredFields: ["personalEmotion", "personalBehavior"],
      restrictions: [sourceText([130, 140])],
      prompts: [
        { slug: "personal-emotion", type: "question", source: [130, 140], patientText: "When you had that thought, what emotion did you feel?", outputFields: ["personalEmotion"] },
        { slug: "personal-behavior", type: "question", source: [130, 140], patientText: "And how did you behave, or what did you do, when you felt that?", outputFields: ["personalBehavior"] },
        { slug: "personal-body", type: "question", source: [130, 140], patientText: "Did you notice anything in your body in that moment — like your heart racing, or tension somewhere? Even something small is fine.", outputFields: ["personalBodySensations"] },
      ],
    },
    {
      slug: "participant-summary",
      title: "Step 4 - Participant Summary",
      titleKo: "4단계 - 참여자 요약",
      type: "summary",
      source: [141, 144],
      requiredFields: ["participantSummary"],
      prompts: [
        { slug: "participant-summary", type: "summary", source: [141, 144], marker: "Before we move on", patientText: "Before we move on, I'd like to ask you: in your own words, what did you notice or understand about how your thoughts, emotions, and behaviors connect in that situation?", outputFields: ["participantSummary"], validation: { kind: "participant_summary_required" } },
      ],
    },
    {
      // Registry-driven redesign (task's cognitive-distortions brief,
      // .claude/TASK_SCOPE.json's note2026_08_17d entry): no longer asks the
      // participant to have a physical distortions list on hand
      // (confirm-list / distortionListAvailable removed entirely -- that
      // gate blocked progression on an external prop this runtime has no way
      // to actually verify). identify-distortion's candidates are now
      // computed by runtime-orchestrator.ts from the S01-only
      // S01_COGNITIVE_DISTORTIONS registry (src/lib/protocol/sessions/
      // s01-cognitive-distortions.ts) -- Claude may only select ids that
      // exist in that registry, never invent or diagnose one; final
      // selection is left to the participant.
      slug: "cognitive-distortions",
      title: "Step 5 - Introducing Cognitive Distortions",
      titleKo: "5단계 - 인지 왜곡 소개",
      type: "question",
      source: [145, 155],
      requiredFields: ["participantSelectedDistortions"],
      restrictions: [sourceText([145, 155])],
      participantRationale: "Automatic thoughts often follow a handful of common patterns. Naming the pattern in your own thought makes it easier to question later, rather than just having it feel automatically true.",
      prompts: [
        {
          slug: "intro-distortions",
          type: "explanation",
          source: [145, 155],
          marker: "These negative automatic thoughts",
          patientText: "These negative automatic thoughts we've been looking at — they sometimes have a name in cognitive therapy. We call them cognitive distortions. Not every automatic thought is a distortion, but some of them are errors or exaggerations in our thinking that are worth examining.",
          outputFields: ["distortionsIntroductionAcknowledged"],
        },
        {
          // Candidate list (4-5 registry ids, each with a short
          // Claude-written relevanceReason) is computed dynamically by
          // runtime-orchestrator.ts's S01-only branch from
          // situationThoughtDistinction + openingInitialThought, and
          // registry-id-validated before it ever reaches this patientText.
          // The text below is only the last-resort static fallback if that
          // computation is entirely unavailable.
          slug: "identify-distortion",
          type: "question",
          source: [145, 155],
          marker: "Looking at what went through your mind",
          patientText: "Looking at what went through your mind in that situation — do any of these distortions seem to fit? It's fine if none of them feel like a match.",
          outputFields: ["participantSelectedDistortions"],
        },
        { slug: "meaning-of-distortion", type: "question", source: [145, 155], marker: "If you discovered that this thought", patientText: "If you discovered that this thought might be a cognitive distortion — a kind of error in thinking — what difference would that make?", outputFields: ["distortionMeaning"] },
      ],
    },
    {
      slug: "daily-observation-closing",
      title: "Step 6 - Closing the Session",
      titleKo: "6단계 - 세션 마무리",
      type: "session_complete",
      source: [156, 159],
      restrictions: [sourceText([160, 222])],
      terminal: true,
      prompts: [
        {
          slug: "daily-observation-practice",
          type: "worksheet_instruction",
          source: [156, 159],
          // §7.3 [신규 B-7]: "your therapist" assumes a role Protocol V9
          // Arm 3 (AI-Only) participants don't have. Neutralized to match
          // the participant manual's own arm-neutral phrasing ("study
          // clinician").
          patientText: "Before our next session, please practice noticing your automatic thoughts each day with the cognitive distortions list, using its personal-examples column. In a future session, we will introduce the Intrapersonal Thought Record to help you work with these thoughts more deeply. Thank you for your work today.",
          outputFields: ["dailyObservationPractice"],
          completionEffect: { type: "complete_session" },
        },
      ],
    },
  ],
};
