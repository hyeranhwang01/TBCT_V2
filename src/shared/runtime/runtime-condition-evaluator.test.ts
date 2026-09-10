import { describe, expect, it } from "vitest";
import { selectNextRuntimeEdge } from "@/shared/runtime/runtime-condition-evaluator";
import type { SourceFidelityEdge } from "@/shared/protocol/source-fidelity-types";
import type { RuntimeContext } from "@/types/runtime-session";

const context = (crisisSignal?: boolean): RuntimeContext => ({
  fields: crisisSignal === undefined ? {} : { crisisSignal },
  riskSignals: [],
  iterationCounts: {},
  riskLevel: crisisSignal ? "high" : "low",
});

const edges = [
  { id: "safety", edgeType: "safety", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 1, isFallback: false },
  { id: "normal", edgeType: "default", priority: 100, isFallback: false },
] as SourceFidelityEdge[];

describe("runtime edge selection", () => {
  it("does not select an unmatched high-priority safety edge", () => {
    expect(selectNextRuntimeEdge(edges, context())?.id).toBe("normal");
  });

  it("selects the safety edge only when its condition is true", () => {
    expect(selectNextRuntimeEdge(edges, context(true))?.id).toBe("safety");
  });
});
