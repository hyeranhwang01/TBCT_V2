import { describe, expect, it } from "vitest";
import { normalizeSpeechText } from "@/patient/lib/speech/normalize-speech-text";

// Verbatim from src/patient/sessions/s02/messages.ts:193 -- the rating-scale
// explanation, which carries every pattern that used to be mis-read at once:
// two tilde ranges with an attached unit, middle dots, an em dash and a
// paragraph break.
const S02_SCALE_KO =
  "간단히 나누면, 0~3점의 파란색·초록색은 불편하지만 아직 감당할 수 있는 범위이고, 4~5점의 노란색·빨간색은 괴로움이 훨씬 크게 느껴지는 범위예요. 노란색이나 빨간색이라고 해서 잘못된 점수라는 뜻은 아니에요 — 지금 어디에 있는지를 알아보기 위한 표시입니다.\n\n이 기준이 대략 이해되시나요? 헷갈리는 부분이 있으면 제가 다시 쉽게 설명해 드릴게요.";

const S02_SCALE_EN =
  "To put it simply: 0 to 3 (blue and green) means it's uncomfortable but still manageable. Being at yellow or red doesn't mean anything is wrong with your answer -- it's just showing where things stand right now.\n\nDoes this make general sense so far?";

describe("normalizeSpeechText — Korean ranges", () => {
  it("repeats the unit on both bounds so the range is grammatical", () => {
    expect(normalizeSpeechText("0~3점", "ko-KR")).toBe("0점에서 3점까지");
    expect(normalizeSpeechText("10~20분", "ko-KR")).toBe("10분에서 20분까지");
    expect(normalizeSpeechText("1~2회", "ko-KR")).toBe("1회에서 2회까지");
  });

  it("handles the units that actually appear in the session scripts", () => {
    expect(normalizeSpeechText("2~5차 평가", "ko-KR")).toBe("2차에서 5차까지 평가");
    expect(normalizeSpeechText("2~3개를 골라 주세요", "ko-KR")).toBe("2개에서 3개까지를 골라 주세요");
  });

  it("keeps 개월 whole instead of splitting it into 개 + 월", () => {
    expect(normalizeSpeechText("3~6개월", "ko-KR")).toBe("3개월에서 6개월까지");
  });

  it("falls back to a bare range when no unit follows", () => {
    expect(normalizeSpeechText("0~5 색상 척도", "ko-KR")).toBe("0에서 5까지 색상 척도");
  });

  it("uses English wording for an English session", () => {
    expect(normalizeSpeechText("0~5 scale", "en-US")).toBe("0 to 5 scale");
  });
});

describe("normalizeSpeechText — punctuation the synthesizer skips", () => {
  it("turns em dashes into an audible pause", () => {
    expect(normalizeSpeechText("아니에요 — 지금", "ko-KR")).toBe("아니에요, 지금");
    expect(normalizeSpeechText("your answer -- it's just", "en-US")).toBe("your answer, it's just");
  });

  it("turns middle dots into an audible pause instead of the word 가운뎃점", () => {
    expect(normalizeSpeechText("피고인 · 검사 · 변호인", "ko-KR")).toBe("피고인, 검사, 변호인");
    expect(normalizeSpeechText("파란색·초록색", "ko-KR")).toBe("파란색, 초록색");
  });

  it("restores the paragraph pause without doubling an existing full stop", () => {
    expect(normalizeSpeechText("표시입니다.\n\n이 기준이", "ko-KR")).toBe("표시입니다. 이 기준이");
    expect(normalizeSpeechText("들어 보세요\n\n다음 질문", "ko-KR")).toBe("들어 보세요. 다음 질문");
  });

  it("keeps a single line break as a clause pause", () => {
    expect(normalizeSpeechText("첫 줄\n둘째 줄", "ko-KR")).toBe("첫 줄, 둘째 줄");
  });

  it("treats CRLF the same as LF", () => {
    expect(normalizeSpeechText("첫 줄\r\n둘째 줄", "ko-KR")).toBe("첫 줄, 둘째 줄");
    expect(normalizeSpeechText("표시입니다.\r\n\r\n이 기준이", "ko-KR")).toBe("표시입니다. 이 기준이");
  });

  it("strips markdown so asterisks and bullets are not read out", () => {
    expect(normalizeSpeechText("**중요한** 부분", "ko-KR")).toBe("중요한 부분");
    expect(normalizeSpeechText("- 첫째\n- 둘째", "ko-KR")).toBe("첫째, 둘째");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeSpeechText("", "ko-KR")).toBe("");
    expect(normalizeSpeechText("   \n\n  ", "ko-KR")).toBe("");
  });
});

describe("normalizeSpeechText — real session copy", () => {
  it("leaves no tilde, middle dot, em dash or blank line in the Korean scale message", () => {
    const spoken = normalizeSpeechText(S02_SCALE_KO, "ko-KR");
    expect(spoken).not.toMatch(/[~～·—–]/);
    expect(spoken).not.toMatch(/\n/);
    expect(spoken).toContain("0점에서 3점까지의 파란색, 초록색");
    expect(spoken).toContain("아니에요, 지금");
    expect(spoken).toContain("표시입니다. 이 기준이");
  });

  it("leaves no double hyphen or blank line in the English scale message", () => {
    const spoken = normalizeSpeechText(S02_SCALE_EN, "en-US");
    expect(spoken).not.toMatch(/--/);
    expect(spoken).not.toMatch(/\n/);
    expect(spoken).toContain("your answer, it's just showing");
  });
});

// The M2 synthesis route re-applies this before hashing for the audio cache.
// If a second pass changed anything, the server would hash a different string
// than the client spoke and every cache lookup would miss.
describe("normalizeSpeechText — idempotence", () => {
  const fixtures: Array<[string, string]> = [
    [S02_SCALE_KO, "ko-KR"],
    [S02_SCALE_EN, "en-US"],
    ["0~3점의 파란색·초록색 — 지금", "ko-KR"],
    ["2~3개를 골라 주세요", "ko-KR"],
    ["- 첫째\n- 둘째\n\n마무리", "ko-KR"],
    ["0~5 scale -- right now", "en-US"],
    ["표시입니다.\r\n\r\n이 기준이 이해되시나요?", "ko-KR"],
  ];

  it.each(fixtures)("is stable on a second pass (%#)", (text, locale) => {
    const once = normalizeSpeechText(text, locale);
    expect(normalizeSpeechText(once, locale)).toBe(once);
  });
});
