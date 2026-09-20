import { describe, expect, it } from "vitest";
import { HISTORY_CAPABLE_SESSIONS, sessionSupportsProgressTab } from "@/clinician/pages/monitoring/session-progress-panel";
import { TBCT_S02_BINDINGS } from "@/patient/sessions/s02/worksheet-binding";

// The clinician progress tab reads its item/score pair by worksheet field KEY,
// as a string. A key that no longer exists draws no table and raises no error,
// so the pair is pinned against the session's own bindings
// (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions, stage 3).

describe("the clinician progress tab for S02", () => {
  it("is offered for S02, and reads the cognitive distortions rather than the problems and goals it used to", () => {
    expect(sessionSupportsProgressTab("tbct-s02")).toBe(true);
    expect(HISTORY_CAPABLE_SESSIONS["tbct-s02"]).toEqual([
      { itemsKey: "distortionExamples", scoresKey: "cdQuestScores", label: "Cognitive distortions" },
    ]);
  });

  it("names only worksheet field keys S02 actually binds", () => {
    const bound = new Set(TBCT_S02_BINDINGS.map((binding) => binding.worksheetFieldKey));
    for (const config of HISTORY_CAPABLE_SESSIONS["tbct-s02"]) {
      expect(bound, config.itemsKey).toContain(config.itemsKey);
      expect(bound, config.scoresKey).toContain(config.scoresKey);
    }
  });

  it("leaves a session without an item/score pair out, rather than drawing an empty table", () => {
    expect(sessionSupportsProgressTab("tbct-s01")).toBe(false);
    expect(sessionSupportsProgressTab(undefined)).toBe(false);
  });
});
