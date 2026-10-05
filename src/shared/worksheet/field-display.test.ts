import { describe, expect, it } from "vitest";
import { carryListDisplay, shownItemsOf, shownListItems } from "@/shared/worksheet/field-display";

// .claude/TASK_SCOPE.json note2026_10_05_worksheet_display_version.

describe("shownListItems", () => {
  it("prefers the tidy text per item, and the recorded words for an empty one", () => {
    expect(shownListItems(["음 하나", "둘"], ["하나", " "])).toEqual(["하나", "둘"]);
  });

  it("ignores a display list that does not match the recorded list", () => {
    expect(shownListItems(["음 하나", "둘"], ["하나"])).toEqual(["음 하나", "둘"]);
    expect(shownListItems(["음 하나"], [3])).toEqual(["음 하나"]);
    expect(shownItemsOf({ value: "not a list" })).toEqual([]);
  });
});

describe("carryListDisplay", () => {
  it("keeps the tidy text of unchanged items, matched by their words, and shows edited ones as written", () => {
    expect(carryListDisplay(["음 하나", "음 둘", "셋"], ["음 둘", "넷"], ["하나", "둘", "셋"])).toEqual(["둘", "넷"]);
  });

  it("is undefined when nothing tidy is left or there was no display list", () => {
    expect(carryListDisplay(["음 하나"], ["다른 것"], ["하나"])).toBeUndefined();
    expect(carryListDisplay(["음 하나"], ["음 하나"], undefined)).toBeUndefined();
    expect(carryListDisplay("text", "text", "t")).toBeUndefined();
  });
});
