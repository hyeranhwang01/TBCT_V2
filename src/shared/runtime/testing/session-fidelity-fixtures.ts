import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { PatientInput } from "@/types/runtime-session";

function validationOf(prompt: PromptItem) {
  return (prompt.validation ?? {}) as { kind?: string; values?: Array<string | number>; min?: number; max?: number };
}

/** Validation kinds whose two output fields must sum to 100 (e.g. the
 * Consensus chair's advantage/disadvantage re-weighting). A generic
 * "value, value-1" synthetic pair would violate that constraint and get
 * legitimately rejected by the completion gate. */
const SUM_TO_100_PAIR_KINDS = new Set(["consensus_weights"]);

// Content-aware, rotating reply pools, one per clinical-content category a
// field name commonly falls into. Each field name gets its own rotation
// counter so repeatedly hitting the same field (a revisited node, a
// multi-round rating loop) cycles through different phrasing instead of
// the same canned line every time -- a flat template string here reads as
// a real patient repeating themselves turn after turn, which is exactly
// the fidelity-check noise this fixture exists to avoid.
const CONTENT_POOLS: Array<{ pattern: RegExp; replies: string[] }> = [
  { pattern: /situation/i, replies: [
    "My manager criticized my report in front of the whole team yesterday.",
    "My partner sent a text saying we needed to talk, and I started spiraling.",
    "I walked into the meeting five minutes late and everyone stopped talking.",
    "A close friend didn't reply to my message for two days.",
  ] },
  { pattern: /automaticThought|workingAutomaticThought|underlyingBelief/i, replies: [
    "I immediately thought, I'm going to get fired for this.",
    "My mind just said, everyone here thinks I'm incompetent.",
    "I thought, I always mess things up eventually.",
    "The thought was, this proves I can't be trusted with anything important.",
  ] },
  { pattern: /coreBelief|positiveBelief/i, replies: [
    "I guess deep down it means I'm not good enough.",
    "I think it means I'll always end up alone.",
    "Maybe it means I'm fundamentally unlovable.",
    "I suppose it means I'm a failure at the things that matter.",
  ] },
  // Must precede the generic /emotion/ pool below, which this field name also
  // matches: the empty chair is an alternating dialogue between two parts,
  // not a list of emotion words, and it needs enough DISTINCT utterances to
  // reach the source's "several exchanges" floor (a repeat is skipped as a
  // duplicate, so a short pool stalls the loop against its iteration cap).
  { pattern: /emotionReasonDialogue/i, replies: [
    "I'm scared that if we do this, it all falls apart and I'm the one left holding it.",
    "I hear that you're scared, and the fear makes sense, but staying silent hasn't made it better either.",
    "You keep saying it will be fine, and you don't know that.",
    "You're right, I don't know that. What I do know is the not-knowing is costing us both.",
    "If it goes badly I don't think I can take it.",
    "Then let's agree we go slowly, and you can stop us at any point.",
  ] },
  { pattern: /emotion/i, replies: [
    "Mostly anxious, honestly, maybe around 70%.",
    "I felt embarrassed and a little angry at myself.",
    "Just really sad, more than I expected.",
    "Overwhelmed, like everything was piling up at once.",
  ] },
  { pattern: /bodySensation/i, replies: [
    "My heart was racing and my hands felt shaky.",
    "I noticed my chest getting tight and my breathing speeding up.",
    "There was a knot in my stomach the whole time.",
    "My shoulders and jaw got really tense.",
  ] },
  { pattern: /behavior|reaction/i, replies: [
    "I left the meeting early and avoided everyone for the rest of the day.",
    "I stayed quiet and didn't say anything back.",
    "I texted an apology right away, even though I wasn't sure I needed to.",
    "I just kept scrolling my phone to avoid thinking about it.",
  ] },
  // Courtroom-role answers are third-person by protocol (S08 KP3) -- a
  // first-person reply earns one gentle correction, which the audit counts as
  // a clarification and fails on. The prosecution argues FOR the charge and
  // the defense against it, so they need opposing content: one shared pool
  // had the prosecutor presenting the defendant's achievements as proof of
  // guilt, which no real run would produce.
  { pattern: /prosecutionEvidence/i, replies: [
    "They missed the March deadline and the whole team had to cover for them.",
    "They went quiet in the review meeting when they were asked a direct question.",
    "They put off the difficult conversation with their sister for three years.",
    "They dropped the evening class after two weeks last autumn.",
  ] },
  { pattern: /evidence/i, replies: [
    "Their manager actually thanked them for a report last month.",
    "They met every deadline this quarter without missing one.",
    "A coworker told them their presentation last week was clear and helpful.",
    "They handled a similar situation fine back in the spring.",
  ] },
  // Step 10/12 pair each answer with one item of the previous list, so these
  // need the "BUT..."/"Therefore..." shape the source asks for.
  { pattern: /prosecutionRebuttals/i, replies: [
    "BUT that one thank-you does not cancel the day they froze in the meeting.",
    "BUT meeting deadlines is the minimum anyone is expected to do.",
    "BUT one clear presentation does not make them reliable.",
    "BUT the spring case was much easier than this one.",
  ] },
  { pattern: /defenseSurrebuttals/i, replies: [
    "BUT the manager's thanks was specific and unprompted, which says something real about their work.",
    "BUT meeting every deadline under this workload took genuine effort.",
    "BUT the coworker had no reason to say it unless it was true.",
    "BUT they still chose to handle the spring case rather than avoid it.",
  ] },
  { pattern: /thereforeConclusions/i, replies: [
    "Therefore the defendant is someone whose work is recognized by others.",
    "Therefore the defendant follows through even when it is hard.",
    "Therefore one difficult moment does not define the defendant.",
    "Therefore the defendant is far more capable than the charge claims.",
  ] },
  { pattern: /juryReview/i, replies: [
    "The prosecution seems to be using all-or-nothing thinking about one bad day.",
    "The defense's examples are concrete and check out as factual.",
    "The rebuttals mostly discount the evidence rather than answer it.",
    "The defense's answers and conclusions hold up as true.",
  ] },
  // S07's decisional balance and empty chair are collected one item at a time
  // up to the source's own limits, so each pool needs at least as many
  // DISTINCT replies as its target -- a repeat is skipped as a duplicate and
  // would stall the loop against its iteration cap instead of completing.
  { pattern: /^disadvantages$/i, replies: [
    "I would probably lie awake the night before.",
    "It could make the next family dinner awkward.",
    "I might hear something I don't want to hear.",
    "It would take up a whole afternoon I don't really have.",
    "I could end up feeling worse than before I tried.",
    "My sister might take it the wrong way.",
    "I'd have to admit I've been avoiding it for years.",
  ] },
  { pattern: /^advantages$/i, replies: [
    "I would stop carrying this around every day.",
    "It might actually clear the air between us.",
    "I'd find out where I really stand.",
    "My partner would stop worrying about me over it.",
    "I could stop rehearsing the conversation in my head.",
    "It would prove to me that I can do hard things.",
    "The next family event wouldn't feel like a minefield.",
  ] },
  { pattern: /consensusLearning/i, replies: [
    "Both parts want the same thing, they just disagree about the cost.",
    "The fear isn't trying to stop me, it's trying to protect me from being hurt again.",
    "I don't have to pick a side today to still move a little.",
  ] },
  { pattern: /goal/i, replies: [
    "Getting a full night's sleep most nights.",
    "Speaking up in meetings without panicking beforehand.",
    "Spending more real time with my kids on weekends.",
    "Finishing the project I've been putting off for months.",
  ] },
  { pattern: /problem/i, replies: [
    "I keep putting off things at work until the last minute.",
    "I've been avoiding calls from my family for weeks.",
    "I snap at my partner over small things more than I'd like.",
    "I can't seem to fall asleep before 2am most nights.",
  ] },
  { pattern: /symptom/i, replies: [
    "Crowded elevators make my heart start pounding.",
    "I avoid answering the phone when I don't recognize the number.",
    "Group presentations make my hands shake for hours beforehand.",
    "I skip family gatherings when there'll be more than a few people.",
  ] },
  { pattern: /summary/i, replies: [
    "So basically, the thought fed the feeling, and the feeling made me pull away from people.",
    "I noticed the thought first, then the emotion, and then I acted on it by avoiding the situation.",
    "It sounds like one bad moment turned into a whole story about myself that isn't really true.",
  ] },
  // Checked before the broader /participation/i pattern below, which would
  // otherwise match this field name too and return a contributor's NAME in
  // response to "How does that feel to you now?".
  { pattern: /participationRatingStable/i, replies: ["That feels about right to me now.", "Yeah, that seems to fit better."] },
  { pattern: /participation|contributor/i, replies: ["My coworker who missed the deadline first", "My manager for not checking in sooner", "Myself, for not raising it earlier"] },
  // role_transition prompts (S07/S08 chair-switching) validate with
  // requiresThirdPerson: any first-person pronoun without an accompanying
  // third-person one is rejected -- keep these confirmations third-person-safe.
  { pattern: /RoleReady|roleReady|juryOrientation/i, replies: [
    "The defendant is ready to hear from the prosecutor now.",
    "The patient has moved into the other chair and is ready to continue.",
    "They are ready for the next chair to speak.",
  ] },
];

let genericCounter = 0;
const fieldCounters = new Map<string, number>();

function nextReply(field: string): string {
  const bucket = CONTENT_POOLS.find((entry) => entry.pattern.test(field));
  if (bucket) {
    const index = fieldCounters.get(field) ?? 0;
    fieldCounters.set(field, index + 1);
    return bucket.replies[index % bucket.replies.length];
  }
  genericCounter += 1;
  // Kept pronoun-neutral (no bare first-person without a paired third-person
  // pronoun) since a few prompts in this catalog validate with
  // requiresThirdPerson and this fallback has no way to know which ones do.
  const fallback = [
    `That's a fair way to describe the ${field.replace(/([A-Z])/g, " $1").toLowerCase().trim()} here.`,
    `That sounds close to what actually happened.`,
    `Yes, that matches it pretty well.`,
  ];
  return fallback[genericCounter % fallback.length];
}

/** Prompts where the synthetic patient should answer something other than the
 * first enum value, so the audit walks the clinically expected path. */
const PROMPT_ANSWER_OVERRIDES: Record<string, string> = {
  // values[0] is "guilty", which routes every audit run through the
  // guilty-verdict recheck branch and never exercises the ordinary
  // announce-the-verdict path. The trial is designed to end in acquittal
  // often enough that this is the more representative run.
  "tbct-s08-n14-p04-participant-verdict": "not_guilty",
};

let choiceFormatCounter = 0;

export function syntheticPatientInput(prompt: PromptItem): PatientInput {
  const validation = validationOf(prompt);
  const fields = prompt.outputFields;
  // Alternate between the button-shaped answer and the typed/transcribed one
  // for the SAME value. Always submitting the canonical token meant the audit
  // never went through the text path, which is where the enum matching used
  // to reject every natural phrasing ("not ready", "무죄") and pause the
  // session -- green audits, broken live sessions.
  if (validation.kind === "boolean") {
    choiceFormatCounter += 1;
    return choiceFormatCounter % 2 === 0 ? { kind: "boolean", value: true } : { kind: "text", value: "yes" };
  }
  // Phase 1 (runtime orchestration simplification): private_placeholder_labels
  // is now a closed-form kind like boolean/enum above -- it requires an
  // explicit decline or a nameable letter, so a generic free-text reply
  // (this prompt's outputField-derived nextReply() fallback below) no longer
  // parses and the audit would see a clarification turn instead of the
  // normal path. Alternates decline/accept like the boolean/enum branches
  // above, exercising both real paths.
  if (validation.kind === "private_placeholder_labels") {
    choiceFormatCounter += 1;
    return choiceFormatCounter % 2 === 0 ? { kind: "text", value: "no" } : { kind: "text", value: "X" };
  }
  if (validation.kind === "enum" && validation.values?.length) {
    const canonical = PROMPT_ANSWER_OVERRIDES[prompt.id] ?? String(validation.values[0]);
    choiceFormatCounter += 1;
    return choiceFormatCounter % 2 === 0
      ? { kind: "single_choice", value: canonical }
      : { kind: "text", value: canonical.replace(/_/g, " ") };
  }
  if (validation.kind && SUM_TO_100_PAIR_KINDS.has(validation.kind) && fields.length === 2) {
    return { kind: "rating", value: "60, 40" };
  }
  // participationRatingStable is a free-text reflection field ("How does
  // that feel to you now?"), not a number -- excluded despite containing
  // "Rating" so the synthetic reply is realistic natural language.
  if (validation.kind === "rating" || validation.kind === "paired_ratings" || fields.some((field) => field !== "participationRatingStable" && /percent|rating|score|weight|intensit/i.test(field))) {
    const max = validation.max ?? 100;
    const value = Math.max(validation.min ?? 0, Math.min(max, max >= 10 ? 55 : max));
    return { kind: "rating", value: fields.map((_, index) => String(Math.max(validation.min ?? 0, value - index))).join(", ") || String(value) };
  }
  if (fields.length > 1) {
    // Multi-field prompts are parsed by an explicit "field: value" regex
    // (runtime-context.ts) rather than free text, so the field-name prefix
    // must stay -- only the reply text after the colon is varied here.
    return { kind: "text", value: fields.map((field) => `${field}: ${nextReply(field)}`).join("; ") };
  }
  const field = fields[0] ?? "response";
  return { kind: "text", value: nextReply(field) };
}

export const insufficientPatientInputs: PatientInput[] = [
  { kind: "text", value: "몰라" },
  { kind: "text", value: "그냥" },
  { kind: "text", value: "싫어요" },
  { kind: "text", value: "잘 모르겠어요" },
];
