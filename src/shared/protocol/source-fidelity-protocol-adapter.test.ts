import { describe, expect, it } from "vitest";
import {
  CANONICAL_PROTOCOL_ID,
  CANONICAL_PROMPT_ITEMS,
  CANONICAL_SOURCE_EDGES,
  CANONICAL_STAGE_NODES,
  CANONICAL_SESSION_PLAN,
} from "@/shared/protocol/source-fidelity-catalog";
import {
  createCanonicalProtocolDefinition,
  createCanonicalProtocolGraphSnapshot,
  createCanonicalProtocolReleaseSnapshot,
  createCanonicalProtocolSession,
  isCanonicalProtocolId,
} from "@/shared/protocol/source-fidelity-protocol-adapter";
import { TBCT_SOURCE_TEXT_HASH } from "@/shared/protocol/tbct-source-text.generated";

describe("canonical source-fidelity protocol adapter", () => {
  it("projects the complete canonical source model into one immutable release snapshot", () => {
    const snapshot = createCanonicalProtocolReleaseSnapshot();
    const sourceFidelity = snapshot.sourceFidelity;

    expect(sourceFidelity.sourceTextHash).toBe(TBCT_SOURCE_TEXT_HASH);
    expect(sourceFidelity.sessionPlan).toEqual(CANONICAL_SESSION_PLAN);
    expect(sourceFidelity.clinicalStageNodes.map((node) => node.id)).toEqual(CANONICAL_STAGE_NODES.map((node) => node.id));
    expect(sourceFidelity.promptItems.map((promptItem) => promptItem.id)).toEqual(CANONICAL_PROMPT_ITEMS.map((promptItem) => promptItem.id));
    expect(sourceFidelity.sourceFidelityEdges.map((edge) => edge.id)).toEqual(CANONICAL_SOURCE_EDGES.map((edge) => edge.id));
    expect(snapshot.nodes.map((node) => node.id)).toEqual(CANONICAL_STAGE_NODES.map((node) => node.id));
    expect(snapshot.edges.map((edge) => edge.id)).toEqual(CANONICAL_SOURCE_EDGES.map((edge) => edge.id));
    expect(snapshot.nodes.some((node) => node.id.startsWith("RT-NODE-"))).toBe(false);
  });

  it("keeps every graph node bound to its canonical prompt IDs and source trace", () => {
    const snapshot = createCanonicalProtocolReleaseSnapshot();
    const promptIds = new Set(snapshot.sourceFidelity.promptItems.map((promptItem) => promptItem.id));

    for (const node of snapshot.nodes) {
      expect(node.data.canonicalNodeId).toBe(node.id);
      expect(node.data.promptItemIds?.length).toBeGreaterThan(0);
      expect(node.data.sourceTrace?.sourceLineStart).toBeGreaterThan(0);
      expect(node.data.sourceEvidenceIds).toHaveLength(1);
      for (const promptItemId of node.data.promptItemIds ?? []) {
        expect(promptIds.has(promptItemId)).toBe(true);
      }
    }
  });

  it("accepts legacy protocol and session aliases only as views over canonical graph IDs", () => {
    expect(isCanonicalProtocolId("TBCT-BR-001")).toBe(true);
    const graph = createCanonicalProtocolGraphSnapshot("SESSION-03");

    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.every((node) => node.sessionId === "tbct-s03")).toBe(true);
    expect(graph.edges.every((edge) => edge.sessionId === "tbct-s03")).toBe(true);
  });

  it("creates canonical protocol and session metadata from the same source session identities", () => {
    const definition = createCanonicalProtocolDefinition();
    const session = createCanonicalProtocolSession("tbct-session-03");

    expect(definition.id).toBe(CANONICAL_PROTOCOL_ID);
    expect(definition.sessionIds).toHaveLength(8);
    expect(session?.id).toBe("tbct-s03");
    expect(session?.nodeIds.length).toBeGreaterThan(0);
    expect(session?.completionNodeIds).toHaveLength(1);
  });
});