import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { cdQuestScore } from "@/patient/sessions/s02/turn-rules";
import { vi } from "vitest";
import { LocaleProvider } from "@/shared/i18n/context";
import { S02Worksheet } from "@/patient/sessions/s02/worksheet";
import { NO_EXAMPLE_MARKER } from "@/patient/sessions/s02/turn-rules";
import { TBCT_S02_BINDINGS } from "@/patient/sessions/s02/worksheet-binding";
import type { WorksheetView } from "@/types/worksheet";

// The table the participant watches fill in during the walkthrough
// (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions). In the
// recorded second session the participant asked to write in it herself and
// later read the filled table back, so the rows and the current-row marker are
// the point of this component.

/** The stage-2 columns live in their own bound fields, so the view is built
 * from the binding list by canonical key rather than from bindings[0] alone. */
type Values = Partial<Record<"distortionExamples" | "cdQuestScores" | "cdQuestFrequency" | "cdQuestIntensity" | "cdQuestTotal", unknown>>;

function viewWith(values: Values): WorksheetView {
  return {
    sessionDefinitionId: "tbct-s02",
    fields: TBCT_S02_BINDINGS.map((binding) => {
      const value = values[binding.canonicalFieldKey as keyof Values];
      const present = Array.isArray(value) ? value.length > 0 : value !== undefined;
      return {
        binding,
        definition: binding,
        value: present
          ? { value, displayValue: Array.isArray(value) ? value.join(", ") : String(value), status: "draft_extracted" }
          : undefined,
      };
    }),
  } as unknown as WorksheetView;
}

function renderWorksheet(rows: string[], overrides: Partial<Parameters<typeof S02Worksheet>[0]> = {}, scoring: Omit<Values, "distortionExamples"> = {}) {
  return render(
    <S02Worksheet
      view={viewWith({ distortionExamples: rows, ...scoring })}
      activeCanonicalFieldKey="distortionExamples"
      onConfirm={() => {}}
      onEdit={() => {}}
      busy={false}
      locale="ko-KR"
      {...overrides}
    />,
  );
}

/** The value shown under one Session Signals label. Scoped to that block: the
 * row labels and the grid cells repeat the same short strings. */
function signalValue(label: string): string {
  const block = screen.getByText("Session Signals").parentElement!;
  const cell = within(block).getByText(label).parentElement;
  return cell?.querySelector("div:last-child")?.textContent ?? "";
}

describe("S02 worksheet", () => {
  it("renders one row per pattern, numbered in the registry's order", () => {
    renderWorksheet([]);
    const rows = screen.getAllByTestId(/^s02-distortion-row-/);
    expect(rows).toHaveLength(COGNITIVE_DISTORTIONS.length);
    for (const [index, distortion] of COGNITIVE_DISTORTIONS.entries()) {
      expect(screen.getByTestId(`s02-distortion-row-${index + 1}`).textContent).toContain(distortion.nameKo);
    }
  });

  it("puts each stored example in its own pattern's row", () => {
    renderWorksheet(["인사를 안 했으니 저를 싫어하는 거라고 생각했어요", "계획에 실패하면 모든 게 무너질 거예요"]);
    expect(screen.getByTestId("s02-distortion-row-1").textContent).toContain("싫어하는");
    expect(screen.getByTestId("s02-distortion-row-2").textContent).toContain("무너질");
    // A pattern not reached yet shows no example.
    expect(screen.getByTestId("s02-distortion-row-3").textContent).not.toContain("싫어하는");
  });

  it("shows an empty row as looked at but without an example", () => {
    renderWorksheet([NO_EXAMPLE_MARKER]);
    expect(screen.getByTestId("s02-distortion-row-1").textContent).toContain("예시 없음");
  });

  it("marks the pattern being asked about as the current step", () => {
    renderWorksheet(["첫 번째 예시"]);
    expect(screen.getByTestId("s02-distortion-row-2")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("s02-distortion-row-1")).not.toHaveAttribute("aria-current");
  });

  it("does not mark a current step when the walkthrough is not the active field", () => {
    renderWorksheet(["첫 번째 예시"], { activeCanonicalFieldKey: "homeworkReport" });
    expect(screen.getByTestId("s02-distortion-row-2")).not.toHaveAttribute("aria-current");
  });

  it("lets the participant edit their own row read-only beside the chat, and nobody edit it otherwise", () => {
    const { unmount } = renderWorksheet(["첫 번째 예시"], { readOnly: true, allowEdit: true });
    expect(screen.getAllByRole("button").some((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    unmount();

    renderWorksheet(["첫 번째 예시"], { readOnly: true, allowEdit: false });
    expect(screen.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  // ------------------------------------------------------- CD-Quest columns
  //
  // 43:00 onward: the same table gains a score per pattern. At 43:00 the
  // participant read the filled table back and noticed which rows looked worst,
  // which is what the score chips are for.

  it("shows a score chip on each scored pattern, and none on a pattern not scored yet", () => {
    renderWorksheet(["예시 하나", "예시 둘"], {}, { cdQuestScores: [2, 4] });
    expect(screen.getByTestId("s02-distortion-score-1").textContent).toContain("2");
    expect(screen.getByTestId("s02-distortion-score-2").textContent).toContain("4");
    expect(screen.queryByTestId("s02-distortion-score-3")).toBeNull();
  });

  it("shows the two bands the score was built from, and leaves them out for a score stated outright", () => {
    renderWorksheet(["예시 하나", "예시 둘"], {}, { cdQuestScores: [2, 2], cdQuestFrequency: [2, null], cdQuestIntensity: [1, null] });
    const first = screen.getByTestId("s02-distortion-score-1").textContent ?? "";
    expect(first).toContain("3–5일");
    expect(first).toContain("약간");
    // "2점인 것 같아요": the score stands, the halves are unknown and nothing
    // is invented for them.
    const second = screen.getByTestId("s02-distortion-score-2").textContent ?? "";
    expect(second).toContain("2");
    expect(second).not.toContain("일");
  });

  it("reports the total and how many patterns were scored", () => {
    renderWorksheet(Array.from({ length: 15 }, (_, index) => `예시 ${index + 1}`), {}, { cdQuestScores: Array.from({ length: 15 }, () => 2), cdQuestTotal: 30 });
    // Both counters read 15 / 15: every pattern looked at, and every one scored.
    expect(screen.getAllByText(`15 / ${COGNITIVE_DISTORTIONS.length}`)).toHaveLength(2);
    expect(signalValue("총점")).toBe("30");
  });

  it("follows the scoring pointer rather than the example pointer once scoring is the active step", () => {
    renderWorksheet(Array.from({ length: 15 }, (_, index) => `예시 ${index + 1}`), { activeCanonicalFieldKey: "cdQuestScores" }, { cdQuestScores: [2, 2, 2] });
    expect(screen.getByTestId("s02-distortion-row-4")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("s02-distortion-row-3")).not.toHaveAttribute("aria-current");
  });

  // ------------------------------------------------------------ the grid
  //
  // In the recording the counselor put the form up and pointed at it -- "요
  // 매트릭스에 의해서" (985) -- and the participant read her own score off it,
  // answering "2점인 것 같아요" as often as she gave the two halves.

  it("is on screen from the start, as it is on the participant's own form", () => {
    // CD Quest Client version 1 is one sheet: the matrix ("1 2 3 / 2 3 4 /
    // 3 4 5") and the fifteen "enter a personal example of..." fields sit on it
    // together, so the worksheet shows both the whole time too.
    renderWorksheet([]);
    expect(screen.getByTestId("s02-cdquest-grid")).toBeInTheDocument();
    cleanup();

    renderWorksheet(["예시 하나"], { activeCanonicalFieldKey: "distortionTurnAnswer" });
    expect(screen.getByTestId("s02-cdquest-grid")).toBeInTheDocument();
    cleanup();

    renderWorksheet(["예시 하나"], { activeCanonicalFieldKey: "cdQuestItemScore" }, { cdQuestScores: [2] });
    expect(screen.getByTestId("s02-cdquest-grid")).toBeInTheDocument();
  });

  // The cells come from cdQuestScore rather than a table typed out here, so what
  // the participant reads and what the session records cannot drift apart.
  it("shows every cell of the book's matrix, from the same arithmetic the session uses", () => {
    renderWorksheet(["예시 하나"], { activeCanonicalFieldKey: "cdQuestItemScore" });
    const grid = screen.getByTestId("s02-cdquest-grid");
    const cells = within(grid).getAllByText(/^[0-5]$/).map((node) => node.textContent);
    const expected: string[] = [];
    for (const intensity of [1, 2, 3] as const) for (const frequency of [0, 1, 2, 3] as const) expected.push(String(cdQuestScore(frequency, intensity)));
    expect(cells).toEqual(expected);
    // Both axes are labelled, so the reader knows which way round it is.
    expect(grid.textContent).toContain("3~5일");
    expect(grid.textContent).toContain("꽤 (31~70%)");
  });

  // The active key is the PROMPT's output field, and both loops answer into a
  // scratch scalar -- so matching only the list's name left both pointers dead.
  it("marks the current row from the scratch field the loops actually answer into", () => {
    renderWorksheet(["첫 번째 예시"], { activeCanonicalFieldKey: "distortionTurnAnswer" });
    expect(screen.getByTestId("s02-distortion-row-2")).toHaveAttribute("aria-current", "step");
    cleanup();

    renderWorksheet(Array.from({ length: 15 }, (_, index) => `예시 ${index + 1}`), { activeCanonicalFieldKey: "cdQuestItemScore" }, { cdQuestScores: [2, 2, 2] });
    expect(screen.getByTestId("s02-distortion-row-4")).toHaveAttribute("aria-current", "step");
  });

  // The guide reads the score out of what the participant SAYS. A misread one is
  // a measured value that would otherwise stay wrong for the rest of the study,
  // and the example cell beside it has always been editable.
  it("lets the participant correct a score, writing the two halves with it", () => {
    const onEdit = vi.fn();
    render(
      <LocaleProvider>
        <S02Worksheet
          view={viewWith({ distortionExamples: ["예시 하나"], cdQuestScores: [2], cdQuestFrequency: [2], cdQuestIntensity: [1] })}
          activeCanonicalFieldKey="cdQuestItemScore"
          onConfirm={() => {}}
          onEdit={onEdit}
          busy={false}
          locale="ko-KR"
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByTestId("s02-distortion-score-1"));
    const picker = screen.getByTestId("s02-score-picker-1");
    fireEvent.click(within(within(picker).getByRole("group", { name: "얼마나 자주" })).getByRole("button", { name: "6~7일" }));
    fireEvent.click(within(within(picker).getByRole("group", { name: "얼마나 강하게" })).getByRole("button", { name: "꽤" }));
    fireEvent.click(within(picker).getByRole("button", { name: "저장" }));

    // Six-to-seven days at "quite" is a 4, and the halves are stored with it so
    // the row never holds a score apart from what it was made of.
    const written = Object.fromEntries(onEdit.mock.calls.map(([key, value]) => [key, value]));
    expect(written.cdQuestScores).toEqual([cdQuestScore(3, 2)]);
    expect(written.cdQuestFrequency).toEqual([3]);
    expect(written.cdQuestIntensity).toEqual([2]);
  });

  it("offers no score picker where the participant may not edit", () => {
    renderWorksheet(["예시 하나"], { readOnly: true, allowEdit: false }, { cdQuestScores: [2] });
    expect((screen.getByTestId("s02-distortion-score-1") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the total in step with a corrected score", () => {
    renderWorksheet(["하나", "둘"], {}, { cdQuestScores: [2, 3], cdQuestTotal: 99 });
    // Summed from the rows on screen, not from the program's own figure, so a
    // correction shows immediately.
    expect(signalValue("총점")).toBe("5");
  });

  it("counts the patterns looked at and the examples actually given", () => {
    renderWorksheet(["예시 하나", NO_EXAMPLE_MARKER, "예시 둘"]);
    expect(screen.getByText(`3 / ${COGNITIVE_DISTORTIONS.length}`)).toBeInTheDocument();
    // Read from the signals block: the grid has single digits of its own.
    expect(signalValue("내 예시")).toBe("2");
  });
});
