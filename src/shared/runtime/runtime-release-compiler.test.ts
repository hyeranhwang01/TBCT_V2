import { describe, expect, it } from "vitest";
import { createCanonicalSourceFidelityReleaseSnapshot } from "@/shared/protocol/source-fidelity-protocol-adapter";
import { compileRuntimeRelease } from "@/shared/runtime/runtime-release-compiler";

describe("compileRuntimeRelease", () => {
  it("reports a critical issue when a session has no terminal node", async () => {
    const snapshot = createCanonicalSourceFidelityReleaseSnapshot();
    snapshot.clinicalStageNodes = snapshot.clinicalStageNodes.filter((node) => !(node.sessionId === "tbct-s01" && node.type === "session_complete"));

    const result = await compileRuntimeRelease({
      releaseId: "release-invalid",
      protocolId: "tbct-br-001",
      version: "invalid",
      publishedAt: "2025-01-01T00:00:00.000Z",
      snapshot,
    });

    expect(result.issues.some((issue) => issue.severity === "critical" && issue.sessionId === "tbct-s01" && issue.message.includes("terminal node"))).toBe(true);
  });
});