import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { ProtocolCondition } from "@/types/protocol-runtime";
import { createDraftFromRelease, createProtocolNode, downloadProtocolReleasePackage, evaluateProtocolCondition, getProtocolGraphApi, publishProtocolRelease, runProtocolValidation } from "@/clinician/lib/api/protocol-api";

function readBlobAsArrayBuffer(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

describe("evaluateProtocolCondition", () => {
  const context = {
    fields: { mood: "low", score: 3, tags: ["homework", "followup"] },
    expectedResponseCategory: "avoidance",
    riskLevel: "high" as const,
    homeworkStatus: "pending" as const,
    iterationCounts: { exposure: 2 },
  };

  it("supports equals", () => {
    const condition: ProtocolCondition = { id: "COND-1", field: "mood", operator: "equals", value: "low" };
    expect(evaluateProtocolCondition(condition, context).matched).toBe(true);
  });

  it("supports greater_than", () => {
    const condition: ProtocolCondition = { id: "COND-2", field: "score", operator: "greater_than", value: 2 };
    expect(evaluateProtocolCondition(condition, context).matched).toBe(true);
  });

  it("supports in", () => {
    const condition: ProtocolCondition = { id: "COND-3", field: "riskLevel", operator: "in", value: ["medium", "high"] };
    expect(evaluateProtocolCondition(condition, context).matched).toBe(true);
  });

  it("marks custom expressions unsupported", () => {
    const condition: ProtocolCondition = { id: "COND-4", field: "custom", operator: "custom", expression: "score > 1" };
    expect(evaluateProtocolCondition(condition, context).unsupported).toBe(true);
  });

  it("returns source-backed canonical graphs for legacy protocol and session aliases", async () => {
    const graph = await getProtocolGraphApi("TBCT-BR-001", "tbct-session-08");
    const validation = await runProtocolValidation("TBCT-BR-001", "SESSION-08");

    expect(graph.definition?.id).toBe("tbct-br-001");
    expect(graph.session.id).toBe("tbct-s08");
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.every((node) => node.sessionId === "tbct-s08" && node.data.promptItemIds?.length)).toBe(true);
    expect(graph.edges.every((edge) => edge.sessionId === "tbct-s08")).toBe(true);
    expect(validation.protocolId).toBe("tbct-br-001");
    expect(validation.summary.critical).toBe(0);
  });

  it("publishes all eight canonical sessions in one immutable source-fidelity release", async () => {
    await runProtocolValidation("tbct-br-001", "tbct-s01");
    const published = await publishProtocolRelease("TBCT-BR-001", {
      version: `source-fidelity-${Date.now()}`,
      targetEnvironment: "development",
      changeSummary: "Canonical source-fidelity test release",
    });
    const sourceFidelity = published.release.immutableSnapshot.sourceFidelity;

    expect(published.release.protocolId).toBe("tbct-br-001");
    expect(sourceFidelity?.sessionDefinitions).toHaveLength(8);
    expect(sourceFidelity?.sessionPlan.orderedEntries.map((entry) => entry.sessionId)).toEqual([
      "tbct-s01", "tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08",
    ]);
    expect(published.release.immutableSnapshot.nodes.some((node) => node.id.startsWith("RT-NODE-"))).toBe(false);
    expect(published.release.immutableSnapshot.nodes.every((node) => node.data.promptItemIds?.length)).toBe(true);
    expect(published.files["source-fidelity.json"]).toBeTruthy();
    expect(published.release.immutableSnapshot.runtimeRelease?.id).toBe(published.release.id);
    expect(published.release.immutableSnapshot.runtimeRelease?.contentHash).toBeTruthy();
    expect(published.files["runtime-release.json"]).toBeTruthy();
  });

  it("downloads the exact immutable runtime release artifact", async () => {
    await runProtocolValidation("tbct-br-001", "tbct-s01");
    const published = await publishProtocolRelease("TBCT-BR-001", {
      version: `runtime-download-${Date.now()}`,
      targetEnvironment: "development",
      changeSummary: "Immutable runtime download test release",
    });

    const archive = await JSZip.loadAsync(await readBlobAsArrayBuffer(await downloadProtocolReleasePackage(published.release.id)));
    const runtimeReleasePath = Object.keys(archive.files).find((path) => path.endsWith("/runtime-release.json"));
    const downloadedRuntimeRelease = await archive.file(runtimeReleasePath!)?.async("string");

    expect(downloadedRuntimeRelease).toBe(published.files["runtime-release.json"]);
  });

  it("rejects legacy graph mutations and Session 03 draft creation for the canonical protocol", async () => {
    await expect(createProtocolNode({
      protocolId: "TBCT-BR-001",
      sessionId: "tbct-s01",
      nodeType: "dialogue",
      title: "Blocked legacy mutation",
      reason: "Test immutable source model",
    })).rejects.toThrow("immutable");

    await runProtocolValidation("tbct-br-001", "tbct-s01");
    const published = await publishProtocolRelease("tbct-br-001", {
      version: `immutable-${Date.now()}`,
      targetEnvironment: "development",
      changeSummary: "Immutable canonical source release test",
    });
    await expect(createDraftFromRelease(published.release.id, {
      version: "legacy-draft-blocked",
      changeSummary: "Must not create a Session 03 legacy draft",
    })).rejects.toThrow("immutable");
  });
});
