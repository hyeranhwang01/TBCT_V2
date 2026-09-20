import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
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
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("follows the scoring pointer rather than the example pointer once scoring is the active step", () => {
    renderWorksheet(Array.from({ length: 15 }, (_, index) => `예시 ${index + 1}`), { activeCanonicalFieldKey: "cdQuestScores" }, { cdQuestScores: [2, 2, 2] });
    expect(screen.getByTestId("s02-distortion-row-4")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("s02-distortion-row-3")).not.toHaveAttribute("aria-current");
  });

  it("counts the patterns looked at and the examples actually given", () => {
    renderWorksheet(["예시 하나", NO_EXAMPLE_MARKER, "예시 둘"]);
    expect(screen.getByText(`3 / ${COGNITIVE_DISTORTIONS.length}`)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
