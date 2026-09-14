import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { judgeSummaryFidelity } from "@/shared/dialogue-agent/summary-fidelity";

// Summary fidelity (.claude/TASK_SCOPE.json note2026_09_15_olivia_persona):
// the check a summary passes before the participant sees it. Fails open.

const request = { locale: "ko-KR", participantMessages: ["아이 훈육할 때 제 욕심이 보여서요"], summary: "훈육에서 욕심이 보여 자괴감이 드신다" };
const context = { sessionId: "fidelity-test", turnId: "turn-1" };
const originalKey = process.env.ANTHROPIC_API_KEY;
const originalProvider = process.env.AI_PROVIDER;

function toolResponse(input: unknown) {
  return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_summary_fidelity", input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
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

describe("judgeSummaryFidelity", () => {
  it("is not checked without a provider", async () => {
    expect(await judgeSummaryFidelity(request, context)).toEqual({ faithful: true, checked: false, failureReason: "missing_api_key" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-used";
    process.env.AI_PROVIDER = "mock";
    expect(await judgeSummaryFidelity(request, context)).toEqual({ faithful: true, checked: false, failureReason: "provider_disabled" });
  });

  it("returns the verdict and the added meaning, comparing the summary with the participant's words", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(toolResponse({ faithful: false, tentative: false, addedMeaning: "자괴감" }));
    expect(await judgeSummaryFidelity(request, context)).toEqual({ faithful: false, checked: true, tentative: false, addedMeaning: "자괴감" });
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.tool_choice).toMatchObject({ type: "tool", name: "submit_summary_fidelity" });
    expect(body.messages[0].content[0].text).toContain("훈육할 때 제 욕심");
    expect(body.messages[0].content[0].text).toContain("자괴감이 드신다");
  });

  it("passes a tentative interpretation but flags it", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(toolResponse({ faithful: true, tentative: true }));
    expect(await judgeSummaryFidelity({ ...request, summary: "혹시 자괴감도 드셨을까요?" }, context)).toEqual({ faithful: true, checked: true, tentative: true });
  });

  it("fails open on an API error or an unusable reply", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("overloaded", { status: 529 }));
    expect(await judgeSummaryFidelity(request, context)).toMatchObject({ faithful: true, checked: false });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(toolResponse({ tentative: true }));
    expect(await judgeSummaryFidelity(request, context)).toMatchObject({ faithful: true, checked: false });
  });
});
