import { describe, expect, it } from "vitest";
import { promptSessionTurnSchema } from "@/shared/dialogue-agent/prompt-session-agent";

// currentStep (Common rules section 5, note2026_09_28_rct_backend) is kept
// for step fidelity; a missing or malformed value must never cost the turn.
describe("prompt session turn: currentStep", () => {
  const base = { reply: "안녕하세요", fieldUpdates: {}, focusField: null, inputHint: "text", sessionComplete: false, pauseSession: false, safetyConcern: false };

  it("keeps a step number", () => {
    expect(promptSessionTurnSchema.parse({ ...base, currentStep: 5 }).currentStep).toBe(5);
  });

  it("drops a missing, null or malformed step without failing the turn", () => {
    expect(promptSessionTurnSchema.parse(base).currentStep ?? null).toBeNull();
    expect(promptSessionTurnSchema.parse({ ...base, currentStep: null }).currentStep).toBeNull();
    expect(promptSessionTurnSchema.parse({ ...base, currentStep: "Step 3" }).currentStep).toBeNull();
    expect(promptSessionTurnSchema.parse({ ...base, currentStep: 0 }).currentStep).toBeNull();
  });
});
