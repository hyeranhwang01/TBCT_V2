import { describe, expect, it } from "vitest";
import { findNewProgressMoment } from "@/patient/lib/progress-moment";

describe("findNewProgressMoment", () => {
  it("reports S03's re-rating the turn it lands", () => {
    const before = { automaticThoughtBeliefPercent: 80 };
    const after = { automaticThoughtBeliefPercent: 80, revisedAutomaticThoughtBeliefPercent: 35 };
    expect(findNewProgressMoment("tbct-s03", before, after)).toEqual({ seriesKey: "belief", from: 80, to: 35 });
  });

  it("stays quiet on later turns once the re-rating is already known", () => {
    const fields = { automaticThoughtBeliefPercent: 80, revisedAutomaticThoughtBeliefPercent: 35 };
    expect(findNewProgressMoment("tbct-s03", fields, { ...fields, situation: "x" })).toBeUndefined();
  });

  it("needs the starting rating to compare against", () => {
    expect(findNewProgressMoment("tbct-s03", {}, { revisedAutomaticThoughtBeliefPercent: 35 })).toBeUndefined();
  });

  it("uses the newest step of a multi-step series (S08) against the start", () => {
    const before = { coreBeliefBaselinePercent: 90, defendantPostProsecutionBeliefPercent: 95 };
    const after = { ...before, defendantPostDefenseBeliefPercent: 60 };
    expect(findNewProgressMoment("tbct-s08", before, after)).toEqual({ seriesKey: "belief", from: 90, to: 60 });
  });

  it("ignores sessions without a tracked pair", () => {
    expect(findNewProgressMoment("tbct-s01", {}, { anything: 10 })).toBeUndefined();
  });
});
