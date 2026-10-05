import { describe, expect, it } from "vitest";
import { PROMPT_DISPLAY_FIELD, checkFieldDisplay, displayIssue, nextFieldDisplay, promptFieldDisplay } from "@/shared/runtime/prompt-driven-sessions";
import { defaultWorksheetChunks } from "@/shared/memory/chunk-builder";

// Which tidy text the worksheet may show in place of the recorded words
// (.claude/TASK_SCOPE.json note2026_10_05_worksheet_display_version).

describe("displayIssue", () => {
  it("accepts text cut down from the recorded words", () => {
    expect(displayIssue("팀장님이 회의 때 제 보고서를 넘겨버렸다", "음 팀장님이 회의 때 제 보고서를 그냥 넘겨버렸는데 그런 것 같아요")).toBeNull();
    expect(displayIssue("나는 뭘 해도 안 되는 사람인 것 같아요", "아 나는 진짜 뭘 해도 안 되는 사람인 것 같아요 그냥")).toBeNull();
  });

  it("rejects invented, relabelled or longer text, and anything that is not text", () => {
    expect(displayIssue("기쁨", "기분이 좋았을 것 같아요")).toBe("not from the recorded words");
    expect(displayIssue("상사가 나를 공개적으로 모욕했다", "팀장님이 회의 때 제 보고서를 넘겨버렸어요")).toBe("not from the recorded words");
    expect(displayIssue("팀장님이 회의 때 제 보고서를 넘겨버렸어요 정말로요", "팀장님이 회의 때 제 보고서를 넘겨버렸어요")).toBe("longer than the recorded words");
    expect(displayIssue("  ", "말")).toBe("empty");
    expect(displayIssue(50, "50")).toBe("expected text");
  });

  it("checks a one-letter text by inclusion", () => {
    expect(displayIssue("화", "음 화")).toBeNull();
    expect(displayIssue("슬", "음 화")).toBe("not from the recorded words");
  });
});

describe("checkFieldDisplay", () => {
  const fields = {
    openingInitialThought: "음 나를 무시하는 거야 그런 것 같아",
    personalEmotion: "배신감",
    personalEmotionIntensity: 50,
    s01Problems: ["음 불안이 심해요 그냥", "계획대로 안 되면 힘들어요"],
  };

  it("keeps derived text for text and list fields, and nothing that equals the recorded words", () => {
    const result = checkFieldDisplay("tbct-s01", { openingInitialThought: "나를 무시하는 거야", personalEmotion: "배신감", s01Problems: ["불안이 심해요", "계획대로 안 되면 힘들어요"] }, fields);
    expect(result.accepted).toEqual({ openingInitialThought: "나를 무시하는 거야", s01Problems: ["불안이 심해요", "계획대로 안 되면 힘들어요"] });
    expect(result.rejected).toEqual([]);
  });

  it("rejects numbers, unknown names, unrecorded fields, invented text and a list of the wrong length", () => {
    const result = checkFieldDisplay("tbct-s01", {
      personalEmotionIntensity: "50",
      madeUpField: "x",
      s01Goal: "목표",
      openingInitialThought: "그들은 나를 싫어한다",
      s01Problems: ["불안이 심해요"],
    }, fields);
    expect(result.accepted).toEqual({});
    expect(result.rejected).toEqual([
      { name: "personalEmotionIntensity", reason: "numbers are never tidied" },
      { name: "madeUpField", reason: "not a field of this session" },
      { name: "s01Goal", reason: "nothing recorded" },
      { name: "openingInitialThought", reason: "not from the recorded words" },
      { name: "s01Problems", reason: "expected one text per recorded item" },
    ]);
  });

  it("falls back to the recorded words for a list item that fails, keeping the others", () => {
    const result = checkFieldDisplay("tbct-s01", { s01Problems: ["불안이 심해요", "완벽주의 성향"] }, fields);
    expect(result.accepted).toEqual({ s01Problems: ["불안이 심해요", "계획대로 안 되면 힘들어요"] });
    expect(result.rejected).toEqual([{ name: "s01Problems#1", reason: "not from the recorded words" }]);
  });

  it("never accepts S02's score lists", () => {
    expect(checkFieldDisplay("tbct-s02", { cdQuestFrequency: ["1"] }, { cdQuestFrequency: [1] }).rejected).toEqual([{ name: "cdQuestFrequency", reason: "numbers are never tidied" }]);
  });
});

describe("nextFieldDisplay", () => {
  const before = { openingInitialThought: "음 나를 무시하는 거야", s01Problems: ["음 불안이 심해요", "계획 얘기"], personalBehavior: "음 혼자 울었어요" };
  const display = { openingInitialThought: "나를 무시하는 거야", s01Problems: ["불안이 심해요", "계획 얘기"], personalBehavior: "혼자 울었어요" };

  it("drops the tidy text of words that changed, keeps it for list items that did not, and keeps untouched fields", () => {
    const after = { ...before, openingInitialThought: "그 사람이 나를 무시했어", s01Problems: ["음 불안이 심해요", "새 어려움"] };
    expect(nextFieldDisplay(display, before, after, ["openingInitialThought", "s01Problems"], {})).toEqual({
      s01Problems: ["불안이 심해요", "새 어려움"],
      personalBehavior: "혼자 울었어요",
    });
  });

  it("takes new accepted text for a changed field", () => {
    const after = { ...before, openingInitialThought: "음 그 사람이 나를 무시했어" };
    expect(nextFieldDisplay(display, before, after, ["openingInitialThought"], { openingInitialThought: "그 사람이 나를 무시했어" }).openingInitialThought).toBe("그 사람이 나를 무시했어");
  });

  it("drops a list's tidy text once no item keeps any", () => {
    expect(nextFieldDisplay(display, before, { ...before, s01Problems: ["전혀 다른 것"] }, ["s01Problems"], {}).s01Problems).toBeUndefined();
  });
});

describe("the display map in fields", () => {
  it("reads as {} when absent or malformed", () => {
    expect(promptFieldDisplay({})).toEqual({});
    expect(promptFieldDisplay({ [PROMPT_DISPLAY_FIELD]: ["x"] })).toEqual({});
  });

  it("is never chunked into memory by the default chunker", () => {
    const drafts = defaultWorksheetChunks({ [PROMPT_DISPLAY_FIELD]: { personalBehavior: "혼자 울었어요" }, personalBehavior: "음 혼자 울었어요" });
    expect(drafts.map((draft) => draft.content)).toEqual(["음 혼자 울었어요"]);
  });
});
