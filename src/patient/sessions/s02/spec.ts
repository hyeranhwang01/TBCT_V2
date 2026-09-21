import { sourceText } from "@/shared/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/shared/protocol/source-fidelity-catalog";

// S02 redesign, stage 1 (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions).
//
// This session used to be "Problems and Goals" (CCPH/CCGH). The real second
// counseling session, recorded 2026-09-18, was something else entirely: the
// participant's cognitive-distortion homework reviewed, then the fifteen
// distortion types walked one at a time with the participant's own example
// for each, then the CD-Quest filled in together. The transcript says 왜곡
// 41 times and 목표/척도/색상/총점 zero times. The book this protocol comes
// from (Oliveira 2015) agrees: its chapter 2 is "Introducing the Cognitive
// Distortions Questionnaire", and its own Table C1 puts CD-Quest at "every
// session from Session 2 on". CCPH/CCGH appears nowhere in that book.
//
// Stage 1 was the skeleton plus the fifteen-type walkthrough. Stage 2 added
// CD-Quest -- the frequency x intensity grid, the scoring loop, the total and
// the direction question -- between the walkthrough and the closing, which
// renumbered the closing node (n06 -> n10) and safety-pause (n07 -> n11).
//
// Division of labour, as in S01 (note2026_09_19_s01_task_intents): step
// order, completion, storage and safety live here; every word the participant
// hears is Claude's, from s02/task-intents.ts. s02/messages.ts holds only the
// deterministic fallback for when the model call cannot be made.
//
// MANUAL/CODE divergence, reported per .claude/rules/tbct-session-manual.md
// section 8: the RCT prompt manual has no CD-Quest section at all, so the
// distortion nodes below cite its S01 range [145, 155], where the fifteen-type
// list and the "never name a distortion for them" rule actually live. The
// manual is left unchanged.

const metadata: SessionSourceMetadata = {
  number: 2,
  id: "tbct-s02",
  title: "Cognitive Distortions",
  titleKo: "인지왜곡 유형",
  techniqueName: "Cognitive Distortions Questionnaire (CD-Quest)",
  acronym: "CD-Quest",
  sourceLineStart: 223,
  sourceLineEnd: 429,
  sourceSessionHash: "9703a52d23c715b044b7d7ab198d6eca39d0d8968a4520e7286afcd00f8e3e0b",
  contextRange: [230, 251],
  // Role, language and tone still come from this session's own header, which
  // is technique-agnostic and still what we want: "warm, conversational tone
  // -- like a knowledgeable friend", "Ask only ONE question at a time",
  // "Never interpret or judge what the participant shares".
  roleRange: [230, 239],
  languageRange: [230, 239],
  openingRange: [250, 261],
  // Changed from the CCPH/CCGH steps [263, 387] to the cognitive-distortions
  // range, which is what this session now does. See the divergence note above.
  requiredActionsRange: [145, 155],
  restrictionsRange: [388, 429],
  safetyRange: [411, 429],
};

const CRISIS = ["TBCT-S02-CRISIS-PAUSE"];

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "opening",
      title: "Opening",
      titleKo: "도입",
      type: "session_start",
      source: [250, 261],
      requiredFields: ["sessionOpeningAcknowledged"],
      safetyRuleIds: CRISIS,
      // 00:00-01:00 of the recording: a greeting, then the ground the last
      // session covered, then straight into the homework. No question here --
      // the homework review is the program's next node.
      objective:
        "Open as in the real second session: greet them warmly, say it is good to see them again, and recall in one or two sentences what the last session covered -- how a situation sets off a thought, and how that thought reaches feelings, behaviour and the body, and that you introduced the fifteen patterns a thought can be distorted into at the end. Ask nothing at all: the program's next message asks about the practice.",
      prompts: [
        {
          slug: "greeting-recap",
          type: "opening",
          source: [250, 254],
          completionEffect: { type: "record_opening_acknowledgement" },
          // English avoids the word "model": isPatientSafeFallbackText rejects
          // /\bmodels?\b/ (runtime-release-normalizer.ts) and would swap this
          // whole sentence for the content-free generic line.
          patientText:
            "Good to see you again. Last time we looked at how thoughts work -- how a situation sets off a thought, and how that thought reaches your feelings, your behaviour and your body -- and at the end we looked at the fifteen patterns a thought can be distorted into.",
        },
      ],
    },
    {
      slug: "homework-review",
      title: "Homework Review",
      titleKo: "과제 리뷰",
      type: "question",
      source: [255, 261],
      requiredFields: ["homeworkReport"],
      safetyRuleIds: CRISIS,
      // 01:00-02:30. The participant reported the difficulty herself ("I
      // couldn't tell which of the fifteen categories an example belonged
      // to"), and the counselor normalized it rather than treating it as a
      // wrong answer. That normalization is its own step because it must not
      // be skipped when the difficulty comes up, and must not be said when it
      // does not.
      objective:
        "Ask how the week's practice went -- what they wrote in the 'my examples' column of the fifteen-pattern list, and how it went for them. Take whatever they say; do not grade it and do not correct which pattern an example belongs to.",
      prompts: [
        {
          slug: "homework-update",
          type: "question",
          source: [255, 261],
          outputFields: ["homeworkReport"],
          patientText: "How did the practice go this week? Were you able to write any examples in the list, and how was it for you?",
        },
        {
          // Fires only when the participant says the types were hard to tell
          // apart (s02TypeConfusion, set in s02/turn-rules.ts). Asks nothing.
          slug: "normalize-overlap",
          type: "explanation",
          source: [255, 261],
          activationCondition: { field: "s02TypeConfusion", operator: "equals", value: true },
          patientText:
            "That happens to most people, and it is not a mistake. The fifteen patterns overlap, and one example can belong to two or three of them at once -- you do not have to place it in exactly one.",
        },
      ],
    },
    {
      slug: "agenda",
      title: "Today's Order",
      titleKo: "오늘의 순서",
      type: "orientation",
      source: [250, 261],
      requiredFields: ["sessionAgendaAgreed"],
      safetyRuleIds: CRISIS,
      // 02:30-03:10. The counselor takes the difficulty the participant just
      // reported and turns it into today's plan, then asks whether that is
      // all right -- "괜찮으세요? 이렇게 진행하시는 거?". A no is heard, not
      // ignored, exactly as in S01's opening (note2026_09_19_s01_opening_intro).
      objective:
        "Walk them through today's order -- going through the fifteen patterns one at a time and finding an example of their own for each -- and ask whether it is all right to go this way. Connect it to what they just said about the practice if they raised a difficulty.",
      prompts: [
        {
          slug: "today-agenda",
          type: "question",
          source: [250, 261],
          outputFields: ["sessionAgendaAgreed"],
          validation: { kind: "boolean" },
          patientText:
            "Today I'd like to go through those fifteen patterns one at a time, and for each one see whether you have an example of your own. Is it all right with you to go this way?",
        },
        {
          slug: "agenda-concern",
          type: "question",
          source: [250, 261],
          outputFields: ["sessionAgendaConcern"],
          activationCondition: { field: "s02AgendaDeclined", operator: "equals", value: true },
          patientText: "That's all right -- thank you for telling me. What about it doesn't feel right to you? Please tell me in your own way.",
        },
        {
          slug: "agenda-continue",
          type: "question",
          source: [250, 261],
          outputFields: ["sessionAgendaContinue"],
          validation: { kind: "boolean" },
          activationCondition: { field: "s02AgendaDeclined", operator: "equals", value: true },
          patientText:
            "Thank you for telling me. Today you can go at your own pace, share only as much as you want, and stop at any time. Would you like to go on with today's session?",
        },
        {
          slug: "agenda-stop",
          type: "instruction",
          source: [250, 261],
          completionEffect: { type: "pause_session" },
          activationCondition: { field: "s02SessionDeclined", operator: "equals", value: true },
          patientText: "All right, let's stop here for today. Thank you for telling me. Whenever you'd like to continue, you can pick up from here.",
        },
      ],
    },
    {
      slug: "rationale",
      title: "Why We Look at These",
      titleKo: "왜 살펴보는지",
      type: "orientation",
      source: [145, 155],
      requiredFields: ["distortionConceptAcknowledged"],
      safetyRuleIds: CRISIS,
      restrictions: [sourceText([145, 155])],
      // 03:10-05:00. Three things, none of which asks a question: what a
      // cognitive distortion is, the research behind looking at them, and
      // that this same list is used later when core beliefs are worked on.
      objective:
        "Before the walkthrough, say three things and ask nothing: what a cognitive distortion is (a thought pattern that is unhelpful, out of balance, or not based on much evidence -- not every thought is one), what the research shows, and that this same list comes back later when deeper patterns are worked on.",
      prompts: [
        {
          slug: "distortion-concept",
          type: "explanation",
          source: [145, 149],
          outputFields: ["distortionConceptAcknowledged"],
          patientText:
            "Not every thought that goes through our minds is wrong. But some of them are unhelpful, or out of balance, or not really based on evidence -- and those are what we call cognitive distortions.",
        },
        {
          // The plain-language source the user asked for. It is a
          // CORRELATIONAL study: s02/task-intents.ts forbids the causal
          // reading ("lowering the score lowers depression") that the
          // recording slips into.
          slug: "research-evidence",
          type: "explanation",
          source: [145, 155],
          patientText:
            "In a study at the Federal University of Bahia in Brazil with 184 university students, people who had these thought patterns more often and more strongly also scored higher on depression and anxiety.",
        },
        {
          slug: "future-use",
          type: "explanation",
          source: [145, 155],
          patientText: "This same list comes back later on, when we look at the deeper patterns underneath these thoughts.",
        },
      ],
    },
    {
      slug: "distortion-walkthrough",
      title: "The Fifteen Patterns, One at a Time",
      titleKo: "15가지 유형 하나씩",
      type: "question",
      source: [145, 155],
      requiredFields: ["distortionExamples"],
      safetyRuleIds: CRISIS,
      restrictions: [sourceText([145, 155])],
      participantRationale:
        "Seeing each pattern next to an example from your own week is what makes it recognizable later, when the thought is actually happening.",
      // 05:00-43:00 -- two thirds of the real session. One turn per type, in
      // the registry's order (shared/protocol/cognitive-distortions.ts), which
      // is the order the recording used. The per-type wording is composed in
      // s02/messages.ts from the registry, so nothing here hardcodes fifteen
      // explanations.
      // Each pattern takes at least two turns, as the recording did: ask, then
      // talk about the answer. s02/turn-rules.ts holds which of the two the loop
      // is on (s02PatternPhase) and only advances to the next pattern once the
      // discussion is done, so the discussion is a turn of its own rather than
      // something squeezed onto the end of the next pattern's explanation. The
      // discussion runs one turn unless the participant keeps giving content
      // instead of agreeing, in which case it follows them for up to three --
      // the shape of the overgeneralization exchange at 578-596 of the
      // transcript.
      objective:
        "Go through the fifteen patterns one at a time, in the order the program gives them. Each pattern takes at least two turns: first say what the pattern is in your own words, give one short everyday example of it, and ask whether they have one of their own; then, once they answer, talk about what they said before the next pattern. Never suggest an example for them, and never file their example under a different pattern -- what you may change is which of their own examples fills this pattern, never which pattern it belongs to.",
      prompts: [
        {
          slug: "review-distortion",
          type: "question",
          source: [145, 155],
          // A scratch scalar, not the accumulated list: a field named in
          // outputFields is overwritten with the raw answer text by the shared
          // extraction, and the two-turn rhythm needs the list and the pointer
          // to be owned by s02/turn-rules.ts alone (same reason as
          // cdQuestItemScore in the scoring loop).
          outputFields: ["distortionTurnAnswer"],
          // Patient-facing text is composed per type in s02/messages.ts
          // (currentDistortionName / currentDistortionIndex). This text is the
          // last-resort fallback only, which is why it names no type.
          patientText: "Do you have an example of your own for this pattern? It's fine if none comes to mind.",
          executionMode: "repeat_until",
          // The budget is per TURN, not per pattern: runtime-state-reducer.ts
          // counts accepted patient turns. Worst case is four turns on a pattern
          // (one ask plus the three the discussion may run to), so fifteen
          // patterns can spend sixty, and a re-ask can spend more. The
          // eight-session audit measures exactly sixty here, because its
          // synthetic participant answers every discussion turn with something
          // substantive; a real one mostly agrees and the walkthrough is nearer
          // thirty. Generous on purpose -- completionCondition is what actually
          // ends the loop, while reaching this cap force-completes it and would
          // silently cut the walkthrough short with nothing reported anywhere.
          maxIterations: 80,
          completionCondition: { kind: "field", field: "allDistortionsReviewed", operator: "equals", value: true },
        },
      ],
    },
    {
      slug: "cdquest-intro",
      title: "The CD-Quest Grid",
      titleKo: "CD-Quest 기준 설명",
      type: "orientation",
      source: [145, 155],
      requiredFields: ["cdQuestScaleUnderstood"],
      safetyRuleIds: CRISIS,
      // 43:00-44:00. Frequency and intensity, each in three bands, read off a
      // grid. The numbers themselves are pinned by mustMention in
      // s02/task-intents.ts -- the wording is Claude's, the bands are not.
      objective:
        "Introduce how each pattern gets a score: how often it showed up this past week, and how strongly it was believed in the moment it occurred. Give both sets of bands, then check the bands make sense to them. Do not score anything yet and do not compute a score for them.",
      prompts: [
        {
          slug: "cdquest-explain",
          type: "explanation",
          source: [145, 155],
          outputFields: ["cdQuestScalePresented"],
          patientText:
            "For each of the fifteen patterns we'll put down two things. First, how often it came up this past week: once or twice, three to five days, or six to seven days. Second, how strongly you believed it at the moment it happened: a little (up to 30%), quite strongly (31-70%), or very strongly (over 70%). The two together give the pattern a score from 0 to 5.",
        },
        {
          slug: "understanding-check",
          type: "question",
          source: [145, 155],
          outputFields: ["cdQuestScaleUnderstood"],
          validation: { kind: "boolean" },
          patientText: "Does that make sense so far? If anything is unclear I'll go through it again.",
        },
      ],
    },
    {
      slug: "cdquest-scoring",
      title: "Scoring Each Pattern",
      titleKo: "유형별 채점",
      type: "assessment",
      source: [145, 155],
      requiredFields: ["cdQuestScores"],
      safetyRuleIds: CRISIS,
      // 44:00-49:00. The recording asked frequency, waited, then asked
      // intensity -- two turns per pattern. A repeat_until loop runs ONE prompt
      // per iteration, so two prompts cannot alternate fifteen times inside one
      // node (the same constraint that removed why-distorted in stage 1). This
      // prompt asks for both in one turn; when only one half arrives the field
      // stays missing and the same pattern is asked again, for the missing half
      // only (s02/dialogue-guidance.ts says so).
      objective:
        "Score the fifteen patterns one at a time, in the order the program gives them. For each, ask how often it came up this past week and how strongly it was believed, and take the score from those two -- never decide the score yourself. A participant who answers with a score directly is giving a complete answer.",
      prompts: [
        {
          slug: "score-distortion",
          type: "rating",
          source: [145, 155],
          // The turn answers ONE item, so that is the output field. The
          // accumulated list lives in cdQuestScores, which s02/turn-rules.ts
          // owns outright: a field named in outputFields is overwritten with
          // the raw answer text by the shared extraction (runtime-context.ts,
          // the expectedFields.length === 1 branch), which would wipe the list
          // every turn. Keeping the list out of outputFields keeps it intact.
          outputFields: ["cdQuestItemScore"],
          validation: { kind: "cdquest_item_score", min: 0, max: 5 },
          // Composed per pattern in s02/messages.ts, like the walkthrough.
          patientText: "For this pattern: how often did it come up this past week, and how strongly did you believe it at the time?",
          executionMode: "repeat_until",
          maxIterations: 15,
          completionCondition: { kind: "field", field: "allDistortionsScored", operator: "equals", value: true },
        },
      ],
    },
    {
      slug: "cdquest-total",
      title: "Total and What It Means",
      titleKo: "총점과 의미",
      type: "assessment",
      source: [145, 155],
      requiredFields: ["cdQuestReflection"],
      safetyRuleIds: CRISIS,
      // 49:00-51:00. The total is spoken, not asked -- s02/turn-rules.ts wrote
      // it when the fifteenth score landed. "There is no cut-off" is the
      // counselor's own framing at 49:20 and is pinned by mustMention.
      objective:
        "Say the total and what it does and does not mean: it is not a grade and there is no cut-off score. Then ask what they make of it. Do not interpret it for them and do not tell them which patterns to work on -- the next step asks them.",
      prompts: [
        {
          slug: "total",
          type: "explanation",
          source: [145, 155],
          patientText: "Adding those up gives your total. There is no cut-off here and no good or bad total -- it is a snapshot of this past week, and the starting point you'll measure change from.",
        },
        {
          slug: "how-do-you-feel",
          type: "question",
          source: [145, 155],
          outputFields: ["cdQuestReflection"],
          // "어떤 생각이 드세요", not "어떠세요": the latter collides letter for
          // letter with the closing recap's feedback ban pattern.
          patientText: "Looking at this, what thoughts come up for you?",
        },
        {
          // 50:10 of the recording: the participant said she had taken the
          // anxiety as something she was simply born with. The counselor
          // separated what is inborn from what was learned. Fires only on that
          // signal (s02InnateAttribution, set in s02/turn-rules.ts).
          slug: "innate-vs-learned",
          type: "explanation",
          source: [145, 155],
          activationCondition: { field: "s02InnateAttribution", operator: "equals", value: true },
          patientText:
            "Some of what we are is simply how we were born, and that is not something we chose. But a habit of thinking is different -- nobody is born deciding to blame themselves. It is learned over time, which is also why it can change.",
        },
      ],
    },
    {
      slug: "direction",
      title: "What to Work On",
      titleKo: "조정할 방향",
      type: "question",
      source: [145, 155],
      requiredFields: ["cdQuestPriorityTypes"],
      safetyRuleIds: CRISIS,
      // 51:40. The participant names which patterns to adjust -- emotional
      // reasoning, overgeneralizing, what-if. The guide never picks for them.
      objective:
        "Ask which of the patterns they would want to work on adjusting. They choose; never pick for them and never rank the list yourself.",
      prompts: [
        {
          slug: "what-to-adjust",
          type: "question",
          source: [145, 155],
          outputFields: ["cdQuestPriorityTypes"],
          validation: { kind: "array" },
          patientText: "Of these patterns, which ones would you want to work on adjusting?",
        },
      ],
    },
    {
      slug: "closing",
      title: "Recap, Practice and Closing",
      titleKo: "요약 · 과제 · 마무리",
      type: "session_complete",
      source: [388, 429],
      requiredFields: ["homeworkCommitment"],
      safetyRuleIds: CRISIS,
      terminal: true,
      // The recording's order, which differs from S01's: the recap comes
      // BEFORE the homework here (52:50-53:30), where in the first session it
      // came after. Each session follows its own recording. The feedback
      // request that follows in the recording is deliberately left out, as in
      // S01 (note2026_09_21_s01_closing_recap).
      objective:
        "Close the session: recap what today covered, give this week's practice, check they can do it, say what comes next, and say goodbye. Never ask for feedback about the session or about you.",
      prompts: [
        {
          // The counselor's own look back. Recaps what was DONE and names
          // none of the participant's answers -- the recording names no
          // example of hers in the recap. Asks nothing, stores nothing.
          // source is [388, 390], not the node's [388, 429]: the wider range
          // is the CCPH/CCGH closing script, which this session no longer does.
          slug: "session-recap",
          type: "closing",
          source: [388, 390],
          patientText:
            "Here is what we did today. We looked at the practice you did over the week, then went through the fifteen patterns one at a time finding where each one shows up for you, and then scored each one for how often it came up and how strongly you believed it.",
        },
        {
          // Stage 1 practice: the S01 homework continued. Stage 2 replaces
          // this with the blank CD-Quest form the recording hands out.
          slug: "homework-assignment",
          type: "worksheet_instruction",
          source: [388, 390],
          outputFields: ["dailyObservationPractice"],
          // 53:30: a blank CD-Quest form -- write the examples AND score them,
          // so next time the two weeks can be compared.
          patientText:
            "This week, fill in a blank copy of this same form. Whenever one of these thoughts comes up, write a short example in the 'my examples' column, and at the end of the week score each pattern the way we did today. We'll compare it with today's next time.",
        },
        {
          slug: "homework-commitment",
          type: "question",
          source: [388, 390],
          outputFields: ["homeworkCommitment"],
          validation: { kind: "boolean" },
          patientText: "Do you think you can do that?",
        },
        {
          // 55:00-57:00: the three levels of cognition, named as what comes
          // next. Named only -- not taught here.
          slug: "next-preview",
          type: "closing",
          source: [388, 390],
          patientText:
            "Next time we'll go one level deeper. The thoughts that pass through a situation are the first level; underneath them sit the assumptions and rules we live by, and deeper still the long-held beliefs about ourselves that shape both.",
        },
        {
          slug: "goodbye",
          type: "closing",
          source: [388, 390],
          completionEffect: { type: "complete_session" },
          patientText: "Thank you for sharing today. See you next time.",
        },
      ],
    },
    {
      // Same shape as S03-S08's safety node. Reached by the safety edges
      // below, whose `crisisSignal` condition is really set by
      // runtime-context.ts when a current risk disclosure is detected.
      slug: "safety-pause",
      title: "Safety Pause and Escalation",
      titleKo: "안전을 위한 일시 중지 및 보고",
      type: "clinician_escalation",
      source: [411, 429],
      safetyRuleIds: CRISIS,
      terminal: true,
      prompts: [
        {
          slug: "pause-and-escalate",
          type: "instruction",
          source: [411, 429],
          outputFields: ["safetyEscalation"],
          completionEffect: { type: "pause_session" },
          safetyRuleIds: CRISIS,
        },
      ],
    },
  ],
  // One safety edge per node the participant speaks in: without these the
  // graph has no path to safety-pause at all (same reasoning as s03).
  extraEdges: [
    { sourceSlug: "opening", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "homework-review", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "agenda", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "rationale", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "distortion-walkthrough", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "cdquest-intro", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "cdquest-scoring", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "cdquest-total", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "direction", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
    { sourceSlug: "closing", targetSlug: "safety-pause", edgeType: "safety", source: [411, 429], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 0 },
  ],
};
