import { describe, expect, it } from "vitest";
import { getSessionById, getSessionCommonRules, getSessionNodes, getSessionPrompts, loadSessionDefinitions, loadSessionPlan, sessionCatalog } from "@/clinician/lib/session-catalog";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/shared/protocol/source-fidelity-catalog";

describe("source-fidelity session catalog", () => {
  it("uses all eight canonical SessionDefinitions for the synchronous UI catalog", () => {
    expect(loadSessionDefinitions().map((session) => session.id)).toEqual([
      "tbct-s01",
      "tbct-s02",
      "tbct-s03",
      "tbct-s04",
      "tbct-s05",
      "tbct-s06",
      "tbct-s07",
      "tbct-s08",
    ]);
    expect(sessionCatalog.map((session) => session.id)).toEqual(loadSessionDefinitions().map((session) => session.id));
  });

  it("resolves legacy session identifiers only as aliases to canonical source sessions", () => {
    expect(getSessionById("tbct-session-01")?.id).toBe("tbct-s01");
    expect(getSessionById("SESSION-03")?.id).toBe("tbct-s03");
    expect(getSessionById("tbct-br-001-session-08")?.title).toBe("Trial One");
  });

  it("returns the canonical node and PromptItem identities used by the source catalog", () => {
    expect(getSessionNodes("tbct-session-03").map((node) => node.id)).toEqual(
      CANONICAL_STAGE_NODES.filter((node) => node.sessionId === "tbct-s03").map((node) => node.id),
    );
    expect(getSessionPrompts("tbct-session-08").map((promptItem) => promptItem.id)).toEqual(
      CANONICAL_PROMPT_ITEMS.filter((promptItem) => promptItem.sessionId === "tbct-s08").map((promptItem) => promptItem.id),
    );
  });

  it("keeps all source Common Rules and exact source traces available to the UI", () => {
    expect(getSessionCommonRules("tbct-s01")?.sourceTrace?.sourceLineStart).toBe(18);
    expect(getSessionCommonRules("tbct-s06")?.sourceFidelityStatus).toBe("review_required");
    expect(getSessionPrompts("tbct-s07").every((promptItem) => promptItem.origin === "source_imported" && promptItem.sourceTrace.sourceLineStart)).toBe(true);
    expect(loadSessionPlan().orderedEntries[0]?.label).toBe("Session 01");
    expect(loadSessionPlan().orderedEntries.find((entry) => entry.sessionId === "tbct-s08")?.label).toBe("Session 08");
  });
});
