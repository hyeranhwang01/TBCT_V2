import { describe, expect, it } from "vitest";
import { countExplorationTurns, countReflectionChecks, findPendingExploration, keepVerbatimThemes, latestPatientThemes } from "@/shared/runtime/conversation-steering";
import type { RuntimeMessage } from "@/types/runtime-session";

// Adaptive dialogue (.claude/TASK_SCOPE.json note2026_09_15_olivia_persona).

function message(id: string, role: RuntimeMessage["role"], metadata?: Record<string, unknown>): RuntimeMessage {
  return { id, runtimeSessionId: "s", role, content: "x", status: "delivered", createdAt: "2026-09-15T00:00:00.000Z", metadata } as RuntimeMessage;
}

const exploring = (turn: number) => ({ pendingExploration: { status: "pending", explorationId: "A1", turn, forPromptItemId: "p" } });

describe("findPendingExploration", () => {
  it("is the question on screen only while it is the last conversational message", () => {
    expect(findPendingExploration([message("P1", "patient"), message("A1", "assistant", exploring(1))])).toMatchObject({ turn: 1 });
    expect(findPendingExploration([message("A1", "assistant", exploring(1)), message("S1", "system")])).toMatchObject({ turn: 1 });
    expect(findPendingExploration([message("A1", "assistant", exploring(1)), message("P2", "patient")])).toBeUndefined();
    expect(findPendingExploration([message("A1", "assistant", { pendingExploration: { status: "resolved" } })])).toBeUndefined();
  });
});

describe("counts for the prompt", () => {
  it("counts exploration turns, and each confirmation once -- never a revised summary or a record correction", () => {
    const messages = [
      message("A1", "assistant", exploring(1)),
      message("A2", "assistant", exploring(2)),
      message("A3", "assistant", { reflectionCheck: { status: "pending", checkId: "A3", attempt: 1, summaryText: "s" } }),
      message("A4", "assistant", { reflectionCheck: { status: "pending", checkId: "A3", attempt: 2, summaryText: "s2" } }),
      message("A5", "assistant", { reflectionCheck: { status: "pending", checkId: "A5", attempt: 1, summaryText: "c", correction: { field: "f", action: "remove_item", currentValue: "v" } } }),
    ];
    expect(countExplorationTurns(messages)).toBe(2);
    expect(countReflectionChecks(messages)).toBe(1);
  });

  it("carries the latest themes forward past turns that gave none", () => {
    const messages = [message("A1", "assistant", { patientThemes: ["훈육에서의 욕심"] }), message("P1", "patient"), message("A2", "assistant")];
    expect(latestPatientThemes(messages)).toEqual(["훈육에서의 욕심"]);
    expect(latestPatientThemes([message("P1", "patient", { patientThemes: ["x"] })])).toEqual([]);
  });
});

describe("keepVerbatimThemes", () => {
  const said = ["예전에 중요했던 원칙이 지금은 부질없게 느껴져요", "아이 훈육에서의 제 욕심이 보여요.", "이 나이면 이래야 한다는 모습과 지금의 나 사이에 간극이 커요"];

  it("keeps the participant's own phrases, ignoring spacing and punctuation", () => {
    expect(keepVerbatimThemes(["원칙이 지금은 부질없게", "제 욕심이 보여요", "지금의 나 사이에  간극"], said)).toEqual(["원칙이 지금은 부질없게", "제 욕심이 보여요", "지금의 나 사이에  간극"]);
  });

  it("drops a paraphrase or an interpretation, duplicates, fragments, and anything past five", () => {
    expect(keepVerbatimThemes(["완벽주의", "자기 비난", "원칙", "원칙", "욕", ""], said)).toEqual(["원칙"]);
    const many = ["예전에", "중요했던", "원칙이", "지금은", "부질없게", "느껴져요"];
    expect(keepVerbatimThemes(many, said)).toHaveLength(5);
  });
});
