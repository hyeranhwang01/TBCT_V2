import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider, UI_LOCALE_STORAGE_KEY } from "@/shared/i18n/context";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { cdQuestScore } from "@/patient/sessions/s02/turn-rules";
import {
  CDQUEST_ROUND_ENTRY_TYPE,
  CdQuestForm,
  buildCdQuestRoundData,
  emptyDraft,
  toCdQuestRounds,
  type CdQuestRound,
} from "@/patient/sessions/s02/cdquest-form";
import { HOMEWORK_LABEL_BY_SESSION } from "@/types/homework";
import type { HomeworkEntryRecord } from "@/types/homework";

// S02 homework: the blank CD-Quest form the real second session hands out at
// 53:30 (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions,
// stage 3). The load-bearing rules are the grid arithmetic -- the same one the
// session uses -- and the book's rule that earlier scores stay hidden while the
// participant is scoring again.

beforeEach(() => globalThis.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "ko"));
afterEach(() => globalThis.localStorage.removeItem(UI_LOCALE_STORAGE_KEY));

const BASELINE = COGNITIVE_DISTORTIONS.map((_, index) => (index % 5) + 1);

function renderForm(options: { rounds?: CdQuestRound[]; baseline?: Array<number | null>; onSave?: ReturnType<typeof vi.fn> } = {}) {
  const onSave = options.onSave ?? vi.fn().mockResolvedValue(undefined);
  render(
    <LocaleProvider>
      <CdQuestForm rounds={options.rounds ?? []} baselineScores={options.baseline ?? BASELINE} onSave={onSave} />
    </LocaleProvider>,
  );
  return onSave;
}

function rowAt(index: number) {
  return screen.getByTestId(`s02-cdquest-row-${index + 1}`);
}

/** Picks a frequency and an intensity in one row, by the band labels the
 * participant actually sees. */
function score(index: number, frequency: string, intensity: string) {
  const row = rowAt(index);
  fireEvent.click(within(within(row).getByRole("group", { name: "얼마나 자주" })).getByRole("button", { name: frequency }));
  fireEvent.click(within(within(row).getByRole("group", { name: "얼마나 강하게" })).getByRole("button", { name: intensity }));
}

function scoreEveryRow(frequency = "3~5일", intensity = "약간 (30% 이하)") {
  for (let index = 0; index < COGNITIVE_DISTORTIONS.length; index += 1) score(index, frequency, intensity);
}

describe("S02 CD-Quest homework form", () => {
  it("lists all fifteen patterns in the registry's order, each with both halves to pick", () => {
    renderForm();
    expect(screen.getAllByTestId(/^s02-cdquest-row-/)).toHaveLength(COGNITIVE_DISTORTIONS.length);
    for (const [index, distortion] of COGNITIVE_DISTORTIONS.entries()) {
      expect(rowAt(index).textContent).toContain(distortion.nameKo);
    }
    expect(screen.getAllByRole("group", { name: "얼마나 자주" })).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(screen.getAllByRole("group", { name: "얼마나 강하게" })).toHaveLength(COGNITIVE_DISTORTIONS.length);
  });

  it("works the score out from the two halves, by the same grid the session uses", () => {
    renderForm();
    // 3-5 days (2) with a little (1) is a 2; 6-7 days (3) with very much (3) is a 5.
    score(0, "3~5일", "약간 (30% 이하)");
    score(1, "6~7일", "아주 강하게 (70% 이상)");
    score(2, "없었어요", "아주 강하게 (70% 이상)");
    expect(screen.getByTestId("s02-cdquest-score-1").textContent).toBe(String(cdQuestScore(2, 1)));
    expect(screen.getByTestId("s02-cdquest-score-2").textContent).toBe(String(cdQuestScore(3, 3)));
    // A pattern that did not come up is a 0 whatever the intensity says.
    expect(screen.getByTestId("s02-cdquest-score-3").textContent).toBe("0");
    // A row with only one half is not scored yet, so the chip shows nothing.
    expect(screen.getByTestId("s02-cdquest-score-4").textContent).toBe("?");
  });

  it("shows the total only once every pattern is scored", () => {
    renderForm();
    score(0, "3~5일", "약간 (30% 이하)");
    expect(screen.getByText("총점 —")).toBeInTheDocument();
    scoreEveryRow();
    expect(screen.getByText(`총점 ${2 * COGNITIVE_DISTORTIONS.length}`)).toBeInTheDocument();
  });

  // The book's rule for a re-rating, and the reason this page is a form rather
  // than an editable copy of the session's table: seeing the old number first
  // anchors the new one.
  it("keeps the session's own scores hidden until the round is finished", async () => {
    renderForm();
    expect(screen.queryByTestId("s02-cdquest-trend")).toBeNull();
    expect(screen.queryByTestId("s02-trend-row-1")).toBeNull();
    expect(screen.getByText(/지난 점수가 보이지 않아요/)).toBeInTheDocument();

    scoreEveryRow();
    fireEvent.click(screen.getByRole("button", { name: "다 매겼어요" }));

    expect(await screen.findByTestId("s02-cdquest-trend")).toBeInTheDocument();
    // Baseline beside this week, one row per pattern.
    expect(screen.getAllByTestId(/^s02-trend-row-/)).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(within(screen.getByTestId("s02-trend-row-1")).getAllByText(/^[0-5]$/).map((node) => node.textContent)).toEqual([String(BASELINE[0]), "2"]);
  });

  it("cannot be finished before all fifteen are scored", () => {
    renderForm();
    const finish = screen.getByRole("button", { name: "다 매겼어요" });
    expect(finish).toBeDisabled();
    scoreEveryRow();
    expect(screen.getByRole("button", { name: "다 매겼어요" })).not.toBeDisabled();
  });

  it("hands the whole round to the caller, examples and all", async () => {
    const onSave = renderForm();
    scoreEveryRow();
    fireEvent.change(within(rowAt(0)).getByRole("textbox"), { target: { value: "  인사를 안 했으니 저를 싫어한다고 생각했어요  " } });
    fireEvent.click(screen.getByRole("button", { name: "다 매겼어요" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const rows = onSave.mock.calls[0][0];
    expect(rows).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(rows[0]).toMatchObject({ frequency: 2, intensity: 1 });
    expect(rows[0].example).toContain("싫어한다고");
  });

  it("keeps the draft and says so when saving fails", async () => {
    renderForm({ onSave: vi.fn().mockRejectedValue(new Error("offline")) });
    scoreEveryRow();
    fireEvent.change(within(rowAt(0)).getByRole("textbox"), { target: { value: "이번 주에도 같은 생각이 들었어요" } });
    fireEvent.click(screen.getByRole("button", { name: "다 매겼어요" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // Still on the form, with the answers intact.
    expect(screen.queryByTestId("s02-cdquest-trend")).toBeNull();
    expect(within(rowAt(0)).getByRole("textbox")).toHaveValue("이번 주에도 같은 생각이 들었어요");
    expect(screen.getByTestId("s02-cdquest-score-1").textContent).toBe("2");
  });

  it("shows every week's total in order once the trend is revealed", async () => {
    renderForm({ rounds: [{ id: "r1", date: "2026-09-25", rows: [], total: 28 }] });
    scoreEveryRow();
    fireEvent.click(screen.getByRole("button", { name: "다 매겼어요" }));
    const trend = await screen.findByTestId("s02-cdquest-trend");
    const baselineTotal = BASELINE.reduce((sum, value) => sum + value, 0);
    // In session, then each stored round, then this one.
    expect(trend.textContent).toContain(String(baselineTotal));
    expect(trend.textContent).toContain("28");
    expect(trend.textContent).toContain(String(2 * COGNITIVE_DISTORTIONS.length));
  });
});

describe("a stored CD-Quest round", () => {
  const draft = emptyDraft().map((row, index) => ({ ...row, example: `예시 ${index + 1}`, frequency: 3 as const, intensity: index === 0 ? (3 as const) : (1 as const) }));

  it("records the grid score for each pattern, the total and how many came out high", () => {
    const data = buildCdQuestRoundData(draft, new Date("2026-09-28T09:00:00Z"));
    expect(data.schemaVersion).toBe(1);
    expect(data.rows).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(data.rows[0]).toMatchObject({ distortionId: COGNITIVE_DISTORTIONS[0].id, distortionNumber: 1, score: 5 });
    expect(data.rows[1].score).toBe(3);
    expect(data.total).toBe(5 + 3 * (COGNITIVE_DISTORTIONS.length - 1));
    // 4 and above is what the session's closing calls out.
    expect(data.highCount).toBe(1);
    // The example is stored trimmed, under the pattern the row belongs to.
    expect(data.rows[14]).toMatchObject({ distortionId: COGNITIVE_DISTORTIONS[14].id, example: "예시 15" });
  });

  it("refuses to build a round that is not fully scored", () => {
    expect(() => buildCdQuestRoundData(emptyDraft())).toThrow(/fifteen/);
  });

  it("reads stored rounds oldest first and skips one that is not a whole CD-Quest", () => {
    const entry = (id: string, data: unknown): HomeworkEntryRecord =>
      ({ id, entryType: CDQUEST_ROUND_ENTRY_TYPE, createdAt: "2026-09-28T09:00:00.000Z", data }) as unknown as HomeworkEntryRecord;
    const whole = buildCdQuestRoundData(draft, new Date("2026-09-28T09:00:00Z"));
    const rounds = toCdQuestRounds([
      entry("late", { ...whole, date: "2026-10-05" }),
      entry("early", { ...whole, date: "2026-09-28" }),
      // Half a round, an unknown pattern, and an old schema: none are shown.
      entry("short", { ...whole, rows: whole.rows.slice(0, 3) }),
      entry("unknown", { ...whole, rows: whole.rows.map((row, index) => (index === 0 ? { ...row, distortionId: "not-a-pattern" } : row)) }),
      entry("old", { ...whole, schemaVersion: 0 }),
    ]);
    expect(rounds.map((round) => round.id)).toEqual(["early", "late"]);
    expect(rounds[0].total).toBe(whole.total);
  });
});

describe("the S02 homework label", () => {
  it("says CD-Quest, not the check-in this session used to be", () => {
    expect(HOMEWORK_LABEL_BY_SESSION["tbct-s02"]).toBe("CD-Quest");
  });
});
