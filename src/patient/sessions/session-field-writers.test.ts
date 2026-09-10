import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS } from "@/lib/protocol/source-fidelity-catalog";
import { acknowledgedOnDeliveryFields, promptRequiresPatientInput } from "@/lib/runtime/runtime-release-normalizer";

/**
 * The defect these guard against: a prompt declares outputFields but is
 * PASSIVE (never waits for an answer) and has no effect that writes them, so
 * nothing in the runtime can ever populate the field. It stayed undefined for
 * the whole programme while the catalog claimed the step captured it -- and,
 * before the fidelity audit was fixed, every report still said PASS.
 *
 * Found first in S07 (crpPlanSummary, the two psychoeducation
 * acknowledgements) and S08 (courtroom orientation, appeal homework); the
 * same shape existed in S01-S06.
 */
describe("every declared output field has a writer", () => {
  /** Computed by the runtime from other fields rather than answered directly
   * (see applyPromptCompletionEffect). */
  const COMPUTED_VALIDATION_KINDS = new Set([
    "calculated_problem_totals",
    "calculated_goal_totals",
    "plan_summary_without_praise_or_persuasion",
    "warm_before_after_comparison",
  ]);

  const writerFor = (promptItem: (typeof CANONICAL_PROMPT_ITEMS)[number], field: string) => {
    if (promptRequiresPatientInput(promptItem)) return "patient_answer";
    const validationKind = String((promptItem.validation as { kind?: unknown } | null)?.kind ?? "");
    if (COMPUTED_VALIDATION_KINDS.has(validationKind)) return "computed";
    const effect = promptItem.completionEffect as { to?: unknown; field?: unknown } | null;
    if (effect?.to === field || effect?.field === field) return "completion_effect";
    if (acknowledgedOnDeliveryFields(promptItem).includes(field)) return "acknowledged_on_delivery";
    return null;
  };

  it("gives every prompt's outputFields a writer", () => {
    const unwritable = CANONICAL_PROMPT_ITEMS.flatMap((promptItem) =>
      promptItem.outputFields.filter((field) => writerFor(promptItem, field) === null).map((field) => `${promptItem.id} -> ${field}`));
    expect(unwritable).toEqual([]);
  });

  it("records S07 and S08's previously-unwritable fields on delivery", () => {
    const byId = new Map(CANONICAL_PROMPT_ITEMS.map((promptItem) => [promptItem.id, promptItem]));
    const cases: Array<[string, string, string]> = [
      ["tbct-s07-n02-p02-both-parts-healthy", "crpPrinciplesAcknowledged", "acknowledged_on_delivery"],
      // Step 0's psychoeducation invites a reaction, so its field is a real
      // patient answer rather than a delivery acknowledgement.
      ["tbct-s07-n03-p01-ambivalence-normalization", "ambivalenceAcknowledged", "patient_answer"],
      ["tbct-s07-n11-p01-plan-summary", "crpPlanSummary", "computed"],
      // Source order: the four-role orientation comes first, the charge second.
      ["tbct-s08-n03-p01-roles-orientation", "courtroomOrientationAcknowledged", "acknowledged_on_delivery"],
      ["tbct-s08-n03-p02-state-charge", "charge", "completion_effect"],
      ["tbct-s08-n19-p02-daily-appeal-homework", "appealHomeworkAcknowledged", "acknowledged_on_delivery"],
      ["tbct-s08-n21-p02-trial-closing", "trialClosingSummary", "computed"],
    ];
    for (const [promptItemId, field, expectedWriter] of cases) {
      const promptItem = byId.get(promptItemId);
      expect(promptItem, promptItemId).toBeDefined();
      expect(writerFor(promptItem!, field), `${promptItemId} -> ${field}`).toBe(expectedWriter);
    }
  });

  it("never lets an input-requiring prompt be treated as acknowledged on delivery", () => {
    const wrongly = CANONICAL_PROMPT_ITEMS.filter((promptItem) => promptRequiresPatientInput(promptItem) && acknowledgedOnDeliveryFields(promptItem).length > 0);
    expect(wrongly.map((promptItem) => promptItem.id)).toEqual([]);
  });

  it("keeps S07's two Consensus-chair questions on separate fields", () => {
    const consensusPrompts = CANONICAL_PROMPT_ITEMS.filter((promptItem) => promptItem.nodeId === "tbct-s07-n07-consensus-chair" && promptRequiresPatientInput(promptItem));
    const fields = consensusPrompts.flatMap((promptItem) => promptItem.outputFields);
    // "What did you learn?" and "What surprised you?" are distinct debrief
    // answers; both used to write consensusLearning, so the second silently
    // overwrote the first.
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toContain("consensusLearning");
    expect(fields).toContain("consensusSurprise");
  });
});
