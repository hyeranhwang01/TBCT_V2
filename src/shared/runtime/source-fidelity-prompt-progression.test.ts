import { describe, expect, it } from "vitest";
import { createCanonicalProtocolReleaseSnapshot } from "@/shared/protocol/source-fidelity-protocol-adapter";
import {
  getReleasePromptItems,
  promptRequiresPatientInput,
  resolveCurrentReleasePrompt,
} from "@/shared/runtime/source-fidelity-prompt-progression";
import type { ProtocolReleaseVersion } from "@/types/protocol-runtime";
import type { RuntimeContext } from "@/types/runtime-session";
import { normalizeRuntimeReleaseFromSourceSnapshot } from "@/shared/runtime/runtime-release-normalizer";

const context: RuntimeContext = {
  fields: {},
  riskSignals: [],
  iterationCounts: {},
  activityCompletion: "not_started",
  homeworkStatus: "not_assigned",
  riskLevel: "low",
};

function releaseWithSnapshot(): ProtocolReleaseVersion {
  return {
    id: "REL-SOURCE-TEST",
    protocolId: "tbct-br-001",
    version: "source-test",
    releasePackageId: "PKG-SOURCE-TEST",
    publishedAt: "2025-01-01T00:00:00.000Z",
    publishedBy: "test",
    changeSummary: "test",
    immutableSnapshot: createCanonicalProtocolReleaseSnapshot(),
  };
}

describe("source-fidelity PromptItem progression", () => {
  it("gives every active PromptItem a patient-facing fallback without generic or internal authoring text", () => {
    const snapshot = createCanonicalProtocolReleaseSnapshot().sourceFidelity!;
    const runtime = normalizeRuntimeReleaseFromSourceSnapshot({ releaseId: "test", protocolId: "tbct-br-001", version: "test", publishedAt: "2025-01-01T00:00:00.000Z", snapshot });
    for (const prompt of runtime.promptItems) {
      expect(prompt.fallbackPatientText, prompt.id).not.toContain("We can take this one step at a time");
      expect(prompt.fallbackPatientText).not.toMatch(/^Step\s+\d+\s*:/i);
      expect(prompt.fallbackPatientText).not.toMatch(/\b(?:ask|invite|guide|instruct) the participant\b/i);
    }
  });
  it("resolves a current prompt in canonical node order rather than a mutable catalog order", () => {
    const release = releaseWithSnapshot();
    const nodeId = "tbct-s08-n01-investigation-and-core-belief";
    const promptItems = getReleasePromptItems(release, nodeId);
    const first = resolveCurrentReleasePrompt({ release, nodeId, runtimeContext: context });
    const second = resolveCurrentReleasePrompt({
      release,
      nodeId,
      runtimeContext: context,
      completedPromptItemIds: [first.promptItem?.id ?? ""],
    });

    expect(promptItems.map((promptItem) => promptItem.id)).toEqual([
      // The participant guide's "quick word first" -- the materials check and
      // the belief-as-charge orientation (with its invited reaction) precede
      // the investigation itself.
      "tbct-s08-n01-p01-trial-materials-ready",
      "tbct-s08-n01-p02-belief-as-charge-orientation",
      "tbct-s08-n01-p03-orientation-reaction",
      "tbct-s08-n01-p04-distressing-situation",
      "tbct-s08-n01-p05-downward-arrow",
    ]);
    expect(first.promptItem?.id).toBe(promptItems[0]?.id);
    expect(second.promptItem?.id).toBe(promptItems[1]?.id);
    expect(promptRequiresPatientInput(first.promptItem!)).toBe(true);
  });

  it("skips source-defined inactive PromptItems and keeps the skip list explicit", () => {
    const release = releaseWithSnapshot();
    const nodeId = "tbct-s02-n01-opening";
    const promptItems = getReleasePromptItems(release, nodeId);
    const resolution = resolveCurrentReleasePrompt({
      release,
      nodeId,
      runtimeContext: context,
      completedPromptItemIds: [promptItems[0]?.id ?? ""],
    });

    expect(resolution.promptItem).toBeNull();
    expect(resolution.skippedPromptItemIds).toEqual(promptItems.slice(1).map((promptItem) => promptItem.id));
  });

  it("rejects releases that do not contain immutable source-fidelity content", () => {
    const release = releaseWithSnapshot();
    delete release.immutableSnapshot.sourceFidelity;

    expect(() => getReleasePromptItems(release, "tbct-s01-n01-mandatory-opening")).toThrow("source-fidelity snapshot");
  });
});
