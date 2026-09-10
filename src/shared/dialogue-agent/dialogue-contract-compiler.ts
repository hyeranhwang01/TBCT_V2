import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { RuntimePromptItem } from "@/types/protocol-runtime";
import type { RuntimeMessage, RuntimeSession } from "@/types/runtime-session";
import { getWorksheetBindings, hasWorksheetBindings } from "@/shared/worksheet/worksheet-binding-registry";
import { resolvePromptLocaleText } from "@/shared/runtime/runtime-release-normalizer";
import { resolveBracketPlaceholders } from "@/shared/runtime/runtime-static-message";
import type { DialogueContract, ExpectedInputType } from "@/shared/dialogue-agent/dialogue-agent-contract";
import { dialogueContractSchema } from "@/shared/dialogue-agent/dialogue-agent-contract";
import type { WorksheetBinding, WorksheetValueType } from "@/types/worksheet";

// Pattern-based, session-agnostic construct terminology. Keyed by field-NAME
// shape rather than an exact per-session map, because the same construct
// (thought/emotion/behavior/distortion) recurs under different field names
// in different sessions -- S03's "automaticThought" vs S01's
// "candidateOneThought"/"personalThoughtEmotionLink". Order matters: more
// specific patterns (EvidenceFor/EvidenceAgainst/Conclusion/Distortion) are
// checked before the generic Thought/Emotion/Behavior ones so e.g.
// "balancedConclusion" doesn't fall through to nothing. Content is a
// paraphrase of clinical intent already present elsewhere in the catalog
// (S03_FIELD_TERMINOLOGY's prior wording, kept), not new clinical claims.
const CONSTRUCT_TERMINOLOGY_PATTERNS: Array<{ pattern: RegExp; term: string; meaning: string }> = [
  { pattern: /EvidenceFor/i, term: "evidence for", meaning: "concrete facts that would support the thought being true." },
  { pattern: /EvidenceAgainst/i, term: "evidence against", meaning: "concrete facts that don't fit, or contradict, the thought." },
  { pattern: /BalancedConclusion|Conclusion/i, term: "balanced conclusion", meaning: "what the evidence on both sides actually adds up to, in your own words." },
  { pattern: /GlobalEvaluation/i, term: "how am I now", meaning: "your own read on whether things feel the same, a little better, or much better after working through this." },
  { pattern: /Distortion/i, term: "cognitive distortion", meaning: "the pattern an automatic thought seems to follow (e.g. mind-reading, catastrophizing, all-or-nothing thinking)." },
  { pattern: /Thought/i, term: "automatic thought", meaning: "the thought, interpretation, prediction, judgment, or meaning that went through someone's mind — not the feeling itself, and not a description of what happened." },
  { pattern: /Emotion/i, term: "emotion", meaning: "the feeling that came with the thought (e.g. anxious, sad, angry, ashamed) — not the thought and not what someone did." },
  { pattern: /Behavior/i, term: "behavior", meaning: "what someone actually did, or felt the urge to do, in response." },
  { pattern: /BodySensations/i, term: "body sensations", meaning: "physical feelings noticed in the body at the time, like a racing heart or tight chest." },
  { pattern: /^problems?$/i, term: "problem", meaning: "something currently going on that's causing distress or getting in the way." },
  { pattern: /^goals?$/i, term: "goal", meaning: "something you'd like to be different or achieve going forward." },
  { pattern: /DiscomfortDistressSummary/i, term: "the difference between discomfort and distress", meaning: "Discomfort is difficult but still manageable while doing something safe or meaningful; distress feels overwhelming or unmanageable and signals that more support or attention may be needed." },
  { pattern: /Summary/i, term: "summary", meaning: "a short restatement, in your own words, of what's been covered so far." },
];

const PERCENT_SCALE_EXPLANATION = "0 means you don't believe or feel it at all, and 100 means you're completely certain or feeling it as strongly as possible.";
const FIVE_POINT_SCALE_EXPLANATION = "0 means it barely bothers you or barely matters, and 5 means it's as intense or as important as it gets.";

// Field names ending in one of these are internal delivery-tracking flags
// ("did we finish showing this passage", "is the card available"), not
// clinical content a participant authors -- see the file-level note on why
// every OTHER field defaults to participantOwned + assistantMustNotSupply
// (conservative: never let Claude invent clinical content unless a field is
// clearly just a logistics gate).
const ADMINISTRATIVE_FIELD_PATTERN = /(?:Acknowledged|Complete|Available|Presented|Mode)$/;

function ownershipFor(targetField: string | undefined): { participantOwned: boolean; assistantMustNotSupply: boolean } {
  if (targetField && ADMINISTRATIVE_FIELD_PATTERN.test(targetField)) return { participantOwned: false, assistantMustNotSupply: false };
  return { participantOwned: true, assistantMustNotSupply: true };
}

// A binding may opt out of assistantMustNotSupply only for a field it also
// declares system-owned (participantOwned: false, e.g. a calculated
// total). "the participant owns it, but the assistant may supply it" is
// not a coherent state -- tbct-s03.ts's pilot bindings declared exactly
// that for 18 fields, silently defeating ownershipFor()'s conservative
// default for the entire Intra-TR session (see the Patient Authorship
// Invariant plan, .claude/TASK_SCOPE.json note2026_09_05). This clause
// makes that class of binding error structurally impossible to reintroduce.
function ownershipFromBinding(binding: WorksheetBinding | undefined, field: string | undefined): { participantOwned: boolean; assistantMustNotSupply: boolean } {
  return binding
    ? { participantOwned: binding.participantOwned, assistantMustNotSupply: binding.participantOwned ? true : binding.assistantMustNotSupply }
    : ownershipFor(field);
}

/** Is `field` itself a genuinely protected (participant-authored) field,
 * regardless of which prompt/turn is currently active? Used to check a
 * NODE's other requiredFields, not just the current turn's own targetField
 * -- see the Patient Authorship Invariant plan's "잔여 격차" note
 * (.claude/TASK_SCOPE.json note2026_09_07) for why a turn whose OWN field is
 * a pure administrative flag can still need protecting: S08's
 * roles-orientation turn answers only courtroomOrientationAcknowledged, but
 * its free-form delivery restated the participant's own hedged charge as a
 * flat, invented declarative -- charge is a real transcript-confirmed
 * violation this narrower per-turn-field check alone would miss. */
function isFieldProtected(sessionDefinitionId: string, field: string): boolean {
  const binding = getWorksheetBindings(sessionDefinitionId).find((item) => item.canonicalFieldKey === field);
  return ownershipFromBinding(binding, field).assistantMustNotSupply;
}

function expectedInputTypeFromValueType(valueType: WorksheetValueType): ExpectedInputType {
  if (valueType === "percentage") return "percentage_0_100";
  if (valueType === "rating_0_5") return "integer_0_5";
  if (valueType === "boolean") return "yes_no";
  if (valueType === "choice") return "single_choice";
  if (valueType === "text_list" || valueType === "structured_list") return "ordered_list";
  return "free_text";
}

/** Generic fallback used for any session without a reviewed worksheet
 * binding registry entry for this field -- derives the expected control
 * from the PromptItem's own validation spec, the same source
 * runtime-context.ts's deterministic extraction already reads, so this
 * never invents a control shape the runtime doesn't also expect. */
function expectedInputTypeFromValidation(validation: Record<string, unknown> | null | undefined): ExpectedInputType {
  const kind = typeof validation?.kind === "string" ? validation.kind : undefined;
  const max = typeof validation?.max === "number" ? validation.max : undefined;
  if (kind === "boolean" || kind === "safety_check") return "yes_no";
  if (kind === "enum") return "single_choice";
  if (kind === "rating") return max === 100 ? "percentage_0_100" : "integer_0_5";
  if (kind === "array" || kind === "min_items" || kind === "private_placeholder_labels") return "ordered_list";
  return "free_text";
}

/** validation.kind values that pin down exactly what THIS turn's input
 * looks like (a single rating, a single enum pick, yes/no) regardless of
 * how the field's accumulated value is stored. A worksheet binding's
 * valueType describes the STORAGE shape -- e.g. S02's problemRatings is a
 * text_list because the worksheet displays every problem's score at once
 * -- but the prompt re-asks this same rating once per listed problem, so
 * the single-turn expectation is still "one 0-5 rating," not "give me an
 * ordered list." When validation already commits to one of these kinds,
 * it wins over the binding's storage-shape mapping; otherwise (plain text,
 * or a genuinely list-shaped single-turn answer) the binding is used when
 * present, since that's the reviewed, field-specific signal. */
const VALIDATION_KINDS_AUTHORITATIVE_OVER_BINDING = new Set(["rating", "enum", "boolean", "safety_check"]);

function resolveExpectedInputType(binding: WorksheetBinding | undefined, validation: Record<string, unknown> | null | undefined): ExpectedInputType {
  const kind = typeof validation?.kind === "string" ? validation.kind : undefined;
  if (kind && VALIDATION_KINDS_AUTHORITATIVE_OVER_BINDING.has(kind)) return expectedInputTypeFromValidation(validation);
  if (binding) return expectedInputTypeFromValueType(binding.valueType);
  return expectedInputTypeFromValidation(validation);
}

/** Reads canonical RuntimeContext.fields directly -- never chat text, never a
 * cached/stale copy -- so a worksheet edit is reflected in the very next
 * dialogue turn. Always includes the current node's own requiredFields and
 * the active targetField; additionally includes every worksheet-bound field
 * (for any session with a reviewed binding registry entry -- see
 * worksheet-binding-registry.ts) because those are precisely the fields an
 * edit can make stale for a LATER node that didn't itself capture them --
 * this generalizes what used to be a hardcoded 4-field S03 list to
 * whatever the reviewed binding registry actually covers, for any session
 * that has one. */
function confirmedStateFor(session: RuntimeSession, node: ClinicalStageNode, targetField: string | undefined) {
  const fields = session.runtimeContext.fields;
  const relevantKeys = new Set<string>(node.requiredFields);
  if (targetField) relevantKeys.add(targetField);
  if (hasWorksheetBindings(session.sessionDefinitionId)) {
    for (const binding of getWorksheetBindings(session.sessionDefinitionId)) relevantKeys.add(binding.canonicalFieldKey);
  }
  const state: Record<string, unknown> = {};
  for (const key of relevantKeys) {
    if (fields[key] !== undefined && fields[key] !== "") state[key] = fields[key];
  }
  return state;
}

function choiceOptionsFor(promptItem: PromptItem) {
  const validation = promptItem.validation as { values?: unknown } | null | undefined;
  return Array.isArray(validation?.values) ? validation.values.map(String) : undefined;
}

function terminologyFor(targetField: string | undefined, expectedInputType: ExpectedInputType) {
  if (!targetField || expectedInputType === "yes_no" || expectedInputType === "integer_0_5" || expectedInputType === "percentage_0_100") return undefined;
  return CONSTRUCT_TERMINOLOGY_PATTERNS.find((entry) => entry.pattern.test(targetField));
}

function scaleExplanationFor(expectedInputType: ExpectedInputType) {
  if (expectedInputType === "percentage_0_100") return PERCENT_SCALE_EXPLANATION;
  if (expectedInputType === "integer_0_5") return FIVE_POINT_SCALE_EXPLANATION;
  return undefined;
}

// Source-mandated conduct rules (S07/S08 CRITICAL POINTs and Key Principles)
// keyed by the prompt they govern. These are live conversational behaviors --
// naming the prosecutor's voice in the jury room, offering to replace a
// passive defense attorney, gently correcting a first-person slip -- that no
// deterministic branch can perform, so they must reach the model explicitly.
// Before this, their only channel was the raw source excerpt that happened to
// fall inside a node's therapeuticObjective; several (the defense-step
// interventions, the session-wide "never coach" restriction list) fell
// outside every node's range and never reached the model at all.
const THIRD_PERSON_RULE = "Third-person rule: in this courtroom role the participant must speak about the defendant in the third person. If they slip into 'I', correct once, gently and immediately -- e.g. \"I noticed you said 'I' -- remember, right now you are speaking as this role about the defendant\" -- then continue without dwelling on it.";
const NO_COACHING_RULE = "Never coach the prosecution: do not help build, sharpen, suggest, or improve prosecution evidence or rebuttals in any way. Receive what the participant offers and move on.";
// The prosecutor's chair is where the accusation gets said out loud in
// someone else's voice; softening it there is what keeps it unexaminable.
const LET_PROSECUTOR_BE_UNFAIR = "Let the prosecutor be unfair. Sweeping, harsh or plainly illogical accusations are exactly what this chair is for -- do not correct them, soften them, balance them, or reassure the participant about them. They get examined later, by the jury.";
// Both participant guides make the same promise: these sessions are for
// learning the method on something moderate, and the heaviest material
// belongs with the participant's own therapist.
const MODERATE_TOPIC_RULE = "This exercise is for something real but moderate -- not the very heaviest thing they carry. If what they bring sounds like their heaviest material, gently say a more moderate one works better for learning the method and that the harder ones are worth bringing to their therapist, then invite them to choose another.";
const IMAGINED_FIGURE_RULE ="This figure must be imagined and never a real person close to them -- not a parent, partner, friend, or colleague. If they name someone real and close, gently ask them to picture a neutral imagined figure instead, and say that people who matter to them can be looked at another time in a different exercise.";
const EMPTY_CHAIR_SILENCE = [
  "Empty-chair dialogue rules: the two parts speak DIRECTLY to each other, never to you. Stay out of the exchange -- do not summarise what was just said, do not paraphrase it, do not affirm or empathize with it, and do not reflect it back.",
  "Your only permitted interventions here: direct a part to speak to the other chair (\"Say that to Reason, in the other chair\"), invite the other part to answer (\"Reason, how do you respond?\"), or invite a chair switch. When a part stops after one sentence, invite it to stay with it rather than switching immediately.",
  "Let Emotion speak freely, even when it is fearful, stubborn, harsh or plainly unreasonable -- that is exactly what this chair is for. Do not rescue it, soften it, correct it, or take Reason's side against it.",
];
// S07's own promise to the participant: naming reason and emotion as separate
// parts helps most people, but not everyone experiences them that way.
const REASON_EMOTION_ALTERNATIVE = "If the participant says they cannot tell Reason from Emotion apart, do not insist on the labels: ask instead about \"the inner voice that says go, or yes\" and \"the inner voice that says don't, or no\", and keep using that wording from then on.";
const NO_PRESSURE_REMINDER = "If naming this stirs something -- hesitation, upset, going quiet -- slow down, acknowledge it plainly, and remind them they will never be pressured into taking the feared action, before carrying on.";
const STEP_GUIDANCE_BY_PROMPT_ID: Record<string, string[]> = {
  // --- S07 Step 3: therapist silence during the empty chair ---
  "tbct-s07-n06-p02-emotion-to-reason": EMPTY_CHAIR_SILENCE,
  "tbct-s07-n06-p03-continue-dialogue": EMPTY_CHAIR_SILENCE,
  // --- S07 Step 1: the decisional balance is a conversation, not a form ---
  "tbct-s07-n04-p01-action-in-own-words": ["The action must be concrete and in the participant's own words (\"take the lift instead of the stairs\"), not large and vague (\"stop being anxious\"). If it comes out vague, ask what doing it would actually look like.", MODERATE_TOPIC_RULE, NO_PRESSURE_REMINDER],
  "tbct-s07-n04-p02-disadvantages-first": ["Keep each item small and real (\"the stairwell makes me short of breath\" rather than \"it's awful\"). This is a conversation, not a form being filled in.", NO_PRESSURE_REMINDER],
  "tbct-s07-n04-p03-advantages-second": ["Keep each item small and real. This is a conversation, not a form being filled in.", NO_PRESSURE_REMINDER],
  // --- S07 Steps 2/5: anchors, no editorializing ---
  "tbct-s07-n05-p01-emotion-weight": ["Before asking for the number, briefly re-introduce the two selves as genuinely different parts of the same person with different jobs -- Emotion protects, Reason weighs things up -- and both on their side. One or two sentences, not a lecture.", "Offer the anchors 60/70/80/90/100 if the participant hesitates. State the split back without evaluating it.", REASON_EMOTION_ALTERNATIVE],
  "tbct-s07-n05-p02-reason-weight": ["Offer the anchors 60/70/80/90/100 if the participant hesitates. State the split back without evaluating it.", REASON_EMOTION_ALTERNATIVE],
  "tbct-s07-n05-p03-name-the-split": ["Name the split plainly as a conflict between their Reason and their Emotion, then LET IT STAND. Do not interpret it, do not say which side is right or more reasonable, do not call the gap large or significant, and do not move toward resolving it -- the next step is where the two parts speak for themselves."],
  "tbct-s07-n08-p01-consensus-weights": ["Offer the same anchors (60-100) if the participant hesitates. Do NOT editorialize about the new weights -- no comment on how much they changed, no 'that's a big shift'. Record and restate them plainly."],
  // --- S07 Step 4: the debrief is about the conversation, not its verdict ---
  "tbct-s07-n07-p02-consensus-learning": ["If \"I don't know\" comes up, do not rush past it -- leave room and let them come back to it; an unhurried pause here often produces the most important line of the session.", "Never add learnings of your own, and never upgrade theirs into something more decisive than they meant."],
  "tbct-s07-n07-p04-consensus-emotion-intent": ["Never supply the answer (\"Emotion was trying to protect you\") -- it must be the participant's own read of what their Emotion was doing."],
  "tbct-s07-n07-p05-consensus-parts-needs": ["Never supply the answer -- what each part needed is the participant's to name."],
  // --- S07 Step 6: two outcomes only ---
  "tbct-s07-n09-p01-readiness-decision": ["Only two outcomes exist: ready, or not ready. Never round a conditional or undecided answer UP to 'ready' -- reflect it back and record it as not ready for now. Both outcomes are equally acceptable; show no preference."],
  // --- S08 Step 1: one specific situation, then down to the belief ---
  "tbct-s08-n01-p04-distressing-situation": ["Ask for ONE real, specific situation -- a particular moment, not a general pattern -- together with the thought that went through their mind at the time.", MODERATE_TOPIC_RULE],
  "tbct-s08-n01-p05-downward-arrow": [
    "Follow the thought downward one step at a time (\"if that were true, what would it mean about you?\") until it reaches a belief about who they are. Never propose the belief yourself.",
    "If they wonder why the work moves from the upsetting moment to a belief about their whole self, say plainly: the situation is only the spark, while the belief is the deeper accusation carried across their life -- and the situation is not discarded, since its facts often become useful evidence later in the trial.",
    MODERATE_TOPIC_RULE,
  ],
  // --- S08 opening: the orientation is short, and its reaction is invited ---
  "tbct-s08-n01-p02-belief-as-charge-orientation": ["Keep this to a short orientation, not a lecture -- a few plain sentences, no theory, no jargon."],
  "tbct-s08-n01-p03-orientation-reaction": ["Accept whatever they make of it, including doubt or dislike of the idea. Do not argue them into agreeing, and do not defend the method -- just take their reaction and move on."],
  // --- S08 Steps 5/7: the imagined figures ---
  "tbct-s08-n05-p01-visualize-prosecutor": [IMAGINED_FIGURE_RULE, "The prosecutor is a stern, imagined figure -- a lawyer they invent. Build the picture concretely: sex, age, appearance, manner, expression."],
  "tbct-s08-n07-p02-visualize-defense": [IMAGINED_FIGURE_RULE, "The defense attorney is an imagined figure who is wise and kind. Build the picture concretely: sex, age, appearance, manner, expression."],
  // --- S08 Step 6/10: prosecution turns are never coached ---
  "tbct-s08-n06-p02-prosecution-evidence": [NO_COACHING_RULE, LET_PROSECUTOR_BE_UNFAIR, "One piece of evidence at a time -- up to three, exceptionally four.", THIRD_PERSON_RULE],
  "tbct-s08-n10-p02-rebut-each-defense-item": [NO_COACHING_RULE, "One rebuttal per defense item, presented individually with an emphasized BUT -- never grouped.", THIRD_PERSON_RULE],
  // --- S08 Step 8: defense support rules ---
  "tbct-s08-n08-p02-defense-evidence": [
    "If the defense's evidence is vague or general, ask for one concrete, specific occasion that shows it.",
    "If the participant, as the defense, starts presenting evidence AGAINST the defendant, challenge it at least once: ask \"Who is speaking right now -- the defense, or the prosecution?\" and redirect them to the defense's task.",
    "If the defense attorney seems passive or unable to find anything to say, offer to replace them: suggest imagining a different, more effective defense attorney taking over.",
    THIRD_PERSON_RULE,
  ],
  "tbct-s08-n12-p02-surrebut-each-pair": ["One answer per rebuttal, with an emphasized BUT. The meaning drawn from the evidence must come from the participant.", THIRD_PERSON_RULE],
  "tbct-s08-n12-p03-participant-therefore": ["The \"Therefore...\" conclusion must be completed by the participant in their own words -- never supply, suggest, or complete it yourself.", THIRD_PERSON_RULE],
  // --- S08 Step 14: the therapist sits as Juror 2 ---
  "tbct-s08-n14-p02-juror-role": ["You sit beside the participant as Juror 2. The jury room is private: nothing said here is argued back to either side."],
  "tbct-s08-n14-p03-review-four-blocks": [
    "You sit beside the participant as Juror 2.",
    "Take this block ONE PIECE AT A TIME. Each piece quoted in the task gets its own look before the next; if the participant answers about the block as a whole, or lumps several pieces together, gently walk them back to the first piece they skipped. Do not rush this -- looking at each piece on its own is where the shift usually happens.",
    "If a statement in the jury room sounds like the prosecutor arguing (accusing, condemning, re-litigating), name it as Juror 2: that is the prosecutor's voice, and it is not allowed in the jury room -- ask it to leave, and return to weighing the evidence.",
    "For the prosecution's blocks, help the jury look for cognitive distortions and for relevance ('even if true, is it enough to convict?'). Distortions worth naming when they appear: labelling, all-or-nothing thinking, discounting the positive, mind reading, should statements, blaming, overgeneralising, catastrophising, personalising, magnifying/minimising, mental filter, unfair comparisons. For the defense's blocks, check that the content is factual and true. Never state the conclusion for the participant.",
  ],
  "tbct-s08-n14-p04-participant-verdict": ["The verdict may only ever be stated by the participant. Never suggest, hint at, lean toward, or supply a verdict, and never react to it with approval or disappointment."],
  "tbct-s08-n14-p05-guilty-verdict-recheck": ["A guilty verdict is re-examined through the evidence, never argued against directly. Walk the four blocks again and let the participant decide; the verdict remains theirs either way."],
  // --- S08 Step 15: the one moment you play a character ---
  "tbct-s08-n15-p01-announce-verdict": ["For this one moment -- and only this one -- you take the role of the judge, so the verdict is announced TO someone. Receive it formally and briefly, as a court would ('The court has heard the verdict'), then step straight back out of the role. This is the only character you ever play.", "Do not react to which verdict it is: no approval, no relief, no disappointment."],
  // --- S08 Step 19: the appeal is the real homework ---
  "tbct-s08-n19-p02-daily-appeal-homework": ["Say plainly why this record matters: the old belief rarely gives up quietly, and a day or two later it starts arguing again. A line or two each day with a fresh rating is what keeps the new belief standing -- this is the part that carries the trial into the rest of their life."],
  // --- S08 Step 17: the appeal bridge ---
  "tbct-s08-n17-p02-prosecution-satisfaction": ["If the participant says the prosecution was NOT satisfied, respond with the source's bridge: the prosecution may be requesting an appeal -- which is exactly why an appeal record will be prepared next. Then continue."],
};

export function stepSpecificGuidanceFor(sourcePromptItem: PromptItem): string[] | undefined {
  const curated = STEP_GUIDANCE_BY_PROMPT_ID[sourcePromptItem.id] ?? [];
  const validation = sourcePromptItem.validation as { requiresThirdPerson?: boolean; stateScaleEveryTime?: boolean } | null;
  const derived: string[] = [];
  // Declarative flags the catalog already carries, honored generically so a
  // prompt outside the curated table still gets its rule.
  if (validation?.requiresThirdPerson && !curated.includes(THIRD_PERSON_RULE)) derived.push(THIRD_PERSON_RULE);
  if (validation?.stateScaleEveryTime) derived.push("State the scale explicitly every time you ask for this rating -- the words 'from 0 to 100' must survive your paraphrase.");
  const all = [...curated, ...derived];
  return all.length ? all : undefined;
}

export function compileDialogueContract(input: {
  session: RuntimeSession;
  node: ClinicalStageNode;
  sourcePromptItem: PromptItem;
  runtimePromptItem: RuntimePromptItem;
  lastParticipantMessage?: string;
  recentMessages: RuntimeMessage[];
  clarificationAttemptCount: number;
  /** activeStep.promptIndex === 0 at the orchestrator call site -- see
   * dialogue-agent-contract.ts's isFirstPromptOfNode for what this drives. */
  isFirstPromptOfNode: boolean;
  /** isFirstPromptOfNode AND no node has been completed yet this session --
   * see dialogue-agent-contract.ts's isFirstPromptOfSession. */
  isFirstPromptOfSession: boolean;
  /** Overrides the default fallbackPatientText-derived grounding text with
   * whatever the deterministic layer actually resolved for THIS turn
   * (resolveStaticPatientMessage's contextual/branch-specific approved
   * text when the caller is the normal "ask" path) -- see
   * runtime-orchestrator.ts. Omitted callers (the clarification path) keep
   * the previous fallbackPatientText-only computation, which is already
   * correct there since a clarification's grounding is still "the original
   * question," not the clarification wording itself. */
  currentTaskTextOverride?: string;
  /** From release.policies.sessionPolicies[session.sessionDefinitionId]?.toneGuidance
   * (see runtime-orchestrator.ts's call site) -- omitted entirely when a
   * session has no tone guidance configured, same as every other optional
   * contract field here. */
  sessionToneGuidance?: string;
}): DialogueContract {
  const { session, node, sourcePromptItem, runtimePromptItem } = input;
  const targetField = sourcePromptItem.outputFields[0];
  const binding = getWorksheetBindings(session.sessionDefinitionId).find((item) => item.canonicalFieldKey === targetField);
  const expectedInputType = resolveExpectedInputType(binding, sourcePromptItem.validation);
  const ownership = ownershipFromBinding(binding, targetField);
  // See isFieldProtected's doc comment: this turn's OWN field can be a pure
  // administrative flag while the node it belongs to is still responsible
  // for a genuinely protected field elsewhere (checked via the node's own
  // requiredFields -- the exact signal confirmedStateFor below already
  // reads for the same "what is this node responsible for" purpose).
  const nodeRequiresProtectedField = node.requiredFields.some((field) => field !== targetField && isFieldProtected(session.sessionDefinitionId, field));
  const terminology = terminologyFor(targetField, expectedInputType);

  const contract: DialogueContract = {
    sessionId: node.sessionId,
    nodeId: node.id,
    promptItemId: sourcePromptItem.id,
    roleId: runtimePromptItem.roleId,
    therapeuticObjective: node.objective || node.clinicalPurpose,
    participantRationale: node.participantRationale,
    // Bracket-resolved so Claude's grounding text (and a naive echo of it,
    // like the test fake's default reply) is never itself the source of an
    // unresolved-template rejection -- see the matching fix in
    // runtime-prompt-compiler.ts for why this class of bug is real, not
    // hypothetical (feedback v2 #5).
    currentTaskText: resolveBracketPlaceholders(
      input.currentTaskTextOverride ?? resolvePromptLocaleText(runtimePromptItem.id, runtimePromptItem.fallbackPatientText, session.locale),
      session.runtimeContext,
    ),
    targetField,
    expectedConstruct: terminology?.meaning,
    expectedInputType,
    // Two distinct mechanisms in this codebase both legitimately re-deliver
    // the SAME prompt/near-identical wording for the same node before it's
    // done: an explicit repeat_until loop (S05's per-contributor re-rating),
    // and a single prompt whose own validation.kind is a list-building kind
    // (S02/S06's "name another item" collection, min/max-gated, no
    // executionMode at all -- confirmed live via the 8-session simulated
    // audit: S06's concrete-actions prompt, validation.kind "array", was
    // wrongly caught by the repeated-identical-message check below before
    // this second condition was added).
    isRepeatablePrompt: runtimePromptItem.executionMode === "repeat_until"
      || ["array", "min_items"].includes(String((sourcePromptItem.validation as { kind?: unknown } | null)?.kind ?? "")),
    choiceOptions: expectedInputType === "single_choice" ? choiceOptionsFor(sourcePromptItem) : undefined,
    participantOwned: ownership.participantOwned,
    assistantMustNotSupply: ownership.assistantMustNotSupply,
    nodeRequiresProtectedField,
    worksheetEditAvailable: hasWorksheetBindings(session.sessionDefinitionId),
    confirmedState: confirmedStateFor(session, node, targetField),
    // Named to exactly match dialogueResponseTypeSchema's responseType enum
    // (dialogue-agent-contract.ts), not a separate vocabulary -- these used
    // to be free-standing action names ("ask_current_task",
    // "clarify_current_task", "repair_misunderstanding", "brief_reflection")
    // that had no matching responseType value. Claude reasonably picked
    // "ask_current_task" as responseType on some turns (it's literally
    // listed as an allowed action right here), which the RESPONSE_SCHEMA/
    // dialogueDecisionSchema enum then rejected as invalid, silently
    // discarding the whole decision -- including any transition framing --
    // and falling back to raw deterministic text. Renaming closes that gap.
    allowedActions: [
      "acknowledge",
      "reflect_and_ask",
      "clarify",
      "repair",
      "restore_context",
      "explain_term",
      "explain_scale",
      "explain_rationale",
      "request_missing_field",
    ],
    forbiddenActions: [
      "advance_protocol",
      "supply_participant_answer",
      "diagnose",
      "give_new_treatment_advice",
      "introduce_new_exercise",
      "fork_or_edit_history",
    ],
    relevantTerminology: terminology ? [terminology] : undefined,
    scaleExplanation: scaleExplanationFor(expectedInputType),
    stepSpecificGuidance: stepSpecificGuidanceFor(sourcePromptItem),
    lastParticipantMessage: input.lastParticipantMessage,
    recentContext: input.recentMessages
      .filter((message): message is RuntimeMessage & { role: "patient" | "assistant" } => message.role === "patient" || message.role === "assistant")
      .slice(-4)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 240) })),
    safetyStatus: session.status,
    locale: session.locale,
    clarificationAttemptCount: input.clarificationAttemptCount,
    isFirstPromptOfSession: input.isFirstPromptOfSession,
    isFirstPromptOfNode: input.isFirstPromptOfNode,
    isRoleTransitionPrompt: sourcePromptItem.type === "role_transition",
    // Deliberately sourcePromptItem.modelGuidance (the raw, optional source
    // field -- undefined for anything no clinician has ever edited), NOT
    // runtimePromptItem.modelGuidance (which the release compiler already
    // defaults to the manual's own quoted text -- see
    // runtime-release-normalizer.ts -- whenever a clinician hasn't set one).
    // Reading the runtime-defaulted value here meant this line was, for
    // every still-unedited prompt (the overwhelming majority right now),
    // restating the same manual text already sent above as currentTaskText
    // -- a second, redundant "instruction" pointing at identical content,
    // which nudged Claude toward longer, more elaborate replies trying to
    // honor both. Only ever surface real guidance once a clinician has
    // actually written one.
    clinicianGuidance: sourcePromptItem.modelGuidance?.trim() || undefined,
    sessionToneGuidance: input.sessionToneGuidance?.trim() || undefined,
  };

  return dialogueContractSchema.parse(contract);
}
