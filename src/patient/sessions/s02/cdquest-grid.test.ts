import { describe, expect, it } from "vitest";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { cdQuestScore, readCdQuestAnswer } from "@/patient/sessions/s02/turn-rules";

// The CD-Quest grid from the book's appendix (Table A1). Getting this wrong is
// invisible in a conversation -- the session still runs, the totals are just
// quietly incorrect -- so the grid, the parsing and the real session's own total
// are all pinned here.

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

describe("reading a frequency/intensity answer", () => {
  it("reads the day bands, in Korean and English", () => {
    for (const [text, grade] of [
      ["일주일에 한두 번 정도요", 1],
      ["하루 이틀 정도예요", 1],
      ["가끔 있어요", 1],
      ["3에서 5일 정도요", 2],
      ["중간 정도 나타나요", 2],
      ["6에서 7일 정도요", 3],
      ["거의 매일이에요", 3],
      ["once or twice this week", 1],
      ["3 to 5 days", 2],
      ["almost every day", 3],
      // Spelled out, which is how an English answer usually puts it.
      ["one or two days", 1],
      ["three to five days", 2],
      ["six to seven days", 3],
    ] as const) {
      expect(readCdQuestAnswer(`${text} 약간의 강도예요`).frequency, text).toBe(grade);
    }
  });

  it("reads the intensity bands, including a percentage", () => {
    for (const [text, grade] of [
      ["약간이에요", 1],
      ["조금요", 1],
      ["꽤 강했어요", 2],
      ["강한 정도예요", 2],
      ["아주 강했어요", 3],
      ["한 20% 정도요", 1],
      ["한 50% 정도요", 2],
      ["90% 정도요", 3],
      ["a little", 1],
      ["quite strongly", 2],
      ["very strongly", 3],
    ] as const) {
      expect(readCdQuestAnswer(`3에서 5일 정도, ${text}`).intensity, text).toBe(grade);
    }
  });

  it("takes a stated score on its own, the way the recording's participant answered", () => {
    const reading = readCdQuestAnswer("2점인 것 같아요");
    expect(reading.score).toBe(2);
    // The two halves stay unknown; nothing is invented for them.
    expect(reading.frequency).toBeNull();
    expect(reading.intensity).toBeNull();
  });

  it("does not read a bare number as a score, because 2 could be the 3-5 day band", () => {
    expect(readCdQuestAnswer("2").score).toBeNull();
    expect(readCdQuestAnswer("한 3이요").score).toBeNull();
  });

  it("returns no score when only one half arrived, so the step can ask for the other", () => {
    expect(readCdQuestAnswer("3에서 5일 정도요").score).toBeNull();
    expect(readCdQuestAnswer("약간이에요").score).toBeNull();
    expect(readCdQuestAnswer("잘 모르겠어요").score).toBeNull();
  });

  it("scores a pattern that did not come up as 0 without needing an intensity", () => {
    for (const text of ["이건 없었어요", "이번 주에는 안 나타났어요", "해당 없어요", "It did not come up at all this week.", "That one never happens.", "It didn't come up."]) {
      expect(readCdQuestAnswer(text), text).toEqual({ frequency: 0, intensity: 0, score: 0 });
    }
  });
});

describe("the real second session's own total", () => {
  // The fifteen answers as the recording settled them (2026-09-18, 44:00-49:00),
  // in the registry's order. The counselor states the total at 49:05: 34.
  const REAL_ANSWERS = [
    "3에서 5일 정도, 약간의 강도예요",
    "하루 이틀 정도인데 강한 정도예요",
    "3에서 5일 정도 조금이요",
    "3에서 5일 정도 강하게요",
    "3에서 5일 정도 약간이요",
    "2점인 것 같아요",
    "2점인 것 같아요",
    "6에서 7일 정도, 약간의 강도예요",
    "6에서 7일 정도 조금씩이요",
    "1점인 것 같아요",
    "1점인 것 같아요",
    "3에서 5일 정도 조금씩이요",
    "6에서 7일 정도 조금씩이요",
    "6일에서 7일 정도 강하게요",
    "3에서 5일 정도 조금씩이요",
  ];

  it("reproduces 34 from the grid", () => {
    expect(REAL_ANSWERS).toHaveLength(COGNITIVE_DISTORTIONS.length);
    const scores = REAL_ANSWERS.map((answer) => readCdQuestAnswer(answer).score);
    expect(scores.every((score) => score !== null)).toBe(true);
    expect(scores).toEqual([2, 2, 2, 3, 2, 2, 2, 3, 3, 1, 1, 2, 3, 4, 2]);
    expect(scores.reduce<number>((sum, score) => sum + (score ?? 0), 0)).toBe(34);
  });

  it("counts the patterns at 4 or above, which is what the closing highlights", () => {
    const scores = REAL_ANSWERS.map((answer) => readCdQuestAnswer(answer).score ?? 0);
    // What if is the one the recording calls out as highest.
    expect(scores.filter((score) => score >= 4)).toHaveLength(1);
    expect(COGNITIVE_DISTORTIONS[scores.findIndex((score) => score >= 4)].id).toBe("what-if");
  });
});
