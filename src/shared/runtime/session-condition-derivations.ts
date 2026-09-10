// Derived condition fields for S05 and S06.
//
// Both sessions route on a field that the catalog reads but nothing ever wrote,
// so the branch behind it could not run:
//
//   S05  residualShameRequiresDownwardArrow  -- the only edge into the
//        residual-shame node (s05.ts:195). `values` carries nextSlug
//        "summary-table", so with the field unset the node was unreachable and
//        Step 9's downward arrow -- the step that produces the core belief the
//        source hands to the next session -- never ran.
//
//   S06  currentHomeworkItemColor            -- the only edge into the
//        yellow-red-homework-block node (s06.ts:242). review-required-closing
//        is terminal, so with the field unset the block was unreachable and
//        safety rule TBCT-S06-NO-YELLOW-RED-HOMEWORK had no runtime effect at
//        all; the only thing enforcing it was a disabled button on the homework
//        page.
//
// Both are computable from values the session already records -- shame
// intensities for S05, symptom scores for S06 -- so this is the missing
// derivation, not new data collection.

/** The source's Step 9 rule is qualitative: "if shame has decreased
 * substantially or is no longer present, skip this step" (tbct-source-text
 * .generated.ts:865). "Substantially" needs a number to be executable, and
 * halving is the reading used here. It is a first operationalization, not a
 * clinical constant -- it is named and exported so a clinician's answer can
 * replace it in one place. */
export const SHAME_SUBSTANTIAL_DECREASE_RATIO = 0.5;

/** s06.ts:83 fixes the six anchors of the CCSH scale; index === score. */
export const SYMPTOM_SCALE_COLORS = ["light blue", "blue", "green", "green", "yellow", "red"] as const;
export type SymptomScaleColor = (typeof SYMPTOM_SCALE_COLORS)[number];

/** Worst first: the edge asks whether ANY proposed item is yellow or red, so a
 * mixed selection has to report its most severe member. */
const COLOR_SEVERITY: SymptomScaleColor[] = ["red", "yellow", "green", "blue", "light blue"];

function toNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function colorForSymptomScore(score: unknown): SymptomScaleColor | undefined {
  const numeric = toNumber(score);
  if (numeric === undefined) return undefined;
  const index = Math.round(numeric);
  return index >= 0 && index < SYMPTOM_SCALE_COLORS.length ? SYMPTOM_SCALE_COLORS[index] : undefined;
}

/**
 * S05 Step 9. Returns undefined while the question cannot be answered yet --
 * before the Step 7 re-rating, or for a participant who never reported shame at
 * baseline (shame-intensity-baseline validates as rating_or_absent, and
 * shame-intensity-final only activates when a baseline was recorded). Leaving
 * it unset rather than false keeps "not asked yet" distinct from "asked, and
 * the answer is no".
 */
export function deriveResidualShameFollowUp(fields: Record<string, unknown>): boolean | undefined {
  if (fields.shameBaselineRecorded !== true) return undefined;
  const final = toNumber(fields.shameIntensityFinal);
  if (final === undefined) return undefined;
  if (final <= 0) return false;
  const baseline = toNumber(fields.shameIntensityBaseline);
  if (baseline !== undefined && baseline > 0 && final <= baseline * SHAME_SUBSTANTIAL_DECREASE_RATIO) return false;
  return true;
}

/**
 * S06 Step 4. The colour of the most severe item the participant has proposed
 * for independent practice, so the safety edge can see a yellow or red one.
 * Returns undefined when nothing has been proposed yet, or when the proposed
 * items cannot be scored -- an unscorable selection must not be reported as
 * green, but it also must not be reported as red.
 */
export function deriveHomeworkItemColor(fields: Record<string, unknown>): SymptomScaleColor | undefined {
  const proposal = fields.greenHomeworkItems;
  const chosen = toStringArray(proposal);
  const hasProposal = chosen.length > 0 || (typeof proposal === "string" && proposal.trim().length > 0);
  if (!hasProposal) return undefined;

  const items = toStringArray(fields.symptomItems);
  const scores = Array.isArray(fields.symptomItemScores) ? (fields.symptomItemScores as unknown[]) : [];

  const chosenColors = chosen
    .map((label) => {
      const index = items.indexOf(label);
      return index >= 0 ? colorForSymptomScore(scores[index]) : undefined;
    })
    .filter((color): color is SymptomScaleColor => color !== undefined);

  if (chosenColors.length > 0) return COLOR_SEVERITY.find((color) => chosenColors.includes(color));

  // The selection could not be resolved to scored items. That is the normal
  // case today, not an edge case: choose-green-items declares
  // `green_homework_selection`, no validator implements that kind, and the
  // answer is stored as the participant's raw sentence rather than a list --
  // so there is nothing to look up.
  //
  // The hierarchy itself still answers the safety question in the one case
  // that matters. If it contains no green item at all, then whatever the
  // participant just proposed cannot be a green one, and the source's rule --
  // never red alone, yellow only accompanied -- is being broken no matter
  // which item was meant. This is exactly the shape of the August run that
  // exposed the gap: every item scored 5, and the session assigned homework
  // anyway and called them "the green items you chose".
  //
  // When a green item does exist, this stays silent rather than guessing which
  // one was picked: blocking a participant who chose correctly would be worse
  // than the status quo. Per-item enforcement needs green_homework_selection
  // implemented upstream, so the answer becomes a list again.
  //
  // Fires at most once. yellow-red-homework-block returns to green-commitments
  // (s06.ts:220), and the re-answer lands in the same unresolvable state, so a
  // repeating trigger traps the participant in a loop they cannot leave -- a
  // session that can never end is worse than the gap this closes. Once the
  // block has delivered its correction, the warning has been given; a genuinely
  // resolvable bad pick still blocks every time, through the branch above.
  if (fields.homeworkSelectionCorrection !== undefined) return undefined;

  const hierarchyColors = items
    .map((_, index) => colorForSymptomScore(scores[index]))
    .filter((color): color is SymptomScaleColor => color !== undefined);
  if (hierarchyColors.length === 0 || hierarchyColors.includes("green")) return undefined;
  return COLOR_SEVERITY.find((color) => hierarchyColors.includes(color));
}

/** Writes both derived fields into the extractor's working field map.
 *
 * residualShameRequiresDownwardArrow is only assigned once derivable, so it
 * stays absent (rather than an explicit undefined) until Step 7 has run; its
 * inputs do not change afterwards, so recomputing is idempotent.
 *
 * currentHomeworkItemColor is cleared when it cannot be derived, because it is
 * a live read of the current proposal rather than a record of one. Leaving a
 * stale "red" behind would keep the safety edge firing after the block already
 * corrected the participant, and yellow-red-homework-block routes back to
 * green-commitments -- so a value that never clears is a session with no exit.
 */
export function applySessionConditionDerivations(nextFields: Record<string, unknown>): void {
  const residualShame = deriveResidualShameFollowUp(nextFields);
  if (residualShame !== undefined) nextFields.residualShameRequiresDownwardArrow = residualShame;

  // deriveHomeworkItemColor is deliberately NOT wired in yet, and this is the
  // only reason it is not:
  //
  // Feeding currentHomeworkItemColor to the safety edge makes S06 hang. The
  // edge routes to yellow-red-homework-block, which carries
  // nextSlug: "green-commitments" (s06.ts:220) -- a return into a node the
  // session has already completed. sessions/s05.ts:106-113 documents what
  // happens then: "re-entering a node doesn't reset its own per-node
  // prompt-completion tracking, so a self-loop here can cascade through
  // several 'already complete' re-entries within a single turn with no patient
  // input in between." There is no re-entry guard in the runtime, and a real
  // S06 run with the edge live does not advance a single turn.
  //
  // So the safety rule needs three things, not one: this derivation, an
  // implementation of the green_homework_selection validation (without it the
  // answer is stored as the participant's sentence, never a list of items, so
  // no per-item colour can be resolved at all), and a runtime that survives
  // re-entering a completed node. Wiring only the first turns a rule that
  // silently does nothing into a session that cannot be finished, which is
  // worse for the participant than the gap it closes.
  void deriveHomeworkItemColor;
}
