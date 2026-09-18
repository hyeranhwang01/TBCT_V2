// What each S01 step must obtain, instead of the finished approved sentence
// (.claude/TASK_SCOPE.json note2026_09_19_s01_task_intents). The approved
// sentence made Claude paraphrase a script; the intent keeps WHAT the step
// asks and leaves HOW to Claude. Step order, completion, storage and safety
// stay in the program, and the approved sentence stays the fallback.
//
// mustMention is the part that is checked in code
// (dialogue-agent-orchestrator.ts): a turn that asks the task without it is
// written once more, then replaced by the approved sentence. `describe` is
// what Claude is told; `ko`/`en` are the patterns the check looks for;
// `literal` is a placeholder that must appear as resolved (the example-thought
// hints). Keyed by slug, like dialogue-guidance.ts.

import { resolveBracketPlaceholders } from "@/shared/runtime/runtime-static-message";

export type S01MustMention = { describe: string; ko?: string; en?: string; literal?: string };
export type S01TaskIntent = { obtain: string; keep?: string[]; mustMention?: S01MustMention[] };

/** Off switch and before/after comparison: S01_TASK_INTENTS=off restores the
 * approved-sentence grounding. Read per call so tests and scripts can flip it. */
export function s01TaskIntentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.S01_TASK_INTENTS ?? "").trim().toLowerCase() !== "off";
}

const ZERO_AND_HUNDRED: S01MustMention = {
  describe: "the scale: 0 means not at all and 100 means as strong as it gets (say both ends)",
  ko: "^(?=[\\s\\S]*(?:^|[^0-9])0(?:[^0-9]|$))(?=[\\s\\S]*100)",
  en: "^(?=[\\s\\S]*(?:^|[^0-9])0(?:[^0-9]|$))(?=[\\s\\S]*100)",
};

const BELIEF_ZERO_AND_HUNDRED: S01MustMention = {
  ...ZERO_AND_HUNDRED,
  describe: "the scale: 0 means not believing it at all and 100 means believing it completely (say both ends)",
};

const SCENE_ONLY = "Scene only: the counselor's goodbye remark to three people. No interviewer, no job application.";

const INTENTS: Record<string, S01TaskIntent> = {
  "warm-acknowledgement": {
    obtain: "A warm welcome in one or two sentences.",
    keep: ["Ask nothing -- not how they are, and not the manual's opening question about describing the situation: the program asks about their difficulties right after this message."],
  },

  "main-difficulty": {
    obtain: "The difficulties the participant would like help with these days, in their own words.",
    keep: ["Never suggest or name a difficulty or a diagnosis.", "Ask only for the difficulties -- a concrete example is the next question."],
  },
  "difficulty-example": {
    obtain: "One concrete example of when that difficulty showed up.",
  },
  "other-difficulty": {
    obtain: "Whether there is any other difficulty they would like help with.",
    keep: ["If they already named several, acknowledge them briefly in their key words before asking what else."],
  },
  "other-difficulty-more": {
    obtain: "Whether there is anything else they would like help with; make clear it is fine if there isn't.",
  },
  "representative-difficulty": {
    obtain: "Which of the difficulties they named feels biggest -- the one that sits underneath the others -- chosen by the participant.",
    keep: [
      "You may name their difficulties briefly, in their key words, so they can choose.",
      "Never ask for a number or a position in a list, and never choose for them.",
    ],
  },
  "goal-at-end": {
    obtain: "How they would like [representative difficulty] to be different when counseling ends.",
    keep: ["Say 'when counseling ends', never a number of sessions."],
  },
  "goal-benefit": {
    obtain: "If that happened, how they would feel and what would change in their daily life.",
  },

  "collaboration-and-practice": {
    obtain: "Explain briefly that this work is built together and that practice between conversations matters.",
    keep: ["Do not assign any exercise yet."],
    mustMention: [{ describe: "a week has 168 hours and the conversation takes only about one of them, so what they try in the rest of the week makes much of the difference", ko: "168", en: "168" }],
  },
  "practice-commitment": {
    obtain: "Whether they are willing to work together this way (yes or no).",
  },

  "recent-moment": {
    obtain: "One recent moment (within about the last week) when [representative difficulty] showed up, and what was happening.",
    keep: ["Ask only for the situation -- not the thought or the feeling yet.", "Do not ask whether it was a situation or a thought."],
  },
  "situation-examples": {
    obtain: "A recent moment, even a small one, now that they are stuck.",
    mustMention: [{ describe: "everyday examples: a task they had to get done, a presentation, or having to meet someone", ko: "발표|해야 할|만나", en: "presentation|task|meet" }],
  },
  "write-situation-line": {
    obtain: "The participant's own one-line version of the situation for the worksheet.",
    keep: ["Never write, shorten or rephrase it for them."],
  },

  "first-emotion": {
    obtain: "How they felt at that moment.",
    keep: ["Never suggest a feeling. The thought comes later."],
  },
  "first-emotion-intensity": {
    obtain: "How strong that feeling was, from 0 to 100.",
    mustMention: [ZERO_AND_HUNDRED],
  },
  "second-emotion": {
    obtain: "Whether they felt any other feeling at the same time.",
  },
  "second-emotion-intensity": {
    obtain: "How strong that second feeling was, from 0 to 100.",
    mustMention: [ZERO_AND_HUNDRED],
  },
  "third-emotion": {
    obtain: "Whether there was any other feeling.",
  },
  "third-emotion-intensity": {
    obtain: "How strong that feeling was, from 0 to 100.",
    mustMention: [ZERO_AND_HUNDRED],
  },

  "thought-behind-emotion": {
    obtain: "Why they felt [their emotion] -- what went through their mind at that moment.",
    keep: ["Accept uncertainty."],
  },
  "write-thought-line": {
    obtain: "The participant's own one-line version of the thought for the worksheet.",
    keep: ["Never write, shorten or rephrase it for them."],
  },
  "thought-belief": {
    obtain: "How strongly they believed that thought at the time, from 0 to 100.",
    mustMention: [BELIEF_ZERO_AND_HUNDRED],
  },

  "first-behavior": {
    obtain: "What they did at that moment.",
  },
  "behavior-examples": {
    obtain: "What they did at that moment, now that they are stuck.",
    mustMention: [{ describe: "everyday examples: leaving, going quiet, crying, or trying to fix it right away", ko: "피하|자리|말을 하지|말이 없|울|해결", en: "leav|quiet|cr(y|ied)|fix" }],
  },
  "second-behavior": {
    obtain: "Whether they did anything else.",
  },
  "body": {
    obtain: "What they noticed in their body at that moment.",
  },
  "body-examples": {
    obtain: "Anything they noticed in their body, even something small, now that they are stuck.",
    mustMention: [{ describe: "small everyday examples: a warm face, a tight chest, shaky hands", ko: "얼굴|가슴|손", en: "face|chest|hand" }],
  },

  "link-check": {
    obtain: "Whether they can see, on their worksheet, how the situation, the thought, the feeling and what they did and felt in their body connect.",
  },
  "dotted-line": {
    obtain: "Point out one thing about the worksheet arrows.",
    mustMention: [{ describe: "the arrow from the situation to the thought is dotted: the same situation does not have to lead to the same thought", ko: "점선", en: "dotted" }],
  },
  "friend-same-thought": {
    obtain: "Whether a close friend in exactly the same situation would have had exactly the same thought.",
  },
  "friend-thought": {
    obtain: "What that friend might have thought instead.",
  },

  "after-behavior-feeling": {
    obtain: "How they felt after [their behavior].",
  },
  "thought-strengthened": {
    obtain: "Which thought gets stronger when they feel that way.",
  },
  "usual-prevention": {
    obtain: "What they usually do to keep that from happening again.",
  },
  "usual-prevention-hint": {
    obtain: "What they usually do to keep that from happening again, now that they are stuck.",
    mustMention: [{ describe: "two examples: avoiding situations like that, or preparing and planning ahead a lot", ko: "피하|대비|준비|계획", en: "avoid|prepar|plan" }],
  },
  "problem-link": {
    obtain: "Whether that connects to [representative difficulty], the difficulty they named at the start.",
  },
  "short-long-term": {
    obtain: "How doing that feels right away, and how it works out over time.",
  },

  "preview": {
    obtain: "Introduce looking at the same idea through three other people's eyes: from a little distance it is often easier to see.",
    keep: ["Do not present the scene or any other scenario yet."],
  },

  "candidate-one-emotion": {
    obtain: "How the first person might feel after hearing that remark, starting with a positive reaction.",
    keep: [SCENE_ONLY],
  },
  "candidate-one-thought": {
    obtain: "Which thought might have gone through the first person's mind for them to feel that way.",
    keep: ["Never supply a thought."],
  },
  "candidate-one-behavior": {
    obtain: "How the first person might act with that thought and feeling.",
  },
  "candidate-one-body": {
    obtain: "How the first person's body might feel.",
  },
  "candidate-two-thought": {
    obtain: "The second person heard exactly the same words but felt suspicious: which thought might have made them feel that way.",
    keep: ["Never supply a thought.", SCENE_ONLY],
  },
  "candidate-two-thought-hint": {
    obtain: "Which thought the second person might have had, now that the participant is stuck.",
    mustMention: [{ describe: "the example thought ‘[person two hint]’, exactly as written", literal: "[person two hint]" }],
  },
  "candidate-two-behavior": {
    obtain: "How the second person might act, feeling suspicious like that.",
  },
  "candidate-two-body": {
    obtain: "How the second person's body might feel.",
  },
  "candidate-three-thought": {
    obtain: "The third person heard the same words and got angry: which thought might have made them angry.",
    keep: ["Never supply a thought.", SCENE_ONLY],
  },
  "candidate-three-thought-hint": {
    obtain: "Which thought the third person might have had, now that the participant is stuck.",
    mustMention: [{ describe: "the example thought ‘[person three hint]’, exactly as written", literal: "[person three hint]" }],
  },
  "candidate-three-behavior": {
    obtain: "How the third person might act, feeling angry like that.",
  },
  "candidate-three-body": {
    obtain: "How the third person's body might feel.",
  },

  "situation-same": {
    obtain: "Whether the situation was the same or different for the three people.",
  },
  "feelings-compared": {
    obtain: "Whether the three people's feelings were the same or different.",
  },
  "actions-compared": {
    obtain: "Whether the three people's actions were the same or different.",
  },
  "what-made-difference": {
    obtain: "The situation was the same, so what made the difference -- in the participant's own conclusion.",
  },
  "emotion-cause-follow-up": {
    obtain: "What made the three people's feelings different in the first place.",
  },

  "return-bridge": {
    obtain: "Bring the conversation back to what they mentioned earlier about [their situation], to look at how the same pattern shows up in their own experience.",
    keep: ["This is the planned next step, not going back to an earlier question."],
  },
  "what-made-feeling": {
    obtain: "The three people felt differently depending on their thoughts: in their own situation, what made them feel [their emotion].",
  },
  "what-happened": {
    obtain: "What actually happened in that situation after [their behavior].",
  },
  "outcome-meaning": {
    obtain: "What it tells them that what they feared did not actually happen.",
  },

  "participant-summary": {
    obtain: "In the participant's own words, what they noticed or understood about how their thoughts, feelings and behavior connected in that situation.",
    keep: ["Do not summarize it for them."],
  },

  "show-list": {
    obtain: "Point them to the list of 15 common thinking patterns, called cognitive distortions, shown beside the conversation.",
  },
  "intro-distortions": {
    obtain: "Introduce the idea behind the list briefly.",
    mustMention: [{ describe: "these negative automatic thoughts have a name in cognitive therapy, cognitive distortions; not every automatic thought is one, but some are errors or exaggerations worth examining", ko: "인지\\s*왜곡", en: "cognitive distortion" }],
  },
  "read-a-few": {
    obtain: "Whether they could read through two or three of them.",
  },
  "identify-distortion": {
    obtain: "Looking at what went through their mind in that situation, whether any of these distortions seem to fit; it is fine if none do.",
  },
  "meaning-of-distortion": {
    obtain: "What difference it would make if they discovered that this thought might be a cognitive distortion -- a kind of error in thinking.",
  },

  "homework-assignment": {
    obtain: "Give this week's practice concretely.",
    keep: ["No session summary."],
    mustMention: [{ describe: "keep the cognitive distortions list nearby and, whenever such a thought comes up, write a short example in the 'My examples' column of the matching distortion; you will look at them together next time", ko: "내 예시", en: "my examples" }],
  },
  "homework-commitment": {
    obtain: "Whether they think they can do that.",
  },
  "goodbye": {
    obtain: "One short goodbye.",
    keep: ["No session summary and no feedback question."],
  },
};

// Grounded on fixed text on purpose: the scene is presented exactly as
// written, and suggested-candidates is the registry-validated candidate list.
export const S01_FIXED_TASK_SLUGS: ReadonlySet<string> = new Set(["scene", "suggested-candidates"]);

function slugOf(promptItemId: string): string | null {
  const match = /^tbct-s01-n\d+-p\d+-(.+)$/.exec(promptItemId);
  return match ? match[1] : null;
}

export function s01TaskIntent(promptItemId: string): S01TaskIntent | undefined {
  const slug = slugOf(promptItemId);
  if (!slug || S01_FIXED_TASK_SLUGS.has(slug)) return undefined;
  return INTENTS[slug];
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The intent as the dialogue contract carries it (DialogueContract.taskIntent):
 * placeholders filled from this session's fields, and each must-mention item
 * reduced to one pattern for this locale. */
export function resolveS01TaskIntent(promptItemId: string, locale: string, context: { fields?: Record<string, unknown> }) {
  const intent = s01TaskIntent(promptItemId);
  if (!intent) return undefined;
  const fill = (text: string) => resolveBracketPlaceholders(text, context);
  const korean = locale.toLowerCase().startsWith("ko");
  const mustMention = (intent.mustMention ?? []).flatMap((item) => {
    if (item.literal) {
      const value = fill(item.literal);
      // No stored value: the placeholder fell back to generic wording, which
      // is not something the turn has to repeat.
      if (value === resolveBracketPlaceholders(item.literal)) return [];
      return [{ describe: fill(item.describe), pattern: escapeRegExp(value) }];
    }
    const pattern = korean ? item.ko : item.en;
    return pattern ? [{ describe: fill(item.describe), pattern }] : [];
  });
  return { obtain: fill(intent.obtain), keep: (intent.keep ?? []).map(fill), mustMention };
}

/** Exported for the coverage test only. */
export const S01_TASK_INTENT_SLUGS: readonly string[] = Object.keys(INTENTS);
