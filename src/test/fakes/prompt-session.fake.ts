import { setPromptSessionGeneratorForTests, type PromptSessionRequest, type PromptSessionResult, type PromptSessionTurn } from "@/shared/dialogue-agent/prompt-session-agent";

// A scripted stand-in for the prompt-driven sessions' model call
// (.claude/TASK_SCOPE.json note2026_09_25_prompt_driven_s01_s02). Each call
// is answered by the script with the request it got, so a test can both steer
// the conversation and check what the program sent (the <program> block, the
// history). Installed per test; uninstall in afterEach.

export type ScriptedAnswer = Partial<PromptSessionTurn> | { fail: string };
export type PromptSessionScript = (request: PromptSessionRequest, callIndex: number) => ScriptedAnswer;

export type ScriptedPromptSession = { requests: PromptSessionRequest[]; uninstall: () => void };

export function installScriptedPromptSession(script: PromptSessionScript): ScriptedPromptSession {
  const requests: PromptSessionRequest[] = [];
  setPromptSessionGeneratorForTests(async (request): Promise<PromptSessionResult> => {
    requests.push(request);
    const answer = script(request, requests.length - 1);
    if ("fail" in answer) return { ok: false, error: answer.fail };
    return {
      ok: true,
      model: "scripted",
      latencyMs: 0,
      promptVersion: "test",
      promptSha256: "test-sha",
      turn: {
        reply: answer.reply ?? `scripted message ${requests.length}`,
        fieldUpdates: answer.fieldUpdates ?? {},
        focusField: answer.focusField ?? null,
        inputHint: answer.inputHint ?? "text",
        sessionComplete: answer.sessionComplete ?? false,
        pauseSession: answer.pauseSession ?? false,
        safetyConcern: answer.safetyConcern ?? false,
      },
    };
  });
  return { requests, uninstall: () => setPromptSessionGeneratorForTests(undefined) };
}

/** The participant message the model was answering on this call, if any. */
export function lastParticipantText(request: PromptSessionRequest): string | undefined {
  return [...request.history].reverse().find((message) => message.role === "participant")?.content;
}
