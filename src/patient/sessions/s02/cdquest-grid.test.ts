import { describe, expect, it } from "vitest";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { cdQuestScore } from "@/patient/sessions/s02/cdquest-score";
import { S02_PROMPT_FIELDS } from "@/patient/sessions/s02/prompt-fields";

// The CD-Quest grid from the book's appendix (Table A1). Getting this wrong is
// invisible in a conversation -- the session still runs, the totals are just
// quietly incorrect -- so the grid, the program's arithmetic over what the model
// records (s02/prompt-fields.ts) and the real session's own total are pinned
// here.

describe("the CD-Quest grid", () => {
  it("matches the book's table cell for cell", () => {
    //            no  1-2d  3-5d  6-7d
    const table = [
      [0, 1, 2, 3], // a little (<=30%)
      [0, 2, 3, 4], // quite (31-70%)
      [0, 3, 4, 5], // very much (>70%)
    ];
    for (const [row, intensity] of ([1, 2, 3] as const).entries()) {
      for (const frequency of [0, 1, 2, 3] as const) {
        expect(cdQuestScore(frequency, intensity), `f=${frequency} i=${intensity}`).toBe(table[row][frequency]);
      }
    }
  });

  it("scores a pattern that did not occur as 0, whatever the intensity", () => {
    for (const intensity of [0, 1, 2, 3] as const) expect(cdQuestScore(0, intensity)).toBe(0);
  });

  it("stays inside the 0-75 range the book states for fifteen items", () => {
    expect(cdQuestScore(3, 3) * COGNITIVE_DISTORTIONS.length).toBe(75);
    expect(cdQuestScore(0, 0) * COGNITIVE_DISTORTIONS.length).toBe(0);
  });
});

const derive = (fields: Record<string, unknown>) => S02_PROMPT_FIELDS.derive!(fields, "ko-KR");

describe("the program's CD-Quest arithmetic over what the model records", () => {
  it("works a score out from the two grades, and takes a stated score as it is", () => {
    const { fields } = derive({ cdQuestFrequency: [2, null], cdQuestIntensity: [3, null], cdQuestStatedScores: [null, 2] });
    expect(fields.cdQuestScores).toEqual([4, 2]);
  });

  it("scores a pattern that did not come up as 0 from either half", () => {
    expect(derive({ cdQuestFrequency: [0], cdQuestIntensity: [null] }).fields.cdQuestScores).toEqual([0]);
  });

  it("leaves a pattern with only one half unscored", () => {
    const { fields, facts } = derive({ cdQuestFrequency: [2, 1], cdQuestIntensity: [2] });
    expect(fields.cdQuestScores).toEqual([3]);
    expect(facts).toEqual(["CD-Quest: 1 of 15 patterns scored so far."]);
  });

  it("re-works a score when a grade is corrected, because stated scores are kept apart", () => {
    const first = derive({ cdQuestFrequency: [3], cdQuestIntensity: [3] }).fields;
    expect(first.cdQuestScores).toEqual([5]);
    const corrected = derive({ ...first, cdQuestIntensity: [1] }).fields;
    expect(corrected.cdQuestScores).toEqual([3]);
  });
});

describe("the real second session's own total", () => {
  // The fifteen answers as the recording settled them (2026-09-18, 44:00-49:00),
  // in the registry's order, as the model records them: the two grades, or the
  // score when the participant stated one. The counselor states the total at
  // 49:05: 34.
  const GRADES: Array<[number, number] | { stated: number }> = [
    [2, 1], [1, 2], [2, 1], [2, 2], [2, 1],
    { stated: 2 }, { stated: 2 }, [3, 1], [3, 1], { stated: 1 },
    { stated: 1 }, [2, 1], [3, 1], [3, 2], [2, 1],
  ];
  const recorded = {
    cdQuestFrequency: GRADES.map((grade) => (Array.isArray(grade) ? grade[0] : null)),
    cdQuestIntensity: GRADES.map((grade) => (Array.isArray(grade) ? grade[1] : null)),
    cdQuestStatedScores: GRADES.map((grade) => (Array.isArray(grade) ? null : grade.stated)),
  };

  it("reproduces 34 from the grid", () => {
    expect(GRADES).toHaveLength(COGNITIVE_DISTORTIONS.length);
    const { fields, facts } = derive(recorded);
    expect(fields.cdQuestScores).toEqual([2, 2, 2, 3, 2, 2, 2, 3, 3, 1, 1, 2, 3, 4, 2]);
    expect(fields.cdQuestTotal).toBe(34);
    expect(facts[0]).toContain("Total: 34 out of 75");
  });

  it("counts the patterns at 4 or above, which is what the closing highlights", () => {
    const { fields } = derive(recorded);
    expect(fields.cdQuestHighCount).toBe(1);
    const scores = fields.cdQuestScores as number[];
    // What if is the one the recording calls out as highest.
    expect(COGNITIVE_DISTORTIONS[scores.findIndex((score) => score >= 4)].id).toBe("what-if");
  });
});
