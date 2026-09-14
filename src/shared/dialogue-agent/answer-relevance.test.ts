import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { judgeAnswerRelevance } from "@/shared/dialogue-agent/answer-relevance";

// Off-topic answers (.claude/TASK_SCOPE.json note2026_09_14_off_topic_answers):
// the check that runs before a free-text answer is stored, and fails open.

const request = { locale: "ko-KR", question: "그때 슬픔 말고 느껴진 다른 감정도 있었을까요?", approvedTask: "그 밖에 다른 감정도 있었나요?", answer: "근데 내가 밥을 지금 먹었는데 초밥이거든?" };
const context = { sessionId: "relevance-test", turnId: "turn-1" };
const originalKey = process.env.ANTHROPIC_API_KEY;
const originalProvider = process.env.AI_PROVIDER;

function toolResponse(input: unknown) {
  return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_answer_relevance", input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  if (originalProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalProvider;
});

describe("judgeAnswerRelevance", () => {
  it("counts the message as an answer when no provider is configured or it is disabled", async () => {
    expect(await judgeAnswerRelevance(request, context)).toEqual({ isAnswer: true, checked: false, failureReason: "missing_api_key" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-used-by-this-test";
    process.env.AI_PROVIDER = "mock";
    expect(await judgeAnswerRelevance(request, context)).toEqual({ isAnswer: true, checked: false, failureReason: "provider_disabled" });
  });

  it("returns Claude's verdict, asking with the question actually shown and the participant's message", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(toolResponse({ isAnswer: false, reason: "talks about lunch, not a feeling" }));
    expect(await judgeAnswerRelevance(request, context)).toEqual({ isAnswer: false, checked: true, reason: "talks about lunch, not a feeling" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.tool_choice).toMatchObject({ type: "tool", name: "submit_answer_relevance" });
    expect(body.messages[0].content[0].text).toContain("초밥");
    expect(body.messages[0].content[0].text).toContain("다른 감정");
  });

  it("fails open on an API error or an unusable reply", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("overloaded", { status: 529 }));
    expect(await judgeAnswerRelevance(request, context)).toMatchObject({ isAnswer: true, checked: false });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(toolResponse({ reason: "no verdict" }));
    expect(await judgeAnswerRelevance(request, context)).toMatchObject({ isAnswer: true, checked: false });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    expect(await judgeAnswerRelevance(request, context)).toMatchObject({ isAnswer: true, checked: false, failureReason: "network down" });
  });
});
