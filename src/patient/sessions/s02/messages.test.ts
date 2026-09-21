import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { koreanText, resolveStaticText } from "@/patient/sessions/s02/messages";

// S02's Korean fallback is what ships when the model call cannot be made, so a
// missing entry is invisible in normal use and then silently replaces a step
// with the content-free generic line. Mirrors s01/messages.test.ts.

const S02_PROMPTS = CANONICAL_PROMPT_ITEMS.filter((item) => item.sessionId === "tbct-s02");
// Composed per pattern in resolveStaticText, so it deliberately has no
// koreanText entry -- one there would override all fifteen.
const DYNAMIC_IDS = new Set([
  "tbct-s02-n05-p01-review-distortion",
  // Composed in full so the S01 homework recap reaches Korean -- see the
  // comment on homeworkUpdateText.
  "tbct-s02-n02-p01-homework-update",
  // Stage 2: both name the pattern (or the total) the turn is actually on, so a
  // koreanText entry would override the composed text and freeze it.
  "tbct-s02-n07-p01-score-distortion",
  "tbct-s02-n08-p01-total",
]);

describe("S02 fallback wording", () => {
  it("has a Korean fallback for every prompt, or resolves it dynamically", () => {
    expect(S02_PROMPTS.length).toBeGreaterThan(0);
    const missing = S02_PROMPTS.filter((item) => !DYNAMIC_IDS.has(item.id) && !koreanText[item.id]);
    expect(missing.map((item) => item.id)).toEqual([]);
  });

  it("keeps the dynamic prompt out of koreanText, so the per-pattern text is not overridden", () => {
    for (const id of DYNAMIC_IDS) expect(koreanText[id]).toBeUndefined();
  });

  it("names every koreanText key after a prompt that exists", () => {
    const ids = new Set(S02_PROMPTS.map((item) => item.id));
    expect(Object.keys(koreanText).filter((key) => !ids.has(key))).toEqual([]);
  });

  it("composes the walkthrough text for the pattern the loop is on, in both languages", () => {
    const prompt = S02_PROMPTS.find((item) => item.id === "tbct-s02-n05-p01-review-distortion");
    expect(prompt).toBeTruthy();
    for (const [index, distortion] of COGNITIVE_DISTORTIONS.entries()) {
      const fields = { distortionExamples: Array.from({ length: index }, (_, position) => `example ${position}`) };
      const ko = resolveStaticText(prompt!, fields, "ko-KR") ?? "";
      const en = resolveStaticText(prompt!, fields, "en-US") ?? "";
      expect(ko, distortion.id).toContain(distortion.nameKo);
      expect(en, distortion.id).toContain(distortion.nameEn[0]);
      expect(ko).toContain(`${index + 1}번째`);
      // The guards that would replace the whole message with the generic line.
      expect(ko.length, distortion.id).toBeLessThanOrEqual(600);
      expect(en.length, distortion.id).toBeLessThanOrEqual(600);
      expect(en).not.toMatch(/\bmodels?\b/i);
    }
  });

  it("asks about the pattern just answered on the discussion turn, in both languages", () => {
    const prompt = S02_PROMPTS.find((item) => item.id === "tbct-s02-n05-p01-review-distortion")!;
    for (const [index, distortion] of COGNITIVE_DISTORTIONS.entries()) {
      const fields = { s02PatternPhase: "discuss", distortionExamples: Array.from({ length: index + 1 }, () => "예시") };
      expect(resolveStaticText(prompt, fields, "ko-KR"), distortion.id).toContain(distortion.nameKo);
      expect(resolveStaticText(prompt, fields, "en-US"), distortion.id).toContain(distortion.nameEn[0]);
    }
  });

  it("does not run off the end of the registry once every pattern has a row", () => {
    const prompt = S02_PROMPTS.find((item) => item.id === "tbct-s02-n05-p01-review-distortion");
    const fields = { distortionExamples: COGNITIVE_DISTORTIONS.map((_, index) => `example ${index}`) };
    const ko = resolveStaticText(prompt!, fields, "ko-KR") ?? "";
    expect(ko).toContain(COGNITIVE_DISTORTIONS[COGNITIVE_DISTORTIONS.length - 1].nameKo);
  });

  it("keeps every Korean fallback inside the 600-character safety cap", () => {
    for (const [id, text] of Object.entries(koreanText)) expect(text.length, id).toBeLessThanOrEqual(600);
  });

  it("never says 'model' in an English fallback, which the safety check would reject", () => {
    for (const item of S02_PROMPTS) {
      const english = resolveStaticText(item, {}, "en-US") ?? item.fallbackPatientText ?? "";
      expect(english, item.id).not.toMatch(/\bmodels?\b/i);
    }
  });
});
