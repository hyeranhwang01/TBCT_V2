import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PatientInputControls } from "@/patient/components/patient-input-controls";

// Regression test: S07's Consensus-chair re-weighing prompt
// (consensusAdvantageWeight + consensusDisadvantageWeight, validation.kind
// "consensus_weights") needs TWO numbers that sum to 100 -- but only
// "paired_ratings"-prefixed validation kinds used to render the two-input
// PairedRatingInput; "consensus_weights" fell through to the single-value
// RatingInput, so the UI could only ever submit one number for a two-field
// requirement. extractRuntimeState always rejected that as insufficient,
// so this step could never actually complete in a real session (confirmed
// live in production -- see the fix comment in this file's source).
describe("PatientInputControls: consensus_weights renders a two-number paired input", () => {
  it("shows two separate rating inputs, not one, for validation.kind consensus_weights", () => {
    render(
      <PatientInputControls
        promptItem={{
          type: "rating",
          validation: { kind: "consensus_weights", min: 0, max: 100 },
          outputFields: ["consensusAdvantageWeight", "consensusDisadvantageWeight"],
        }}
        onSubmit={() => {}}
      />,
    );
    const numberInputs = screen.getAllByRole("spinbutton");
    expect(numberInputs).toHaveLength(2);
    // A single-value RatingInput would render one "Submit rating" button;
    // the paired control renders "Submit both ratings" instead.
    expect(screen.getByRole("button", { name: /submit both ratings/i })).toBeInTheDocument();
  });

  it("submits both numbers together as a comma-joined value, in outputFields order", () => {
    const onSubmit = vi.fn();
    render(
      <PatientInputControls
        promptItem={{
          type: "rating",
          validation: { kind: "consensus_weights", min: 0, max: 100 },
          outputFields: ["consensusAdvantageWeight", "consensusDisadvantageWeight"],
        }}
        onSubmit={onSubmit}
      />,
    );
    const [first, second] = screen.getAllByRole("spinbutton");
    fireEvent.change(first, { target: { value: "60" } });
    fireEvent.change(second, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /submit both ratings/i }));

    expect(onSubmit).toHaveBeenCalledWith({ kind: "rating", value: "60, 40" });
  });
});
