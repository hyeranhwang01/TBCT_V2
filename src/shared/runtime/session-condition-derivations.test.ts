import { describe, expect, it } from "vitest";
import {
  SHAME_SUBSTANTIAL_DECREASE_RATIO,
  applySessionConditionDerivations,
  colorForSymptomScore,
  deriveHomeworkItemColor,
  deriveResidualShameFollowUp,
} from "@/shared/runtime/session-condition-derivations";

describe("deriveResidualShameFollowUp (S05 Step 9)", () => {
  it("stays unanswered for a participant who never reported shame", () => {
    // shame-intensity-baseline validates as rating_or_absent, and the Step 7
    // re-rating only activates when a baseline was recorded.
    expect(deriveResidualShameFollowUp({ shameIntensityFinal: 80 })).toBeUndefined();
    expect(deriveResidualShameFollowUp({ shameBaselineRecorded: false, shameIntensityFinal: 80 })).toBeUndefined();
  });

  it("stays unanswered until the Step 7 re-rating has happened", () => {
    expect(deriveResidualShameFollowUp({ shameBaselineRecorded: true, shameIntensityBaseline: 80 })).toBeUndefined();
  });

  it("skips the step when shame is no longer present", () => {
    expect(deriveResidualShameFollowUp({ shameBaselineRecorded: true, shameIntensityBaseline: 80, shameIntensityFinal: 0 })).toBe(false);
  });

  it("skips the step when shame decreased substantially", () => {
    const decreased = 80 * SHAME_SUBSTANTIAL_DECREASE_RATIO;
    expect(deriveResidualShameFollowUp({ shameBaselineRecorded: true, shameIntensityBaseline: 80, shameIntensityFinal: decreased })).toBe(false);
  });

  it("requires the downward arrow when shame persists meaningfully", () => {
    expect(deriveResidualShameFollowUp({ shameBaselineRecorded: true, shameIntensityBaseline: 80, shameIntensityFinal: 70 })).toBe(true);
    // The August run that exposed this: both ratings stayed at 100.
    expect(deriveResidualShameFollowUp({ shameBaselineRecorded: true, shameIntensityBaseline: 100, shameIntensityFinal: 100 })).toBe(true);
  });

  it("reads string ratings the same as numeric ones", () => {
    expect(deriveResidualShameFollowUp({ shameBaselineRecorded: true, shameIntensityBaseline: "100", shameIntensityFinal: "90" })).toBe(true);
  });
});

describe("deriveHomeworkItemColor (S06 Step 4)", () => {
  const items = ["speaking up in a meeting", "calling a stranger", "eating alone in public"];

  it("maps every score to its CCSH anchor colour", () => {
    expect([0, 1, 2, 3, 4, 5].map(colorForSymptomScore)).toEqual(["light blue", "blue", "green", "green", "yellow", "red"]);
    expect(colorForSymptomScore(9)).toBeUndefined();
    expect(colorForSymptomScore("not a score")).toBeUndefined();
  });

  it("reports nothing before the participant has proposed anything", () => {
    expect(deriveHomeworkItemColor({ symptomItems: items, symptomItemScores: [2, 4, 5] })).toBeUndefined();
  });

  it("reports green when every proposed item is green", () => {
    expect(deriveHomeworkItemColor({
      symptomItems: items,
      symptomItemScores: [2, 3, 5],
      greenHomeworkItems: [items[0], items[1]],
    })).toBe("green");
  });

  it("reports the most severe item in a mixed selection", () => {
    // The edge asks whether ANY proposed item is yellow or red, so one bad item
    // has to surface even alongside acceptable ones.
    expect(deriveHomeworkItemColor({
      symptomItems: items,
      symptomItemScores: [2, 4, 3],
      greenHomeworkItems: [items[0], items[1], items[2]],
    })).toBe("yellow");
  });

  it("reports red for the all-red selection that slipped through in testing", () => {
    expect(deriveHomeworkItemColor({
      symptomItems: items,
      symptomItemScores: [5, 5, 5],
      greenHomeworkItems: [items[0], items[1]],
    })).toBe("red");
  });

  it("stays silent when the selection is unresolvable but a green item exists", () => {
    // Blocking a participant who may well have chosen the green item would be
    // worse than the status quo, so an unresolvable selection only speaks up
    // when no correct choice was available at all.
    expect(deriveHomeworkItemColor({
      symptomItems: items,
      symptomItemScores: [2, 3, 4],
      greenHomeworkItems: ["an item that is not on the list"],
    })).toBeUndefined();
  });

  it("flags an unresolvable selection when the hierarchy has no green item", () => {
    // The shape of the August run: green_homework_selection is unimplemented,
    // so the answer arrives as a sentence rather than a list -- but every item
    // scored red, so whatever was meant cannot have been green.
    expect(deriveHomeworkItemColor({
      symptomItems: items,
      symptomItemScores: [5, 5, 5],
      greenHomeworkItems: "That's a fair way to describe the green homework items here.",
    })).toBe("red");
    expect(deriveHomeworkItemColor({
      symptomItems: items,
      symptomItemScores: [4, 5, 4],
      greenHomeworkItems: "I'll try the meeting one.",
    })).toBe("red");
    expect(deriveHomeworkItemColor({
      symptomItems: items,
      symptomItemScores: [4, 4, 4],
      greenHomeworkItems: "I'll try the meeting one.",
    })).toBe("yellow");
  });

  it("stays silent before anything has been proposed, even with an all-red hierarchy", () => {
    expect(deriveHomeworkItemColor({ symptomItems: items, symptomItemScores: [5, 5, 5] })).toBeUndefined();
    expect(deriveHomeworkItemColor({ symptomItems: items, symptomItemScores: [5, 5, 5], greenHomeworkItems: "  " })).toBeUndefined();
  });
});

describe("applySessionConditionDerivations", () => {
  it("leaves both fields absent when neither can be derived yet", () => {
    const fields: Record<string, unknown> = { symptomItems: ["a"] };
    applySessionConditionDerivations(fields);
    expect("residualShameRequiresDownwardArrow" in fields).toBe(false);
    expect("currentHomeworkItemColor" in fields).toBe(false);
  });

  it("writes the S05 field, and leaves the S06 colour unwired for now", () => {
    const fields: Record<string, unknown> = {
      shameBaselineRecorded: true,
      shameIntensityBaseline: 90,
      shameIntensityFinal: 85,
      symptomItems: ["a", "b"],
      symptomItemScores: [5, 2],
      greenHomeworkItems: ["a"],
    };
    applySessionConditionDerivations(fields);
    expect(fields.residualShameRequiresDownwardArrow).toBe(true);
    // deriveHomeworkItemColor still resolves this selection as red, but feeding
    // it to the safety edge hangs the session -- see the comment on
    // applySessionConditionDerivations.
    expect(deriveHomeworkItemColor(fields)).toBe("red");
    expect("currentHomeworkItemColor" in fields).toBe(false);
  });
});

describe("yellow/red block loop safety", () => {
  const items = ["a", "b"];
  const allRed = { symptomItems: items, symptomItemScores: [5, 5], greenHomeworkItems: "I'll try one of them." };

  it("fires the hierarchy fallback before the block has run", () => {
    expect(deriveHomeworkItemColor(allRed)).toBe("red");
  });

  it("stops firing once the block has delivered its correction", () => {
    // yellow-red-homework-block returns to green-commitments, and the
    // re-answer is unresolvable in the same way -- so a repeating trigger
    // would trap the participant in a loop with no exit.
    expect(deriveHomeworkItemColor({ ...allRed, homeworkSelectionCorrection: "acknowledged" })).toBeUndefined();
  });

  it("still blocks a resolvable bad pick after the correction", () => {
    expect(deriveHomeworkItemColor({
      symptomItems: items,
      symptomItemScores: [5, 2],
      greenHomeworkItems: ["a"],
      homeworkSelectionCorrection: "acknowledged",
    })).toBe("red");
  });
});
