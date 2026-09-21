import { describe, expect, it } from "vitest";
import { normalizeExampleForWorksheet } from "@/patient/sessions/s02/turn-rules";

// What goes in the worksheet cell, as opposed to what the participant said.
// Reported from a live session: "저 사람이 나한테 인사를 안했으니까, 나를
// 싫어할꺼야 라고 생각했습니다" was filed whole, frame and all. The cell wants
// the thought; the reporting frame around it is not part of it.
//
// The rule is deliberately narrow -- Korean fuses the quotative particle into
// the clause as often as it detaches it, and cutting at the particle in the
// fused case leaves a dangling fragment. So the frame comes off only when what
// remains already ends like a finished sentence.

describe("the worksheet cell text", () => {
  it("takes the reporting frame off a quoted thought", () => {
    expect(normalizeExampleForWorksheet("저 사람이 나한테 인사를 안했으니까, 나를 싫어할꺼야 라고 생각했습니다"))
      .toBe("저 사람이 나한테 인사를 안했으니까, 나를 싫어할꺼야");
    expect(normalizeExampleForWorksheet("나는 실패자야 라고 생각했어요")).toBe("나는 실패자야");
    expect(normalizeExampleForWorksheet("'이번에도 망할 거야' 라고 생각했습니다")).toBe("'이번에도 망할 거야'");
  });

  it("leaves a thought that is already just the thought alone", () => {
    for (const text of [
      // The participant's own words from the transcript (94-97, 155-157).
      "인사를 안 했기 때문에 나를 싫어할 거야",
      "만약에 내가 세워놓은 계획에 실패하면 모든 게 무너질 거야",
    ]) expect(normalizeExampleForWorksheet(text), text).toBe(text);
  });

  // Korean attaches the quotative particle to the clause as often as it detaches
  // it, and a plain cut at the particle leaves a fragment: "...무너질 거라고
  // 생각했어요" would become "...무너질 거", which the first build of this shipped.
  // These unwind to the plain form the sentence was quoting instead.
  it("unwinds a frame that is fused into the sentence rather than cutting it", () => {
    // Reported from a live session.
    expect(normalizeExampleForWorksheet("시험점수가 떨어지진않았지만 그건 운이 좋았던거라고 생각했음"))
      .toBe("시험점수가 떨어지진않았지만 그건 운이 좋았던거야");
    expect(normalizeExampleForWorksheet("계획에 실패하면 모든 게 무너질 거라고 생각했어요"))
      .toBe("계획에 실패하면 모든 게 무너질 거야");
    expect(normalizeExampleForWorksheet("그냥 운이 좋았다고 느꼈어요")).toBe("그냥 운이 좋았다");
    expect(normalizeExampleForWorksheet("교수님이 싫어하면 어떡하지 하는 생각이 들어요"))
      .toBe("교수님이 싫어하면 어떡하지");
  });

  it("leaves a sentence alone when the report verb is not what ends it", () => {
    // "그렇다고" here is not a frame around the thought -- the sentence continues.
    const text = "실수하면 내가 부족해서 그렇다고 스스로를 탓해요";
    expect(normalizeExampleForWorksheet(text)).toBe(text);
  });

  it("drops the filler people start with, and nothing after it", () => {
    expect(normalizeExampleForWorksheet("음, 제가 생각한 건 사람들이 저를 싫어한다는 거예요"))
      .toBe("사람들이 저를 싫어한다는 거예요");
  });

  it("never shortens its way to nothing", () => {
    // Degenerate input: stripping would leave less than a thought, so the
    // original stands.
    expect(normalizeExampleForWorksheet("라고 생각했습니다")).toBe("라고 생각했습니다");
    expect(normalizeExampleForWorksheet("없음")).toBe("없음");
  });

  it("tidies spacing without touching the words", () => {
    expect(normalizeExampleForWorksheet("  나를   싫어할 거야  ")).toBe("나를 싫어할 거야");
  });
});
