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

  "session-recap": {
    obtain:
      "Recap what today covered, in order: the practice they did over the week, and then going through the fifteen patterns one at a time, finding where each one shows up for them.",
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
      "This week's practice, concretely: keep the list of fifteen patterns nearby and, whenever one of these thoughts comes up, write a short example in the 'my examples' column of the pattern it fits; you will look at them together next time.",
    keep: ["The recap has just been given; do not summarize the session again.", "Ask nothing here -- the next step asks whether they can do it."],
    mustMention: [{ describe: "writing it in the 'my examples' column", ko: "내 예시", en: "my examples" }],
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
export const S02_TASK_INTENT_SLUGS: readonly string[] = [...Object.keys(INTENTS), "review-distortion"];

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
function walkthroughIntent(fields: Record<string, unknown>, korean: boolean): S02TaskIntent {
  const index = currentDistortionIndex(fields);
  const distortion = COGNITIVE_DISTORTIONS[index];
  const name = korean ? distortion.nameKo : distortion.nameEn[0];
  const definition = korean ? distortion.descriptionKo : distortion.descriptionEn;
  const example = korean ? distortion.exampleKo[0] : distortion.exampleEn[0];
  const ordinal = index + 1;
  return {
    obtain: `Pattern ${ordinal} of 15 is "${name}". Say what it is in your own words -- it means: ${definition} -- give one short everyday example of it (for instance: "${example}"), and then ask whether they have an example of their own from their week.`,
    keep: [
      `Name this pattern, and only this pattern: ${name}. Do not move on to the next one and do not list the others.`,
      NEVER_LABEL_FOR_THEM,
      "The example you give is yours, to show the shape of the pattern. Their own example must come from them.",
      "If they say nothing comes to mind, accept it and say so plainly -- an empty row is a real answer. Do not press.",
      "If they say they do not see why this one counts as a distortion, ask what feels off about it to them. Do not answer it for them.",
      ASK_ONE_THING,
    ],
    mustMention: [{ describe: `this pattern's name, "${name}"`, ko: escapeRegExp(distortion.nameKo), en: escapeRegExp(distortion.nameEn[0]) }],
  };
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function s02TaskIntent(promptItemId: string, fields: Record<string, unknown> = {}, korean = true): S02TaskIntent | undefined {
  const slug = slugOf(promptItemId);
  if (!slug || S02_FIXED_TASK_SLUGS.has(slug)) return undefined;
  if (slug === "review-distortion") return walkthroughIntent(fields, korean);
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
