import { describe, expect, it } from "vitest";
import {
  CANONICAL_PROMPT_ITEMS,
  CANONICAL_SOURCE_SEEDS,
  CANONICAL_STAGE_NODES,
  CANONICAL_SESSION_PLAN,
  CANONICAL_PROTOCOL_ID,
  getCanonicalSourceFidelityIssues,
  resolveCanonicalSessionId,
} from "@/shared/protocol/source-fidelity-catalog";
import { TBCT_SOURCE_TEXT_HASH } from "@/shared/protocol/tbct-source-text.generated";

describe("canonical TBCT source-fidelity catalog", () => {
  it("creates all eight sessions from the verified source baseline", () => {
    expect(CANONICAL_SOURCE_SEEDS).toHaveLength(8);
    expect(CANONICAL_SESSION_PLAN.orderedEntries).toHaveLength(8);
    expect(CANONICAL_SESSION_PLAN.protocolId).toBe(CANONICAL_PROTOCOL_ID);
    expect(CANONICAL_SESSION_PLAN.orderedEntries.map((entry) => entry.sessionId)).toEqual([
      "tbct-s01",
      "tbct-s02",
      "tbct-s03",
      "tbct-s04",
      "tbct-s05",
      "tbct-s06",
      "tbct-s07",
      "tbct-s08",
    ]);
    expect(getCanonicalSourceFidelityIssues()).toEqual([]);
  });

  it("keeps every active prompt tied to an exact source trace and a canonical node", () => {
    expect(CANONICAL_PROMPT_ITEMS.length).toBeGreaterThan(100);
    for (const promptItem of CANONICAL_PROMPT_ITEMS) {
      expect(promptItem.origin).toBe("source_imported");
      expect(promptItem.sourceHash).toBe(TBCT_SOURCE_TEXT_HASH);
      expect(promptItem.verbatimText.trim()).not.toBe("");
      expect(promptItem.sourceTrace.sourceLineStart).toBeGreaterThan(0);
      expect(promptItem.sourceTrace.sourceLineEnd).toBeGreaterThanOrEqual(promptItem.sourceTrace.sourceLineStart);
      expect(CANONICAL_STAGE_NODES.some((node) => node.id === promptItem.nodeId)).toBe(true);
    }

    for (const node of CANONICAL_STAGE_NODES) {
      expect(node.promptItemIds.length).toBeGreaterThan(0);
      for (const promptItemId of node.promptItemIds) {
        expect(CANONICAL_PROMPT_ITEMS.some((promptItem) => promptItem.id === promptItemId)).toBe(true);
      }
    }
  });

  // Session-specific content checks (S05/S06/S07/S08's own corruption
  // status and validation controls) now live in their own
  // src/lib/protocol/sessions/s0N.test.ts, next to that session's own
  // spec -- only genuinely cross-session invariants stay here.

  it("resolves legacy identifiers only as aliases to source-derived IDs", () => {
    expect(resolveCanonicalSessionId("tbct-session-03")).toBe("tbct-s03");
    expect(resolveCanonicalSessionId("SESSION-08")).toBe("tbct-s08");
    expect(resolveCanonicalSessionId("tbct-br-001-session-05")).toBe("tbct-s05");
  });
});