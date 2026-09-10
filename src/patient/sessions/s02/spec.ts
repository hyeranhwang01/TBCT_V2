import { sourceText } from "@/lib/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/lib/protocol/source-fidelity-catalog";

const metadata: SessionSourceMetadata = {
  number: 2,
  id: "tbct-s02",
  title: "Problems and Goals",
  titleKo: "문제와 목표",
  techniqueName: "Color-Coded Problem Hierarchy (CCPH) / Color-Coded Goals/Aspirations Hierarchy (CCGH)",
  acronym: "CCPH / CCGH",
  sourceLineStart: 223,
  sourceLineEnd: 429,
  sourceSessionHash: "9703a52d23c715b044b7d7ab198d6eca39d0d8968a4520e7286afcd00f8e3e0b",
  contextRange: [230, 251],
  roleRange: [230, 239],
  languageRange: [230, 239],
  openingRange: [250, 261],
  requiredActionsRange: [263, 387],
  restrictionsRange: [388, 429],
  safetyRange: [411, 429],
};

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "opening",
      title: "Opening",
      titleKo: "도입",
      type: "session_start",
      source: [250, 261],
      requiredFields: ["openingMode"],
      prompts: [
        // §5.5 [신규 N-4]: without this condition, first-session-opening had
        // no activationCondition at all, so it stayed a candidate even for a
        // returning participant -- both prompts write openingMode, so
        // whichever one the scan reached could double-fire the opening.
        // not_equals:true (not equals:false) deliberately, because
        // returningParticipant is never explicitly seeded anywhere in this
        // codebase -- it's `undefined` for the overwhelming majority of
        // sessions (new participants), and `undefined === false` is false,
        // which would have skipped this prompt for every new participant
        // too (caught by manually tracing which prompt fires, not by the
        // structural completion tests, which don't check *which* message
        // was shown).
        // 세션로그 §9-2/§12-2 [P0]: opening 노드 4개 전부 patientText 없이
        // marker만 있어서 세션 첫 발화부터 generic fallback이었다. verbatim 복원.
        // P0-3 (정상 발화 오인 수정): this prompt is a one-way welcome with no
        // question asked -- the real elicitation happens in elicit-problems
        // below. outputFields: ["openingMode"] previously made this an
        // input-required prompt (generic outputFields.length > 0 fallback in
        // promptRequiresPatientInput), so a participant's "네" was rejected
        // as a non-answer and looped toward invalid-answer clarification.
        // openingMode only ever served as a which-opening-fired marker (see
        // the comment above), so record it deterministically instead of
        // waiting on a patient answer that was never actually being asked for.
        { slug: "first-session-opening", type: "opening", source: [250, 261], marker: "Hi! I'm here to help you map out", patientText: "Hi! I'm here to help you map out what's been on your mind lately — both the challenges you're facing and the goals you'd like to work toward. There are no right or wrong answers here — just share whatever feels most true for you right now.", activationCondition: { field: "returningParticipant", operator: "not_equals", value: true }, completionEffect: { type: "set_field", field: "openingMode", value: "first_session" } },
        { slug: "returning-opening", type: "opening", source: [250, 261], marker: "Welcome back", patientText: "Welcome back. Before we dive in today, I just want to check in — is there anything from our last session that's still on your mind? Something that came up that you'd like to bring forward, or anything you'd like to revisit?", activationCondition: { field: "returningParticipant", operator: "equals", value: true }, outputFields: ["openingMode"] },
        { slug: "between-session-bridge", type: "follow_up", source: [250, 261], marker: "How did that go", patientText: "How did that go for you? Were you able to use it during the week, and did it change anything for you?", activationCondition: { field: "returningParticipant", operator: "equals", value: true }, outputFields: ["betweenSessionWork"] },
        { slug: "assessment-transition", type: "transition", source: [250, 261], marker: "It's great to hear", patientText: "It's great to hear that. Let's now take a look at where things stand for you today — both the challenges you're facing and the goals you're working toward.", activationCondition: { field: "returningParticipant", operator: "equals", value: true } },
      ],
    },
    {
      slug: "elicit-problems",
      title: "Step 1 - Elicit Problems",
      titleKo: "1단계 - 문제 이끌어내기",
      type: "question",
      source: [263, 279],
      requiredFields: ["problems"],
      restrictions: [sourceText([263, 279])],
      participantRationale: "Naming problems clearly, one at a time, makes it possible to track and work on each one instead of feeling weighed down by everything at once.",
      prompts: [
        // 세션로그 §9-2 [P0]: elicit-problems 노드 7/7 전부 누락 -- 세션의
        // 본체(문제 수집)가 백지였다. verbatim 전체 복원.
        { slug: "problem-framing", type: "question", source: [263, 279], marker: "Over the next five or six months", patientText: "Over the next five or six months, as we work together in therapy, what are the five most important problems or difficulties that — if we resolve them — will leave you feeling well? What would you like to breathe from? To be free from?", outputFields: ["problems"], validation: { kind: "array", minItems: 1, maxItems: 5 } },
        // Real-runtime reproduction (see .claude/TASK_SCOPE.json's
        // note2026_08_17g entry): "더 생각나는 건 없어요" correctly set
        // problemsNoMore=true (runtime-context.ts's isNoMoreEvidence) but
        // nothing here ever READ that flag, so the four remaining follow-up
        // prompts below kept firing regardless -- a participant who clearly
        // said "that's everything" was still asked four more "anything at
        // home? at work? avoiding anything?" questions before the node would
        // move on. Each follow-up now skips once the participant has said
        // there's nothing more.
        { slug: "problem-home-work-relationships", type: "follow_up", source: [263, 279], marker: "Is there anything going on at home", patientText: "Is there anything going on at home, at work, or in your relationships that's been weighing on you?", activationCondition: { field: "problemsNoMore", operator: "not_equals", value: true }, outputFields: ["problems"] },
        { slug: "problem-avoidance", type: "follow_up", source: [263, 279], marker: "Are there things you've been avoiding", patientText: "Are there things you've been avoiding or worrying about lately?", activationCondition: { field: "problemsNoMore", operator: "not_equals", value: true }, outputFields: ["problems"] },
        { slug: "problem-therapy-goal", type: "follow_up", source: [263, 279], marker: "What brought you to therapy", patientText: "What brought you to therapy, or what would you most like to change?", activationCondition: { field: "problemsNoMore", operator: "not_equals", value: true }, outputFields: ["problems"] },
        { slug: "problem-forward-importance", type: "follow_up", source: [263, 279], marker: "Think about what's affecting you", patientText: "Think about what's affecting you most right now — and also things in your life that, if resolved, would really make a difference.", activationCondition: { field: "problemsNoMore", operator: "not_equals", value: true }, outputFields: ["problems"] },
        // Real-runtime reproduction: this is a passive acknowledgment of the
        // problem the PREVIOUS turn already added ("Got it -- I'll add that
        // to your list."), not a new question -- it asks nothing. outputFields:
        // ["problems"] previously combined with type "confirmation" being
        // unconditionally input-required (see promptRequiresPatientInput's
        // PASSIVE_ACKNOWLEDGMENT_PROMPT_IDS exception, added for this exact
        // id) to make the runtime wait for a fresh "problems" answer here,
        // rejecting a plain "네" as filler. Removed since this prompt never
        // legitimately produces a NEW problems entry -- the entry it's
        // acknowledging was already written by whichever prompt preceded it.
        { slug: "problem-confirmation", type: "confirmation", source: [263, 279], marker: "Got it", patientText: "Got it — I'll add that to your list.", activationCondition: { field: "problemsNoMore", operator: "not_equals", value: true } },
        { slug: "problem-reframe", type: "clarification", source: [263, 279], marker: "That sounds really hard", patientText: "That sounds really hard. Just so we can track this in a way that's useful — would it help to frame it as something like 'how I'm coping with [situation]'? That way we can track your own journey through it, even if the situation itself is outside your control. Does that feel right?", activationCondition: { field: "problemOutsideParticipantControl", operator: "equals", value: true }, outputFields: ["problemFraming"] },
      ],
    },
    {
      slug: "hidden-problems",
      title: "Step 1b - X, Y, Z Strategy",
      titleKo: "1-1단계 - X, Y, Z 전략",
      type: "question",
      source: [280, 293],
      requiredFields: ["privateProblemPlaceholders"],
      restrictions: [sourceText([280, 293])],
      prompts: [
        { slug: "offer-private-placeholders", type: "question", source: [280, 293], marker: "Before we move on to rating your problems", outputFields: ["privateProblemPlaceholders"], validation: { kind: "private_placeholder_labels", allowed: ["X", "Y", "Z"] } },
        { slug: "acknowledge-private-placeholder", type: "confirmation", source: [280, 293], marker: "Thank you for letting me know", patientText: "Thank you for letting me know it's there. That takes courage too. We'll track it alongside the others, and you can choose to share more about it whenever — or if ever — you feel ready.", activationCondition: { field: "privateProblemAdded", operator: "equals", value: true } },
        // §5.6 [신규 B-10]: node requires privateProblemPlaceholders, which
        // would otherwise stay unset (and the node stuck) when the
        // participant declines -- an explicit empty array records "declined"
        // as a real, complete answer.
        { slug: "continue-without-placeholder", type: "transition", source: [280, 293], marker: "Of course", patientText: "Of course — that's perfectly fine. Let's go ahead.", activationCondition: { field: "privateProblemAdded", operator: "equals", value: false }, completionEffect: { type: "set_field", field: "privateProblemPlaceholders", value: [] } },
      ],
    },
    {
      slug: "problem-scale",
      title: "Step 2 - Problem Scale",
      titleKo: "2단계 - 문제 척도",
      type: "assessment",
      source: [294, 313],
      requiredFields: ["problemScalePresented"],
      restrictions: [sourceText([294, 313])],
      participantRationale: "Rating each problem helps us see which ones matter most right now, so we know where to focus first.",
      prompts: [
        // P0-4 (정상 발화 오인 수정): these are real yes/no questions ("Do you
        // have the card...?", "Does that distinction make sense?") but had no
        // validation.kind, so "네"/"아니요" fell through to the generic
        // filler-word rejection (NON_ANSWER_TEXT includes "네") instead of
        // being recognized as the complete answer. validation.kind: "boolean"
        // reuses the existing yes/no acceptance path (parseBooleanInput
        // already accepts 네/예/응/아니/아니요) and, for
        // discomfort-distress-distinction, also correctly makes the prompt
        // wait for the participant's confirmation instead of auto-advancing
        // past an unanswered comprehension check (validation.kind: "boolean"
        // is in PASSIVE_TYPE_REAL_ANSWER_VALIDATION_KINDS).
        { slug: "rating-card-check", type: "question", source: [294, 313], marker: "Do you have the rating scale card", patientText: "Do you have the rating scale card in front of you right now?", outputFields: ["problemScaleCardAvailable"], validation: { kind: "boolean" } },
        { slug: "six-anchor-problem-scale", type: "instruction", source: [294, 313], marker: "Now I'll ask you to rate each problem", outputFields: ["problemScalePresented"], validation: { kind: "exact_scale_anchors", min: 0, max: 5 } },
        { slug: "discomfort-distress-distinction", type: "explanation", source: [294, 313], marker: "Notice something important about this scale", outputFields: ["problemScaleDistinctionAcknowledged"], validation: { kind: "boolean" } },
      ],
    },
    {
      slug: "rate-problems",
      title: "Step 3 - Rate Each Problem",
      titleKo: "3단계 - 각 문제 평가하기",
      type: "assessment",
      source: [314, 318],
      requiredFields: ["problemRatings"],
      // §5.8 (regression guard): "the guide keeps your earlier numbers
      // hidden so today's rating stays fresh... old scores can quietly pull
      // new ones toward them." No prior-score field exists in this catalog
      // to leak, but this restriction records the requirement so a future
      // re-rating feature doesn't reintroduce anchoring.
      restrictions: [sourceText([314, 318]), "Do not reference or reveal any earlier rating for a problem while it is being re-rated."],
      prompts: [
        {
          slug: "reflect-problem-score",
          type: "rating",
          source: [314, 318],
          marker: "Thank you. So [problem / X / Y / Z] is a [score]",
          outputFields: ["problemRatings"],
          validation: { kind: "rating", min: 0, max: 5, includeColor: true },
          // Re-asks this same prompt once per listed problem instead of
          // stopping after a single rating, so every problem the participant
          // named actually gets its own score. Patient-facing text is
          // supplied dynamically by contextualPatientText in
          // runtime-static-message.ts (reflectThenAskForNextRating) --
          // this marker was previously missing its closing "]", which
          // left the [problem/score/color] bracket template as the
          // resolved verbatimText and made the runtime-release-normalizer
          // fallback generator produce a garbled "Thank you. So [problem,
          // what comes to mind for you?" instead.
          executionMode: "repeat_until",
          maxIterations: 5,
          completionCondition: { kind: "field", field: "allProblemsRated", operator: "equals", value: true },
        },
        { slug: "acknowledge-distress", type: "reflection", source: [314, 318], marker: "That sounds really hard. I appreciate", patientText: "That sounds really hard. I appreciate you sharing that. Those are exactly the kinds of things we'll want to focus on.", activationCondition: { field: "currentProblemScore", operator: "in", value: [4, 5] } },
        { slug: "acknowledge-manageable", type: "reflection", source: [314, 318], marker: "That's good to hear", activationCondition: { field: "currentProblemScore", operator: "in", value: [0, 1] } },
        { slug: "score-clarification", type: "clarification", source: [314, 318], marker: "When you think about it as", patientText: "When you think about it as [description of lower score] versus [description of higher score] — which one feels truer to you right now?", activationCondition: { field: "currentProblemScoreUncertain", operator: "equals", value: true } },
      ],
    },
    {
      slug: "problem-summary",
      title: "Step 4 - Problem Summary and Distress Count",
      titleKo: "4단계 - 문제 요약 및 고통 지수",
      type: "assessment",
      source: [319, 333],
      requiredFields: ["totalProblemScore", "yellowRedProblemsCount"],
      restrictions: [sourceText([319, 333])],
      prompts: [
        { slug: "problem-total", type: "summary", source: [319, 333], marker: "Your total problem score today", outputFields: ["totalProblemScore", "yellowRedProblemsCount"], validation: { kind: "calculated_problem_totals" } },
        // arm-중립화: 원문의 "Your therapist will use a color-coded graph"를
        // "A color-coded graph"로 중립화 (§7.3 원칙과 동일).
        { slug: "problem-total-personal", type: "reflection", source: [319, 333], marker: "This number is very personal", patientText: "This number is very personal to you — it reflects exactly where you are right now, and there is no right or wrong total. What matters is that we'll track this score over time, and as you make progress, you'll see this number change. A color-coded graph alongside these scores will help show those reds and yellows shifting toward greens and blues." },
        { slug: "transition-to-goals", type: "transition", source: [319, 333], marker: "You've done really well", patientText: "You've done really well. Now let's look at the other side — what you'd love to work toward. Sometimes thinking about our goals can feel just as challenging as thinking about our problems, and that's completely okay." },
      ],
    },
    {
      slug: "elicit-goals",
      title: "Step 6 - Elicit Goals",
      titleKo: "6단계 - 목표 이끌어내기",
      type: "question",
      source: [334, 350],
      requiredFields: ["goals"],
      restrictions: [sourceText([334, 350])],
      participantRationale: "Naming what you're working toward, not just what's wrong, gives therapy a direction to move in rather than only a list of things to fix.",
      prompts: [
        // 세션로그 §9-2 [P0]: elicit-goals 노드 7/8 누락 -- verbatim 전체 복원.
        { slug: "goal-framing", type: "question", source: [334, 350], marker: "Over the next five or six months, if therapy goes really well", patientText: "Over the next five or six months, if therapy goes really well — what are the five most important goals or aspirations you'd like to achieve? What would make you feel more fulfilled, healthier, or happier?", outputFields: ["goals"], validation: { kind: "array", minItems: 1, maxItems: 5 } },
        // Same fix as elicit-problems above: skip the remaining follow-ups
        // once the participant has said there's nothing more (goalsNoMore).
        { slug: "goal-life-change", type: "follow_up", source: [334, 350], marker: "If therapy goes really well, what would be different", patientText: "If therapy goes really well, what would be different in your life?", activationCondition: { field: "goalsNoMore", operator: "not_equals", value: true }, outputFields: ["goals"] },
        { slug: "goal-difficult-action", type: "follow_up", source: [334, 350], marker: "Are there things you've been wanting", patientText: "Are there things you've been wanting to do but have felt too difficult or scary to try?", activationCondition: { field: "goalsNoMore", operator: "not_equals", value: true }, outputFields: ["goals"] },
        { slug: "goal-freedom", type: "follow_up", source: [334, 350], marker: "What would make you feel more at ease", patientText: "What would make you feel more at ease, more yourself, or more free?", activationCondition: { field: "goalsNoMore", operator: "not_equals", value: true }, outputFields: ["goals"] },
        { slug: "goal-dream", type: "follow_up", source: [334, 350], marker: "Are there things you've always wanted", patientText: "Are there things you've always wanted to do or become — even long-term dreams — that feel important to you?", activationCondition: { field: "goalsNoMore", operator: "not_equals", value: true }, outputFields: ["goals"] },
        // P0-4: real yes/no question ("Would you like to add it to both?"),
        // see the discomfort-distress-distinction comment above for why
        // validation.kind: "boolean" is the correct fix here too.
        { slug: "goal-overlap", type: "clarification", source: [334, 350], marker: "That sounds like both a problem", patientText: "That sounds like both a problem we should include in our list, and a goal. Would you like to add it to both?", activationCondition: { field: "goalOverlapsProblem", operator: "equals", value: true }, outputFields: ["goalProblemOverlap"], validation: { kind: "boolean" } },
        // Passive acknowledgment, same fix as problem-confirmation above --
        // see PASSIVE_ACKNOWLEDGMENT_PROMPT_IDS in runtime-release-normalizer.ts.
        { slug: "goal-confirmation", type: "confirmation", source: [334, 350], marker: "That's a wonderful goal", patientText: "That's a wonderful goal — I'll add that.", activationCondition: { field: "goalsNoMore", operator: "not_equals", value: true } },
        // §5.9 [신규 B-11]: manual gives an explicit follow-up for a distant
        // dream ("what's one small thing you could do now to start moving
        // toward it?") that had no corresponding prompt. Appended (not
        // inserted) so no existing prompt ID in this node shifts; phrased
        // generically since detecting which specific goal is a "distant
        // dream" would need semantic classification outside this file's scope.
        // Session 2 manual-control recovery: the manual only asks this when
        // a real distant dream was actually named -- this prompt previously
        // had no activationCondition at all and always fired, even when
        // goal-dream got "없어요"/a meta remark and no distant dream exists
        // to ask about. goalDistantDreamIdentified is set in
        // runtime-context.ts only when goal-dream's own answer is a genuine
        // item (not no_more/meta_or_clarification).
        { slug: "goal-dream-small-step", type: "follow_up", source: [334, 350], marker: "Are there things you've always wanted", patientText: "For anything on this list that feels like a distant dream rather than something within reach right now, what's one small thing you could do to start moving toward it?", activationCondition: { field: "goalDistantDreamIdentified", operator: "equals", value: true }, outputFields: ["goalSmallSteps"], validation: { kind: "array" } },
      ],
    },
    {
      slug: "goal-scale",
      title: "Step 7 - Goal Scale",
      titleKo: "7단계 - 목표 척도",
      type: "assessment",
      source: [351, 368],
      requiredFields: ["goalScalePresented"],
      restrictions: [sourceText([351, 368])],
      prompts: [
        // P0-4: same fix as rating-card-check above.
        { slug: "goal-rating-card-check", type: "question", source: [351, 368], marker: "Do you still have the rating card", patientText: "Do you still have the rating card in front of you?", outputFields: ["goalScaleCardAvailable"], validation: { kind: "boolean" } },
        { slug: "six-anchor-goal-scale", type: "instruction", source: [351, 368], marker: "Now let's rate how difficult", outputFields: ["goalScalePresented"], validation: { kind: "exact_scale_anchors", min: 0, max: 5 } },
      ],
    },
    {
      slug: "rate-goals",
      title: "Step 8 - Rate Each Goal",
      titleKo: "8단계 - 각 목표 평가하기",
      type: "assessment",
      source: [369, 376],
      requiredFields: ["goalRatings"],
      // §5.8 (regression guard) -- same as rate-problems above.
      restrictions: [sourceText([369, 376]), "Do not reference or reveal any earlier rating for a goal while it is being re-rated."],
      prompts: [
        {
          slug: "reflect-goal-score",
          type: "rating",
          source: [369, 376],
          marker: "So pursuing [goal]",
          outputFields: ["goalRatings"],
          validation: { kind: "rating", min: 0, max: 5, includeColor: true },
          executionMode: "repeat_until",
          maxIterations: 5,
          completionCondition: { kind: "field", field: "allGoalsRated", operator: "equals", value: true },
        },
        { slug: "acknowledge-difficult-goal", type: "reflection", source: [369, 376], marker: "That's a really meaningful goal", patientText: "That's a really meaningful goal, even if it feels far away right now. These are the ones therapy often helps unlock.", activationCondition: { field: "currentGoalScore", operator: "in", value: [4, 5] } },
        { slug: "acknowledge-achieved-goal", type: "reflection", source: [369, 376], marker: "Wonderful", patientText: "Wonderful — it sounds like you're already living this one!", activationCondition: { field: "currentGoalScore", operator: "equals", value: 0 } },
        // P1-1: goal-rating equivalent of rate-problems' score-clarification
        // above -- same uncertainty-between-two-scores experience, now that
        // currentGoalScoreUncertain is actually set by runtime-context.ts.
        { slug: "goal-score-clarification", type: "clarification", source: [369, 376], marker: "When you think about it as", patientText: "When you think about it as [description of lower score] versus [description of higher score] — which one feels truer to you right now?", activationCondition: { field: "currentGoalScoreUncertain", operator: "equals", value: true } },
      ],
    },
    {
      slug: "goal-summary",
      title: "Step 9 - Goal Summary and Distress Count",
      titleKo: "9단계 - 목표 요약 및 고통 지수",
      type: "assessment",
      source: [377, 387],
      requiredFields: ["totalGoalsScore", "yellowRedGoalsCount"],
      prompts: [
        { slug: "goal-total", type: "summary", source: [377, 387], marker: "Your total goals score today", outputFields: ["totalGoalsScore", "yellowRedGoalsCount"], validation: { kind: "calculated_goal_totals" } },
        { slug: "goal-total-personal", type: "reflection", source: [377, 387], marker: "Like your problem score", patientText: "Like your problem score, this is very personal and will change as you work toward your aspirations. The graph that accompanies your scores will let you see these shifts visually over time." },
      ],
    },
    {
      slug: "closing",
      title: "Closing Summary",
      titleKo: "마무리 요약",
      type: "session_complete",
      source: [388, 429],
      restrictions: [sourceText([388, 429])],
      terminal: true,
      prompts: [
        { slug: "thanks", type: "closing", source: [388, 429], marker: "Thank you so much for sharing", outputFields: ["closingAcknowledgement"] },
        // totalProblemScore/totalGoalsScore removed from outputFields (T04):
        // this closing prompt is purely reflective -- its own static message
        // (runtime/static-messages/s02.ts) already recomputes both totals
        // directly from problemRatings/goalRatings, so it never needed to be
        // a second write target for the same two scalar fields that
        // problem-total/goal-total already populate. Whatever the participant
        // says in reply to this line (e.g. "sounds good") no longer risks
        // overwriting the real computed total with non-numeric text.
        { slug: "recorded-summary", type: "summary", source: [388, 429], marker: "Your problems and goals are now recorded", outputFields: ["problemRatings", "goalRatings"] },
        { slug: "final-score-summary", type: "closing", source: [388, 429], marker: "Your total problem score is", completionEffect: { type: "complete_session" } },
      ],
    },
  ],
};
