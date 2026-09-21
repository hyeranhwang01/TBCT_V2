// What each S02 step must obtain, instead of the finished approved sentence
// (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions). Same
// division of labour S01 adopted on 2026-09-19: the intent keeps WHAT the step
// asks and leaves HOW to Claude, while step order, completion, storage and
// safety stay in the program and the approved sentence stays the fallback.
//
// mustMention is the part checked in code (dialogue-agent-orchestrator.ts): a
// turn that asks the task without it is written once more, then replaced by
// the approved sentence. `describe` is what Claude is told; `ko`/`en` are the
// patterns the check looks for. Keyed by slug, like dialogue-guidance.ts, so
// renumbering nodes cannot silently break them.
//
// The types are declared here rather than imported from s01/task-intents.ts:
// the shape is fixed by DialogueContract.taskIntent, and a session-local copy
// keeps S02 from depending on S01's file.

import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";

export type S02MustMention = { describe: string; ko?: string; en?: string };
export type S02TaskIntent = { obtain: string; keep?: string[]; mustMention?: S02MustMention[]; mustNotMention?: S02MustMention[] };

/** Off switch and before/after comparison, mirroring S01's:
 * S02_TASK_INTENTS=off restores approved-sentence grounding. Read per call so
 * tests and scripts can flip it. */
export function s02TaskIntentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.S02_TASK_INTENTS ?? "").trim().toLowerCase() !== "off";
}

// Every turn in this session: the participant decides which pattern fits
// their own thought. The guide never labels it for them (the manual's own
// rule at [145, 155]: "Ask, don't tell").
const NEVER_LABEL_FOR_THEM =
  "Never tell them which pattern their example belongs to, and never offer an example on their behalf. If they ask you to name one, you may, but only then.";

const ASK_ONE_THING = "Ask one thing only, and wait.";

// The CD-Quest bands are the book's, so the numbers are checked rather than
// trusted to a paraphrase -- the same reason S01 pins "0 and 100" on its
// intensity questions.
const FREQUENCY_BANDS: S02MustMention = {
  describe: "all three frequency bands: once or twice, three to five days, and six to seven days",
  ko: "(?=[\\s\\S]*1\\s*[-~]?\\s*(?:에서)?\\s*2)(?=[\\s\\S]*3\\s*[-~]?\\s*(?:에서)?\\s*5)(?=[\\s\\S]*6\\s*[-~]?\\s*(?:에서)?\\s*7)",
  en: "(?=[\\s\\S]*1)(?=[\\s\\S]*3)(?=[\\s\\S]*5)(?=[\\s\\S]*7)",
};
const INTENSITY_BANDS: S02MustMention = {
  describe: "all three intensity bands: a little (up to 30%), quite strongly (31-70%), and very strongly (over 70%)",
  ko: "(?=[\\s\\S]*30)(?=[\\s\\S]*70)",
  en: "(?=[\\s\\S]*30)(?=[\\s\\S]*70)",
};

const INTENTS: Record<string, S02TaskIntent> = {
  "greeting-recap": {
    obtain:
      "Greet them warmly, say it is good to see them again, and recall in one or two sentences what the last session covered: how a situation sets off a thought, and how that thought reaches feelings, behaviour and the body, and that the fifteen patterns a thought can be distorted into were introduced at the end.",
    keep: [
      "Ask nothing at all -- not how they are, and not about the practice. The program's next message asks about the practice.",
      "Two or three sentences. Do not re-teach the last session; one reminder of the ground it covered is enough.",
      "Name none of their own content from last time -- no difficulty, no situation, no feeling of theirs.",
      "In English say 'how thoughts work', not 'the cognitive model'.",
    ],
  },

  "homework-update": {
    obtain: "How the week's practice went: what they wrote in the 'my examples' column of the fifteen-pattern list, and how doing it felt.",
    keep: [
      ASK_ONE_THING,
      "Take whatever they say. Do not grade it, do not correct which pattern an example belongs to, and do not start the walkthrough here.",
      NEVER_LABEL_FOR_THEM,
    ],
  },
  "normalize-overlap": {
    obtain:
      "Reassure them that finding the fifteen patterns hard to tell apart is normal and not a mistake: the patterns overlap, and one example can belong to two or three of them at once.",
    keep: [
      "Ask nothing -- the program's next message asks about today's order.",
      "Do not resolve their example for them by naming which pattern it really is.",
      "Two sentences at most.",
    ],
  },

  "today-agenda": {
    obtain:
      "Their agreement to today's order: going through the fifteen patterns one at a time and, for each, seeing whether they have an example of their own.",
    keep: [
      "Describe the order first, then ask whether it is all right to go this way. One question.",
      "If they have just said the patterns were hard to tell apart, connect today's plan to that.",
      "Do not start the first pattern here.",
    ],
    mustMention: [{ describe: "that you will go through the fifteen patterns one at a time", ko: "(15|십오)\\s*가지", en: "fifteen|15" }],
  },
  "agenda-concern": {
    obtain: "What about today's order does not feel right to them, in their own words.",
    keep: [ASK_ONE_THING, "Do not defend the plan and do not talk them into it. Listen first."],
  },
  "agenda-continue": {
    obtain: "Whether they would like to go on with today's session.",
    keep: [
      "First answer what they raised, briefly and within today's plan; then ask.",
      "Say they can go at their own pace, share only as much as they want, and stop at any time.",
    ],
  },
  "agenda-stop": {
    obtain: "Close for today, warmly and without persuading them to continue.",
    keep: ["Ask nothing.", "Say they can pick up from here whenever they would like to continue.", "Two sentences at most."],
  },

  "distortion-concept": {
    obtain:
      "What a cognitive distortion is: not every thought that goes through our minds is wrong, but some are unhelpful, out of balance, or not really based on evidence -- and those are the ones called cognitive distortions.",
    keep: [
      "Ask nothing -- two more explaining steps follow before the first pattern.",
      "In Session 2 wording, say 'thought' (생각); do not use belief, assumption or core belief (신념, 가정, 핵심 믿음) yet.",
      "Do not name any of the fifteen patterns here.",
    ],
  },
  "research-evidence": {
    obtain:
      "The research behind looking at these: in a study at the Federal University of Bahia in Brazil with 184 university students, people who had these thought patterns more often and more strongly also scored higher on depression and anxiety.",
    keep: [
      "Ask nothing.",
      "State it as things going together, never as one causing the other: the study found these scores rose together. Do NOT say that lowering the distortions lowers depression or anxiety -- that is not what this study shows.",
      "Name the university and the number of students so they can tell where it comes from. No statistics beyond that.",
      "Stop there. What this list of patterns gets used for later is the next message's job, not this one's.",
    ],
    mustMention: [
      { describe: "where the study comes from -- the Federal University of Bahia in Brazil", ko: "바이아", en: "Bahia" },
      { describe: "how many people were in it -- 184 university students", ko: "184", en: "184" },
    ],
    // The recording says "when the distortion score came down, depression came
    // down" -- a causal claim this correlational study cannot support.
    mustNotMention: [
      {
        describe: "any claim that lowering the distortions lowers depression or anxiety",
        ko: "(줄이|낮추|감소|줄어).{0,12}(면|으면)|낮아(집니다|진다|져요|져서)",
        en: "\\b(reduc|lower|decreas)\\w*\\b[^.]{0,48}\\b(depress|anxiet)",
      },
    ],
  },
  "future-use": {
    obtain: "That this same list of patterns comes back later on, when the deeper patterns underneath these thoughts are looked at.",
    keep: [
      "Ask nothing -- the first pattern is the program's next message.",
      "Name it only as what comes later. Do not explain the deeper levels here, and do not use the words core belief (핵심 믿음).",
      "One sentence.",
    ],
  },

  // review-distortion is resolved per type in resolveS02TaskIntent below --
  // the pattern being walked changes every turn.

  "cdquest-explain": {
    obtain:
      "How each pattern gets a score: how often it came up this past week (once or twice / three to five days / six to seven days) and how strongly it was believed at the moment it happened (a little, up to 30% / quite strongly, 31-70% / very strongly, over 70%), and that the two together give a score from 0 to 5.",
    keep: [
      "Ask nothing -- the next step checks the bands made sense.",
      "Give both sets of bands with their numbers. Do not score anything yet and do not work out a score on their behalf.",
      "Say it plainly; this is the one place the numbers have to be exact.",
    ],
    mustMention: [FREQUENCY_BANDS, INTENSITY_BANDS],
  },
  "understanding-check": {
    obtain: "Whether the bands make sense to them so far.",
    keep: [ASK_ONE_THING, "If they say no, the program asks again -- do not start scoring here."],
  },

  // score-distortion is resolved per pattern in resolveS02TaskIntent below.

  "total": {
    obtain:
      "Their total across the fifteen patterns, and what it does and does not mean: it is not a grade, there is no cut-off score, and it is a snapshot of this past week that later weeks can be measured against.",
    keep: [
      "Ask nothing -- the next step asks what they make of it.",
      "Say the total the program gives you and nothing else numeric. Do not rank the patterns and do not say which ones to work on; the step after next asks them.",
      "Never present the number as good or bad, high or low.",
    ],
    mustMention: [
      { describe: "that there is no cut-off and no good or bad total", ko: "컷오프|기준점|정해진\\s*기준|좋은|나쁜", en: "cut-?off|no good or bad" },
    ],
  },
  "how-do-you-feel": {
    obtain: "What thoughts come up for them now that they have seen the whole picture.",
    keep: [
      ASK_ONE_THING,
      "Do not interpret the total for them and do not suggest what they should conclude.",
      "Do not ask about the session or about you -- this is about what they see in their own scores.",
    ],
    // "어떠세요" collides with the closing recap's feedback ban; keep this
    // question about the scores, not about the session.
    mustNotMention: [{ describe: "asking how the session or you were", ko: "피드백|상담(은|이)\\s*어떠", en: "\\bfeedback\\b" }],
  },
  "innate-vs-learned": {
    obtain:
      "The difference between what someone is born with and a habit of thinking: being born a certain way is not chosen, but nobody is born deciding to think this way -- it was learned over time, which is also why it can change.",
    keep: [
      "Ask nothing.",
      "Do not contradict them or tell them they were wrong about themselves. Hold both: some of it is how they are made, and these patterns are not.",
      "Do not promise that it will change, only that something learned can.",
      "Two or three sentences.",
    ],
  },
  "what-to-adjust": {
    obtain: "Which of the fifteen patterns they would want to work on adjusting.",
    keep: [
      ASK_ONE_THING,
      "They choose. Never pick for them, never rank the list, and do not steer them to the highest scores.",
      "More than one is fine, and so is naming just one.",
    ],
  },

  "session-recap": {
    obtain:
      "Recap what today covered, in order: the practice they did over the week, going through the fifteen patterns one at a time to find where each shows up for them, and then scoring each pattern for how often it came up and how strongly it was believed.",
    keep: [
      "Recap what was DONE today, never what they said or concluded: name no example of theirs, no situation, no feeling and no pattern they chose.",
      "Ask nothing -- no confirmation that the recap is right, and no feedback question.",
      "No praise and no encouragement; just what today covered.",
    ],
    mustMention: [{ describe: "the fifteen patterns you went through", ko: "(15|십오)\\s*가지", en: "fifteen|15" }],
    // Any question at all is already caught for a turn the program does not
    // wait on (NO_QUESTION_ON_NON_INPUT_TURN, dialogue-agent-orchestrator.ts),
    // so only the feedback wording needs its own pattern.
    mustNotMention: [{ describe: "a feedback question", ko: "피드백|어떠셨|어떠세요", en: "\\bfeedback\\b" }],
  },
  "homework-assignment": {
    obtain:
      "This week's practice, concretely: fill in a blank copy of this same form -- write a short example in the 'my examples' column whenever one of these thoughts comes up, and at the end of the week score each pattern the way you did together today, so the two weeks can be compared next time.",
    keep: ["The recap has just been given; do not summarize the session again.", "Ask nothing here -- the next step asks whether they can do it."],
    mustMention: [
      { describe: "writing it in the 'my examples' column", ko: "내 예시", en: "my examples" },
      { describe: "scoring each pattern as well, not only writing examples", ko: "점수", en: "scor" },
    ],
  },
  "homework-commitment": {
    obtain: "Whether they think they can do that.",
    keep: ["Ask only that. Do not summarize the session and never ask for feedback."],
  },
  "next-preview": {
    obtain:
      "What comes next, named only: the thoughts that pass through a situation are the first level; underneath them sit the assumptions and rules we live by, and deeper still the long-held beliefs about ourselves that shape both.",
    keep: [
      "Ask nothing. Name the levels as what the next session goes into; do not teach them, and do not ask for an example.",
      "Two or three sentences.",
    ],
  },
  "goodbye": {
    obtain: "One short goodbye.",
    keep: ["The recap has already been given; do not summarize again, and never ask for feedback."],
  },
};

/** Grounded on fixed text on purpose: the safety pause must ship exactly as
 * written and never reaches the dialogue agent at all. */
export const S02_FIXED_TASK_SLUGS: ReadonlySet<string> = new Set(["pause-and-escalate"]);

/** Exported for the coverage test: every S02 prompt slug must either have an
 * intent here or be listed as fixed. */
export const S02_TASK_INTENT_SLUGS: readonly string[] = [...Object.keys(INTENTS), "review-distortion", "score-distortion"];

function slugOf(promptItemId: string): string | null {
  const match = /^tbct-s02-n\d+-p\d+-(.+)$/.exec(promptItemId);
  return match ? match[1] : null;
}

/** How far the walkthrough has got: one stored example per pattern, in
 * registry order, so the count is the index of the pattern being asked about.
 * Mirrors refreshListRatingPointers' list/pointer arithmetic. */
export function currentDistortionIndex(fields: Record<string, unknown>): number {
  const stored = Array.isArray(fields.distortionExamples) ? fields.distortionExamples.length : 0;
  return Math.min(stored, COGNITIVE_DISTORTIONS.length - 1);
}

/** The walkthrough intent, built for whichever pattern the loop is on. The
 * registry supplies the name, the definition and one everyday example, so the
 * fifteen explanations live in data rather than in fifteen prompts. */
// What the guide may NOT say when it talks about an example. Both come from the
// evidence rather than from caution: an evaluation of an LLM cognitive-
// restructuring chatbot found participants read phrases like "a classic
// example" as being judged, and that insisting on a reading -- rather than
// naming it once -- was what felt invalidating ("brushing aside my concerns in
// favour of what it deemed to be reality").
const NO_VERDICT_WORDING: S02MustMention = {
  describe: "calling it a classic or textbook example, which reads as being judged",
  ko: "전형적|교과서적|딱\\s*그\\s*경우",
  en: "classic (?:example|case)|textbook (?:example|case)|typical example",
};
// Three things have to stay possible here, which is why the pattern below is
// narrow. "다른 유형도 비쳐요" is allowed -- the recording's counselor said it.
// "이 유형으로는 잘 안 보이네요" is allowed, and is the way out the discussion
// turn needs when a pattern genuinely does not fit. What is banned is only the
// re-filing verdict: not this one BUT that one. The giveaway is the named
// alternative, not the negation, so the pattern matches the pair.
const NO_REFILING: S02MustMention = {
  describe: "saying the example belongs to a different pattern instead of this one",
  ko: "아니(라|고)\\s*(다른|저|그)\\s*(유형|쪽)|다른\\s*유형(으로|에)\\s*(옮|넣|들어가)",
  en: "(?:instead of|rather than) this pattern|belongs (?:instead )?(?:to|under) (?:a )?different pattern",
};

function walkthroughAskIntent(index: number, korean: boolean): S02TaskIntent {
  const distortion = COGNITIVE_DISTORTIONS[index];
  const name = korean ? distortion.nameKo : distortion.nameEn[0];
  const definition = korean ? distortion.descriptionKo : distortion.descriptionEn;
  const example = korean ? distortion.exampleKo[0] : distortion.exampleEn[0];
  return {
    obtain: `Pattern ${index + 1} of 15 is "${name}". Say what it is in your own words -- it means: ${definition} -- give one short everyday example of it (for instance: "${example}"), and then ask whether they have an example of their own from their week.`,
    keep: [
      `Name this pattern, and only this pattern: ${name}. Do not move on to the next one and do not list the others.`,
      NEVER_LABEL_FOR_THEM,
      "The example you give is yours, to show the shape of the pattern. Their own example must come from them.",
      // 2026-09-21, live S02: the catastrophizing turn said the future is
      // predicted badly and stopped, dropping the half that makes it that
      // pattern -- that the outcome is taken as unbearable. Several of the
      // fifteen are defined in two parts like that and half of one is a
      // different pattern.
      "Carry the whole meaning of this pattern. Several of them are defined in two parts, and saying only one part describes a different pattern -- for catastrophizing it is not just predicting badly, it is expecting the outcome to be unbearable.",
      "If they say nothing comes to mind, accept it and say so plainly -- an empty row is a real answer. Do not press.",
      "If they say they do not see why this one counts as a distortion, ask what feels off about it to them. Do not answer it for them.",
      ASK_ONE_THING,
    ],
    mustMention: [{ describe: `this pattern's name, "${name}"`, ko: escapeRegExp(distortion.nameKo), en: escapeRegExp(distortion.nameEn[0]) }],
  };
}

/**
 * The second turn on a pattern: talk about the example they just gave, which is
 * what two thirds of the real session actually consisted of and what the first
 * build of this step left out entirely (note2026_09_21_s02_walkthrough
 * _discussion).
 *
 * Shaped after the three moves the recording's counselor used -- point at the
 * part of THEIR words, separate what happened from what they concluded, then
 * name the pattern in it: "그만두었는데 사람들은 내가 끈기가 없어서 그만두었다고
 * 생각한다 ... 내가 그 사람들의 마음을 읽은 거죠 ... 이게 mind reading입니다".
 * That is the published Diagnosis-of-Thought shape (subjectivity assessment ->
 * contrastive reasoning -> naming), whose documented failure is over-diagnosis:
 * asked to find the pattern, a model finds one even when there is none. Hence
 * the explicit way out below -- across fifteen patterns some genuinely will not
 * fit.
 *
 * The classification stays inside what the participant already decided: they
 * put this example against this pattern, so the guide is confirming one named
 * pattern, never choosing among fifteen. It may say other patterns show through
 * too -- one example belonging to several is the counselor's own answer to the
 * difficulty reported in the homework review -- but never that it belongs
 * somewhere else instead, and it never moves the row.
 */
function walkthroughDiscussIntent(index: number, fields: Record<string, unknown>, korean: boolean): S02TaskIntent {
  const distortion = COGNITIVE_DISTORTIONS[index];
  const name = korean ? distortion.nameKo : distortion.nameEn[0];
  const rows = Array.isArray(fields.distortionExamples) ? fields.distortionExamples : [];
  const own = typeof rows[index] === "string" ? (rows[index] as string) : "";
  // The discussion can run to a second or third turn when the participant keeps
  // giving content (s02/turn-rules.ts decides). On those turns the reading has
  // already been offered, so repeating it is the wrong move -- follow what they
  // just said instead, which is what the counselor did over 578-596.
  const spent = typeof fields.s02PatternDiscussTurns === "number" ? fields.s02PatternDiscussTurns : 0;
  const following = spent > 0;
  return {
    obtain: following
      ? `Still on pattern ${index + 1} of 15, "${name}". They have just answered what you said about their own example` +
        (own ? ` ("${own}")` : "") +
        `. Take what they have just added and go one step further with it -- towards what actually happened versus what they concluded. Do not repeat the reading you already gave.`
      : `They have just given an example of their own for pattern ${index + 1} of 15, "${name}"` +
        (own ? `: "${own}". ` : ". ") +
        `Point to the part of what THEY said that this pattern shows up in, and say in one line why that part is out of balance -- what actually happened, and what they concluded from it. If the pattern does not really show in what they said, say that instead.`,
    keep: [
      `Talk about this pattern only: ${name}. Do not introduce the next pattern in this turn.`,
      // The counselor does not read a thin example -- he collects the detail
      // first. At 578-596 he asks how many times, then what was said, then
      // "그런데 늘 그런 건 아니죠?", and only then names it. Asked to find the
      // pattern in whatever is in front of it, a model finds one anyway, which
      // is the documented failure of this prompting shape.
      "If you cannot see the part where this pattern shows, do not guess at one. Ask a single question that would give you that detail -- what actually happened, or what went through their mind right then -- and read it on a later turn.",
      "Use their own words for the part you point at, and put it as something they can agree or disagree with, never as a verdict: say what you see and ask whether it feels that way to them.",
      "Offer a reading once. If they do not see it, take that and let it go -- never argue them into it.",
      "You may say that other patterns show through in the same example, and that one example can belong to several at once. Never say it belongs to a different pattern instead of this one, and never move it: the row stays where they put it.",
      "If a different example of THEIR OWN would fit this pattern better, you may say so and ask for it. You never supply one yourself.",
      "At most one question, and only if it helps them see their own example more clearly.",
      "Do not reassure, do not praise the answer, and do not tell them it will get better.",
    ],
    mustMention: [{ describe: `this pattern's name, "${name}"`, ko: escapeRegExp(distortion.nameKo), en: escapeRegExp(distortion.nameEn[0]) }],
    mustNotMention: [NO_VERDICT_WORDING, NO_REFILING],
  };
}

function walkthroughIntent(fields: Record<string, unknown>, korean: boolean): S02TaskIntent {
  // s02/turn-rules.ts sets the phase: "discuss" means their example for this
  // pattern is already stored, so the pattern being talked about is the LAST
  // stored row -- not currentDistortionIndex, which has already moved on to the
  // next one (and which clamps at fourteen, so it would point at the wrong
  // pattern on the fifteenth).
  if (fields.s02PatternPhase === "discuss") {
    const stored = Array.isArray(fields.distortionExamples) ? fields.distortionExamples.length : 0;
    const index = Math.max(0, Math.min(stored - 1, COGNITIVE_DISTORTIONS.length - 1));
    return walkthroughDiscussIntent(index, fields, korean);
  }
  return walkthroughAskIntent(currentDistortionIndex(fields), korean);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The scoring intent, built for whichever pattern the loop is on. Frequency and
 * intensity are asked together because a repeat_until loop runs one prompt per
 * iteration -- two prompts cannot alternate fifteen times inside one node. */
function scoringIntent(fields: Record<string, unknown>, korean: boolean): S02TaskIntent {
  const scored = Array.isArray(fields.cdQuestScores) ? fields.cdQuestScores.length : 0;
  const index = Math.min(scored, COGNITIVE_DISTORTIONS.length - 1);
  const distortion = COGNITIVE_DISTORTIONS[index];
  const name = korean ? distortion.nameKo : distortion.nameEn[0];
  return {
    obtain: `For pattern ${index + 1} of 15, "${name}": what it scores. The grid is on their screen beside the conversation, so they can read the score off it themselves -- ask what they make it, and take either the score or the two halves it is made of.`,
    keep: [
      `Name this pattern, and only this pattern: ${name}.`,
      // The recording's counselor put the form up and pointed at it -- "요
      // 매트릭스에 의해서" (985) -- and she answered "2점인 것 같아요" as often as
      // she gave the two halves. Reciting six bands every turn for fifteen
      // patterns is what made this read as a questionnaire.
      "The grid is on screen, so point at it rather than reciting the bands: ask what they would make this one. Do not list all six bands again -- the step before this explained them.",
      "Take whichever they give: a score, or how often plus how strongly. If only one half arrives, ask for the other one alone -- never re-ask the half you already have.",
      "Never decide the score yourself.",
      "Do not read their example for this pattern back to them, and do not comment on what the score says about them.",
      "If it did not come up at all this week, that is a score of 0 and a complete answer.",
    ],
    mustMention: [{ describe: `this pattern's name, "${name}"`, ko: escapeRegExp(distortion.nameKo), en: escapeRegExp(distortion.nameEn[0]) }],
  };
}

export function s02TaskIntent(promptItemId: string, fields: Record<string, unknown> = {}, korean = true): S02TaskIntent | undefined {
  const slug = slugOf(promptItemId);
  if (!slug || S02_FIXED_TASK_SLUGS.has(slug)) return undefined;
  if (slug === "review-distortion") return walkthroughIntent(fields, korean);
  if (slug === "score-distortion") return scoringIntent(fields, korean);
  return INTENTS[slug];
}

/** The intent as the dialogue contract carries it (DialogueContract.taskIntent):
 * each must-mention item reduced to one pattern for this locale. S02 needs no
 * bracket placeholders -- the only per-turn value is the current pattern, and
 * that is read straight from the registry above. */
export function resolveS02TaskIntent(promptItemId: string, locale: string, context: { fields?: Record<string, unknown> }) {
  const korean = locale.toLowerCase().startsWith("ko");
  const intent = s02TaskIntent(promptItemId, context.fields ?? {}, korean);
  if (!intent) return undefined;
  const pick = (items: S02MustMention[] | undefined) =>
    (items ?? []).flatMap((item) => {
      const pattern = korean ? item.ko : item.en;
      return pattern ? [{ describe: item.describe, pattern }] : [];
    });
  return { obtain: intent.obtain, keep: intent.keep ?? [], mustMention: pick(intent.mustMention), mustNotMention: pick(intent.mustNotMention) };
}
