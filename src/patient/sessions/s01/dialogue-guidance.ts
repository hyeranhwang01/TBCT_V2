// S01 rules for the dialogue agent (.claude/TASK_SCOPE.json
// note2026_09_12_s01_redesign), fed through dialogue-contract-compiler.ts's
// stepSpecificGuidanceFor -- the channel the agent's system prompt treats as
// mandatory. Keyed by prompt slug, never by the positional id.

function slugOf(promptItemId: string): string | null {
  const match = /^tbct-s01-n\d+-p\d+-(.+)$/.exec(promptItemId);
  return match ? match[1] : null;
}

const SESSION_RULES = [
  "Session 1 wording: never use the words belief, assumption or core belief (신념, 가정, 핵심 믿음); say 'thought' (생각) instead.",
  "Never name, suggest or rank a cognitive distortion unless the participant has explicitly asked for suggestions.",
  "Say 'when counseling ends' rather than any number of sessions. Never mention the Intrapersonal Thought Record. Do not summarize the session and do not ask for feedback.",
  "When the current task contains the participant's own words, the scene, or an example thought in quotation marks, keep that quoted text exactly as written.",
];

const RULES_BY_SLUG: Record<string, string[]> = {
  "main-difficulty": ["Ask for the participant's own difficulties; never suggest or name a difficulty or a diagnosis."],
  "representative-difficulty": ["The participant chooses from the difficulties they listed; do not choose for them."],
  "recent-moment": ["If the participant is vague or cannot think of a moment, offer everyday examples: a task they had to get done, a presentation, having to meet someone. Ask only for the situation, not the thought or feeling."],
  "write-situation-line": ["Ask the participant to write the line themselves. Never propose, shorten or rephrase it for them."],
  "write-thought-line": ["Ask the participant to write the line themselves. Never propose, shorten or rephrase it for them."],
  "first-emotion": ["Ask about the feeling only; the thought comes next."],
  "first-behavior": ["Only if the participant is stuck, offer examples: leaving, going quiet, crying, trying to fix it right away."],
  "link-check": ["Ask whether they can see the connection; do not explain the connection for them."],
  "usual-prevention": ["Only if the participant is stuck, mention avoiding situations or preparing and planning ahead as examples."],
  "problem-link": ["Ask the question; do not assert that the two are connected."],
  "candidate-one-emotion": ["Guide toward a positive reaction first."],
  "candidate-two-thought": ["The feeling (suspicion) is given; the participant supplies the thought. Do not suggest one."],
  "candidate-three-thought": ["The feeling (anger) is given; the participant supplies the thought. Do not suggest one."],
  "what-made-difference": ["Never state the conclusion yourself; let the participant name what made the difference."],
  "emotion-cause-follow-up": ["Never state the conclusion yourself; let the participant name what made the feelings differ."],
  "return-bridge": ["Returning to the participant's own situation here is the planned next step, not revisiting an earlier task."],
  "what-made-feeling": ["Returning to the participant's own situation is the planned step. Let them find the pattern; do not interpret for them or repeat the earlier cycle questions."],
  "what-happened": ["Ask what actually happened; do not interpret it."],
  "outcome-meaning": ["Let the participant draw the meaning themselves; do not conclude for them."],
  "show-list": ["The list of 15 cognitive distortions is shown beside the conversation; point to it without naming any distortion."],
  "read-a-few": ["Invite the participant to read two or three; do not read them out or name any."],
  "identify-distortion": ["The participant chooses from the list shown beside the conversation; do not name or suggest a distortion."],
  "homework-assignment": ["Give the practice concretely; no session summary."],
  "homework-commitment": ["Ask only whether they can do it; no session summary and no feedback question."],
  "goodbye": ["One short goodbye; no session summary and no feedback question."],
};

// Steps where the participant must reach the answer themselves, or where
// they are writing their own line: an assistant summary here would state the
// conclusion for them, or ask a second confirmation question right after
// S01's own question (reflect-and-confirm, note2026_09_11).
const SUMMARY_CHECK_FORBIDDEN_SLUGS = new Set([
  "representative-difficulty",
  "write-situation-line",
  "write-thought-line",
  "candidate-one-thought",
  "candidate-two-thought",
  "candidate-two-thought-hint",
  "candidate-three-thought",
  "candidate-three-thought-hint",
  "what-made-difference",
  "emotion-cause-follow-up",
  "what-made-feeling",
  "outcome-meaning",
  "identify-distortion",
  "suggested-candidates",
]);

export function s01DialogueGuidance(promptItemId: string): string[] {
  const slug = slugOf(promptItemId);
  if (!slug) return [];
  return [...SESSION_RULES, ...(RULES_BY_SLUG[slug] ?? [])];
}

export function isS01SummaryCheckForbidden(promptItemId: string): boolean {
  const slug = slugOf(promptItemId);
  return slug !== null && SUMMARY_CHECK_FORBIDDEN_SLUGS.has(slug);
}
