import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { capturedStatus, directionalValue, displayOrDash, listCount, useJustFilled } from "@/patient/components/worksheet-renderers/shared";
import type { WorksheetFieldView } from "@/types/worksheet";

function fieldWithValue(value: unknown, displayValue?: string): WorksheetFieldView {
  return { value: { displayValue, value } } as unknown as WorksheetFieldView;
}
const EMPTY_FIELD = { value: null } as unknown as WorksheetFieldView;

// useJustFilled backs the "quest complete" flourish (WorksheetCell in this
// file, WorksheetFieldRow in worksheet-pane.tsx) -- it must fire exactly
// once per real fill, not on every render/poll while a field stays filled,
// and never for a field that was already filled when the component mounted
// (e.g. reopening a session mid-way through).
describe("useJustFilled", () => {
  it("does not flag a field that is already filled on first mount", () => {
    const { result } = renderHook(() => useJustFilled(true, false));
    expect(result.current).toBe(false);
  });

  it("stays false while a field remains unfilled", () => {
    const { result, rerender } = renderHook(({ filled }: { filled: boolean }) => useJustFilled(filled, false), { initialProps: { filled: false } });
    expect(result.current).toBe(false);
    act(() => rerender({ filled: false }));
    expect(result.current).toBe(false);
  });

  it("flags a field on the false->true transition, then clears after the flourish duration", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ filled }: { filled: boolean }) => useJustFilled(filled, false), { initialProps: { filled: false } });
      expect(result.current).toBe(false);

      act(() => rerender({ filled: true }));
      expect(result.current).toBe(true);

      act(() => { vi.advanceTimersByTime(1300); });
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-flag on a later render once already filled", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ filled }: { filled: boolean }) => useJustFilled(filled, false), { initialProps: { filled: false } });
      act(() => rerender({ filled: true }));
      act(() => { vi.advanceTimersByTime(1300); });
      expect(result.current).toBe(false);

      // A poll/re-render that reports the same still-filled value must not
      // replay the flourish.
      act(() => rerender({ filled: true }));
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never flags anything when reducedMotion is true, even on a real transition", () => {
    const { result, rerender } = renderHook(({ filled }: { filled: boolean }) => useJustFilled(filled, true), { initialProps: { filled: false } });
    act(() => rerender({ filled: true }));
    expect(result.current).toBe(false);
  });
});

// The Clinical Worksheet layer's "structured factual summary" helpers
// (Session Signals) -- these must never fabricate a value: any side
// missing from the underlying data renders as "—", not a guess.
describe("directionalValue", () => {
  it("renders a before -> after pair when both sides are filled", () => {
    expect(directionalValue(fieldWithValue(85, "85"), fieldWithValue(35, "35"))).toBe("85% → 35%");
  });

  it("falls back to just the one side that exists", () => {
    expect(directionalValue(fieldWithValue(85, "85"), undefined)).toBe("85%");
    expect(directionalValue(undefined, fieldWithValue(35, "35"))).toBe("35%");
  });

  it("renders a dash when neither side has a value", () => {
    expect(directionalValue(undefined, undefined)).toBe("—");
    expect(directionalValue(EMPTY_FIELD, EMPTY_FIELD)).toBe("—");
  });
});

describe("listCount", () => {
  it("counts a filled text_list field", () => {
    expect(listCount(fieldWithValue(["a", "b", "c"]))).toBe("3");
  });

  it("renders a dash for an empty or missing list", () => {
    expect(listCount(fieldWithValue([]))).toBe("—");
    expect(listCount(undefined)).toBe("—");
    expect(listCount(EMPTY_FIELD)).toBe("—");
  });
});

describe("capturedStatus", () => {
  it("reports Captured only when the field actually has a value", () => {
    expect(capturedStatus(fieldWithValue("some text"))).toBe("Captured");
  });

  it("reports Not captured for empty, missing, or unfilled fields", () => {
    expect(capturedStatus(EMPTY_FIELD)).toBe("Not captured");
    expect(capturedStatus(undefined)).toBe("Not captured");
    expect(capturedStatus(fieldWithValue(""))).toBe("Not captured");
  });
});

describe("displayOrDash", () => {
  it("returns the display value when present", () => {
    expect(displayOrDash(fieldWithValue(12, "12"))).toBe("12");
  });

  it("returns a dash when there is nothing to show", () => {
    expect(displayOrDash(EMPTY_FIELD)).toBe("—");
    expect(displayOrDash(undefined)).toBe("—");
  });
});
