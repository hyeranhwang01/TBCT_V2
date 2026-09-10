import { describe, expect, it } from "vitest";
import { detectLanguageSwitchRequest } from "@/shared/runtime/language-switch-detector";

describe("detectLanguageSwitchRequest", () => {
  it("recognizes common Korean phrasings asking to switch to Korean", () => {
    expect(detectLanguageSwitchRequest("한국어로 해주세요")).toBe("ko-KR");
    expect(detectLanguageSwitchRequest("한국어로 해줘")).toBe("ko-KR");
    expect(detectLanguageSwitchRequest("한글로 답해주실 수 있나요?")).toBe("ko-KR");
    expect(detectLanguageSwitchRequest("  한국어로 말해줘  ")).toBe("ko-KR");
  });

  it("recognizes common phrasings asking to switch to English", () => {
    expect(detectLanguageSwitchRequest("please respond in English")).toBe("en-US");
    expect(detectLanguageSwitchRequest("Can you speak English?")).toBe("en-US");
    expect(detectLanguageSwitchRequest("English please")).toBe("en-US");
  });

  it("does not misfire on an ordinary clinical answer", () => {
    expect(detectLanguageSwitchRequest("I felt anxious when my boss criticized my report in front of everyone")).toBeNull();
    expect(detectLanguageSwitchRequest("발표 중에 실수해서 너무 창피했어요")).toBeNull();
    expect(detectLanguageSwitchRequest("80")).toBeNull();
    expect(detectLanguageSwitchRequest("")).toBeNull();
  });

  it("does not fire on a long message that only mentions a language in passing", () => {
    const longMessage = "I was speaking English with my coworker and afterward I felt embarrassed because I mispronounced a word in front of everyone in the meeting";
    expect(detectLanguageSwitchRequest(longMessage)).toBeNull();
  });
});
