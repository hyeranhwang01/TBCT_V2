import { describe, expect, it } from "vitest";
import { COGNITIVE_DISTORTIONS, findDistortionById } from "@/shared/protocol/cognitive-distortions";

// The fifteen definitions are what the guide explains and what the participant
// files an example against, so a definition that drops half its meaning teaches
// the wrong pattern. These pin the points the real second session (2026-09-18)
// makes and that the first version of the registry left out
// (note2026_09_21_distortion_definitions_audit) -- checked against the meaning,
// not the wording, so the text can still be rephrased.

function ko(id: string) {
  return findDistortionById(id)!.descriptionKo;
}

describe("the fifteen definitions", () => {
  it("each carry a description and at least one example, in both languages", () => {
    expect(COGNITIVE_DISTORTIONS).toHaveLength(15);
    for (const item of COGNITIVE_DISTORTIONS) {
      expect(item.descriptionKo.length, item.id).toBeGreaterThan(10);
      expect(item.descriptionEn.length, item.id).toBeGreaterThan(10);
      expect(item.exampleKo.length, item.id).toBeGreaterThan(0);
      expect(item.exampleEn.length, item.id).toBe(item.exampleKo.length);
    }
  });

  // "그것이 일어났을 때 그 결과는 너무나 치명적이어서 나는 그걸 견딜 수 없을 거야"
  // (transcript 115-118). Predicting badly on its own is not this pattern.
  it("says catastrophizing is about the outcome being unbearable, not just likely", () => {
    expect(ko("fortune-telling-catastrophizing")).toMatch(/견딜 수 없|감당|치명/);
  });

  // "내가 남의 마음을 읽을 수 있다고 보고 남도 내 마음을 읽을 수 있다고 보는 거죠"
  // (536-538), and the third example given runs the other way.
  it("says mind reading runs in both directions", () => {
    expect(ko("mind-reading")).toMatch(/상대도|남도|반대로/);
    expect(findDistortionById("mind-reading")!.exampleKo.length).toBeGreaterThan(1);
  });

  // "내 감정이 내 현실을 반영하는 증거라고 보는 거예요" (221), and his first
  // example is a positive one, so the entry carries both directions.
  it("says emotional reasoning treats the feeling as the evidence", () => {
    expect(ko("emotional-reasoning")).toMatch(/증거/);
    expect(findDistortionById("emotional-reasoning")!.exampleKo.length).toBeGreaterThan(1);
  });

  // "그래서 전체적인 결과를 내가 인정하지 못하는 결과가 생기게 되겠죠" (480-482).
  it("says selective abstraction costs the whole result", () => {
    expect(ko("selective-abstraction")).toMatch(/전체 결과|전체적인 결과|인정하지 못/);
  });

  // Fifteen lines on why the cashier is not smiling, then: "그 상황을 보는 게
  // 아니라 유독 나한테만 친절하지 않다 이렇게 보는 거에요" (618-637).
  it("says personalizing leaves the situation's own reasons out", () => {
    expect(ko("personalizing")).toMatch(/다른 이유|상황/);
  });

  // "지금은 아픈 게 없어요, 차사고도 나지 않았고" (838-840).
  it("says what-if is about what has not happened", () => {
    expect(ko("what-if")).toMatch(/일어나지도 않은|일어나지 않은/);
  });
});
