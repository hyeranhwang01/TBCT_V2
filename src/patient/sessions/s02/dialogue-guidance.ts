// S02 rules for the dialogue agent (.claude/TASK_SCOPE.json
// note2026_09_21_s02_cognitive_distortions), fed through
// dialogue-contract-compiler.ts's stepSpecificGuidanceFor -- the channel the
// agent's system prompt treats as mandatory. Keyed by prompt slug, never by
// the positional id, so renumbering nodes cannot silently break them.

import { s02TaskIntentsEnabled } from "@/patient/sessions/s02/task-intents";

function slugOf(promptItemId: string): string | null {
  const match = /^tbct-s02-n\d+-p\d+-(.+)$/.exec(promptItemId);
  return match ? match[1] : null;
}

const SESSION_RULES = [
  // The next session is where the deeper levels are introduced; this one stays
  // at the level of thoughts, as S01 does.
  "Session 2 wording: never use the words belief, assumption or core belief (신념, 가정, 핵심 믿음); say 'thought' (생각) instead. The closing preview is the one place the deeper levels may be named, and only as what comes next.",
  // Narrowed on 2026-09-21 (note2026_09_21_s02_walkthrough_discussion). The
  // absolute ban forbade the move the recording's counselor made on nearly every
  // pattern -- pointing at the part of the participant's own words the pattern
  // shows up in and naming it. What has to stay banned is the part that takes
  // the decision away: ranking the fifteen, choosing among them on the
  // participant's behalf, or re-filing an example under a different pattern.
  "Never rank the fifteen patterns, never choose among them on the participant's behalf, and never move an example to a different pattern than the one they put it against. Within the pattern the program is currently on you may say where it shows up in their own words, and you may say that other patterns show through as well.",
  "One question at a time. Never interpret or judge what the participant shares, and never diagnose.",
  // Same shape as S01's rule after its 2026-09-21 closing recap: the summary
  // ban is narrowed to the one step that looks back, the feedback ban is absolute.
  "Never ask the participant for feedback about the session or about you. Only the closing recap step looks back over the session; no other step summarizes it.",
];

const QUOTE_EXACTLY_RULE = "When the current task contains the participant's own words in quotation marks, keep that quoted text exactly as written.";
// With task intents: repeating a long answer word for word is part of what
// made these sessions read as a form being filled in (note2026_09_19_s01_task_intents).
const REFER_BY_KEY_WORDS_RULE =
  "When you refer to something the participant said earlier, use their key words and never change its meaning; you need not repeat all of it. The everyday example you offer for a pattern is your own and should be short.";

const RULES_BY_SLUG: Record<string, string[]> = {
  "greeting-recap": [
    "Recall what the last session covered, not what the participant said in it: name no difficulty, situation or feeling of theirs.",
    "Ask nothing; the homework question is the program's next step.",
  ],
  "homework-update": [
    "Ask how the practice went. Do not check their examples against the patterns, and do not correct a placement.",
    "If they wrote nothing, take that plainly -- it is not a failure and today works the same way.",
  ],
  "normalize-overlap": [
    "This step exists only to say that the overlap is normal. Do not resolve their example by naming which pattern it really is.",
    "Ask nothing.",
  ],
  "today-agenda": ["Describe today's order, then ask whether it is all right. Do not begin the first pattern in this turn."],
  "agenda-concern": ["Listen to what does not feel right; do not defend the plan or talk them into continuing."],
  "agenda-continue": ["Answer what they raised within today's plan, briefly, then ask whether to go on."],
  "agenda-stop": ["Close warmly and ask nothing. Do not try once more to continue."],
  "distortion-concept": ["Say what a cognitive distortion is without naming any of the fifteen patterns; the walkthrough names them one at a time."],
  "research-evidence": [
    "State the finding as things going together, never as one causing the other. This study shows the scores rose together; it does not show that lowering one lowers the other.",
    "Name the university and the number of students. Ask nothing.",
  ],
  "future-use": ["Name it only as what comes later. Do not explain the deeper levels and do not use the words core belief (핵심 믿음)."],
  // Each pattern runs over two turns -- ask, then talk about the answer -- and
  // both arrive under this one slug, so these rules hold for both. What differs
  // between them is in the task intent (s02/task-intents.ts).
  "review-distortion": [
    "One pattern per turn, the one the program names. Do not move on to the next pattern, and do not list the others.",
    "Give one short everyday example of the pattern yourself to show its shape, then ask for theirs. Never propose an example as if it were theirs.",
    "When you talk about an example they gave, point at the part of their own words rather than restating it as your own conclusion, and leave it open for them to disagree.",
    "Say a reading once. If they do not see it, take that and go on; never argue them into it.",
    "If nothing comes to mind for this pattern, accept it plainly and do not press. An empty row is a real answer.",
    "If they do not see why this one counts as a distortion, ask what feels off about it to them rather than explaining it yourself.",
  ],
  "cdquest-explain": [
    "Give both sets of bands with their numbers exactly. This is the one step where the numbers matter more than the phrasing.",
    "Do not score anything and do not work out a score on their behalf. Ask nothing.",
  ],
  "understanding-check": ["Ask only whether the bands make sense. Do not begin scoring in this turn."],
  "score-distortion": [
    "One pattern per turn, the one the program names. Ask for how often it came up AND how strongly it was believed, in the same turn.",
    "If they gave only one of the two, ask for the missing one alone -- never ask again for the half you already have.",
    "Never decide the score yourself, and never talk them up or down from what they said. If they state a score outright, take it.",
    "Do not read their example for this pattern back to them, and do not say what the score means about them.",
    "If the pattern did not come up this week that is a score of 0 and a complete answer; accept it without pressing.",
  ],
  "total": [
    "Say the total the program gives you. Never present it as good or bad, high or low, and say there is no cut-off.",
    "Do not rank the patterns and do not say which to work on -- a later step asks them. Ask nothing.",
  ],
  "how-do-you-feel": [
    "Ask what they make of their own scores. Do not interpret the total for them and do not supply a conclusion.",
    "This is about the scores, not about the session or about you.",
  ],
  "innate-vs-learned": [
    "Hold both sides: some of how we are is how we were born, and a habit of thinking is not that. Do not tell them they were wrong about themselves.",
    "Do not promise the pattern will change -- only that something learned can. Ask nothing.",
  ],
  "what-to-adjust": ["They choose which patterns to work on. Never pick for them, never rank the list, and do not steer them toward the highest scores."],
  "session-recap": [
    "This is the one step that looks back over the whole session. Keep the order it is written in.",
    "Recap what was done today, not what the participant said or concluded: name no example, situation, feeling or pattern of theirs.",
    "Add nothing else: no praise, no encouragement, no advice.",
    "Ask nothing -- not whether the recap is right, and never for feedback.",
  ],
  "homework-assignment": ["Give the practice concretely; the recap has just been given, so do not summarize again."],
  "homework-commitment": ["Ask only whether they can do it; no session summary and no feedback question."],
  "next-preview": ["Name the three levels as what the next session goes into. Do not teach them and do not ask for an example."],
  "goodbye": ["One short goodbye; the recap has already been given, so do not summarize again, and no feedback question."],
};

// Steps where the participant must reach the answer themselves: an assistant
// summary here would state it for them, or ask a second confirmation question
// right after S02's own question. review-distortion runs fifteen times, so an
// extra confirm turn per pattern would also double the session's length.
// review-distortion and score-distortion each run fifteen times, so an extra
// confirm turn per pattern would double the session; what-to-adjust and
// how-do-you-feel are conclusions the participant has to reach themselves.
const SUMMARY_CHECK_FORBIDDEN_SLUGS = new Set(["review-distortion", "score-distortion", "agenda-concern", "how-do-you-feel", "what-to-adjust"]);

export function s02DialogueGuidance(promptItemId: string): string[] {
  const slug = slugOf(promptItemId);
  if (!slug) return [];
  const quoteRule = s02TaskIntentsEnabled() ? REFER_BY_KEY_WORDS_RULE : QUOTE_EXACTLY_RULE;
  return [...SESSION_RULES, quoteRule, ...(RULES_BY_SLUG[slug] ?? [])];
}

export function isS02SummaryCheckForbidden(promptItemId: string): boolean {
  const slug = slugOf(promptItemId);
  return slug !== null && SUMMARY_CHECK_FORBIDDEN_SLUGS.has(slug);
}
