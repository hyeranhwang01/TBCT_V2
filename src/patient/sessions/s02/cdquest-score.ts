// The CD-Quest grid from the book's appendix (Table A1): frequency across,
// intensity down, and the cell is the item's score. Moved here from the
// retired s02/turn-rules.ts (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02) -- the worksheet, the homework form
// and the prompt-driven session all score with it.
//
//                      no    1-2 days  3-5 days  6-7 days
//   a little (<=30%)    0        1         2         3
//   quite (31-70%)      0        2         3         4
//   very much (>70%)    0        3         4         5
//
// which is frequency + intensity - 1, and 0 whenever it did not occur. Fifteen
// items x 5 = 0-75, matching the book's own stated range.
export type CdQuestGrade = 0 | 1 | 2 | 3;

export function cdQuestScore(frequency: CdQuestGrade, intensity: CdQuestGrade): number {
  if (frequency === 0 || intensity === 0) return 0;
  return frequency + intensity - 1;
}

/** The empty row: a pattern the participant had no example for. Stored rather
 * than skipped so the row stays aligned with the registry and the worksheet
 * shows the pattern as looked at. */
export const NO_EXAMPLE_MARKER = "—";
