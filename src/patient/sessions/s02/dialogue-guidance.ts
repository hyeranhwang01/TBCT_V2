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
  "Never name, suggest or rank a cognitive distortion for the participant, and never decide which pattern their example belongs to. They choose; you ask. If they explicitly ask you to name one, you may.",
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
  "review-distortion": [
    "One pattern per turn, the one the program names. Do not move on to the next pattern, and do not list the others.",
    "Give one short everyday example of the pattern yourself to show its shape, then ask for theirs. Never propose an example as if it were theirs.",
    "Never tell them which pattern an example of theirs belongs to.",
    "If nothing comes to mind for this pattern, accept it plainly and do not press. An empty row is a real answer.",
    "If they do not see why this one counts as a distortion, ask what feels off about it to them rather than explaining it yourself.",
  ],
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
const SUMMARY_CHECK_FORBIDDEN_SLUGS = new Set(["review-distortion", "agenda-concern"]);

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
