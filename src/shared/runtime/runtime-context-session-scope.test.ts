import { describe, expect, it } from "vitest";
import { extractRuntimeState } from "@/shared/runtime/runtime-context";
import type { ClinicalStageNode, PromptItem } from "@/shared/protocol/source-fidelity-types";

// Audits that the two isMeaningfulTextResponse behaviors added for S01's
// Opening redesign (uncertainty acceptance, meta-question rejection) are
// scoped to exactly the one field that needs them (openingInitialThought)
// and do NOT change behavior for any other field in any other session --
// see .claude/TASK_SCOPE.json's note2026_08_17c entry. Kept as its own file
// rather than expanding the existing runtime-context.test.ts (out of scope).

function makeNode(sessionId: string, field: string): ClinicalStageNode {
  const now = new Date().toISOString();
  return {
    id: `node-${sessionId}-${field}`,
    protocolId: "tbct-br-001",
    sessionId,
    type: "question",
    title: field,
    clinicalPurpose: field,
    position: { x: 0, y: 0 },
    promptItemIds: [],
    requiredFields: [field],
    completionRule: {},
    branchRules: [],
    restrictions: [],
    safetyRuleIds: [],
    sourceTrace: { sourceDocument: "TBCT pasted source text", sourceSession: sessionId, sourceSection: field, sourceLineStart: 1, sourceLineEnd: 1, sourceTextHash: "test", importedVersion: "test" },
    sourceFidelityStatus: "structured_from_source",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

/** A plain free-text prompt with NO validation.kind -- the exact shape that
 * takes the same isMeaningfulTextResponse code path as S01's
 * openingInitialThought (no semantic-assessment gate, no boolean/enum
 * short-circuit), so it is the shape most exposed to any unscoped change. */
function makePrompt(sessionId: string, field: string): PromptItem {
  const now = "2025-01-01T00:00:00.000Z";
  return {
    id: `${sessionId}-n01-p01-${field}`,
    protocolId: "tbct-br-001",
    sessionId,
    nodeId: `node-${sessionId}-${field}`,
    order: 1,
    type: "question",
    verbatimText: "Placeholder question text.",
    editableText: "Placeholder question text.",
    aiInstruction: "Placeholder question text.",
    activationCondition: null,
    outputFields: [field],
    validation: null,
    completionEffect: null,
    restrictions: [],
    safetyRuleIds: [],
    sourceTrace: { sourceDocument: "TBCT pasted source text", sourceSession: sessionId, sourceSection: field, sourceLineStart: 1, sourceLineEnd: 1, sourceTextHash: "test", importedVersion: "test" },
    sourceFidelityStatus: "structured_from_source",
    origin: "source_imported",
    sourceHash: "test",
    status: "active",
    createdAt: now,
    updatedAt: now,
    updatedBy: "test",
  };
}

const REQUIRED_INPUTS = [
  { label: "잘 모르겠어요.", value: "잘 모르겠어요." },
  { label: "왜 물어보세요?", value: "왜 물어보세요?" },
  { label: "그게 무슨 말이에요?", value: "그게 무슨 말이에요?" },
  { label: "네.", value: "네." },
  { label: "기분이 안 좋았어요.", value: "기분이 안 좋았어요." },
];

async function extract(sessionId: string, field: string, value: string) {
  const promptItem = makePrompt(sessionId, field);
  return extractRuntimeState({
    patientInput: { kind: "text", value },
    currentNode: makeNode(sessionId, field),
    currentPromptItem: promptItem,
    currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
    locale: "ko-KR",
  });
}

describe("session-scoped isMeaningfulTextResponse exceptions", () => {
  it("S01 openingInitialThought: accepts uncertainty as a real answer", async () => {
    const result = await extract("tbct-s01", "openingInitialThought", "잘 모르겠어요.");
    expect(result.missingFields).toEqual([]);
    expect(result.fields.openingInitialThought).toBe("잘 모르겠어요.");
  });

  it("S01 openingInitialThought: rejects a meta-question about the process instead of storing it", async () => {
    const result = await extract("tbct-s01", "openingInitialThought", "왜 물어보세요?");
    expect(result.missingFields).toContain("openingInitialThought");
    expect(result.fields.openingInitialThought).toBeUndefined();
  });

  it.each(["tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"])(
    "%s: a plain free-text field keeps rejecting uncertainty exactly as before (legacy behavior, unaffected by the S01 exception)",
    async (sessionId) => {
      const result = await extract(sessionId, "someFreeTextField", "잘 모르겠어요.");
      expect(result.missingFields).toContain("someFreeTextField");
      expect(result.fields.someFreeTextField).toBeUndefined();
    },
  );

  it.each(["tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"])(
    "%s: a plain free-text field still stores a literal meta-question verbatim, exactly as before (pre-existing gap, not newly introduced or newly fixed here)",
    async (sessionId) => {
      const result = await extract(sessionId, "someFreeTextField", "왜 물어보세요?");
      expect(result.missingFields).toEqual([]);
      expect(result.fields.someFreeTextField).toBe("왜 물어보세요?");
    },
  );

  it.each(["tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"])(
    "%s: '그게 무슨 말이에요?' and '기분이 안 좋았어요.' are accepted the same way in every non-S01 session (legacy behavior, unaffected by either scoped exception)",
    async (sessionId) => {
      for (const input of [REQUIRED_INPUTS[2], REQUIRED_INPUTS[4]]) {
        const result = await extract(sessionId, "someFreeTextField", input.value);
        expect(result.missingFields).toEqual([]);
        expect(result.fields.someFreeTextField).toBe(input.value);
      }
    },
  );

  // S01's openingInitialThought/participantSelectedDistortions are in
  // META_QUESTION_AWARE_FIELDS (note2026_08_17d entry), so unlike every
  // other field/session above, '그게 무슨 말이에요?' is now correctly rejected
  // here (routes to clarification) instead of stored verbatim -- while
  // '기분이 안 좋았어요.' (genuine content, not a meta-question) is still accepted
  // exactly the same as everywhere else.
  it("tbct-s01 openingInitialThought: '그게 무슨 말이에요?' is rejected as a meta-question, but '기분이 안 좋았어요.' is accepted", async () => {
    const metaQuestion = await extract("tbct-s01", "openingInitialThought", "그게 무슨 말이에요?");
    expect(metaQuestion.missingFields).toContain("openingInitialThought");
    expect(metaQuestion.fields.openingInitialThought).toBeUndefined();

    const genuineAnswer = await extract("tbct-s01", "openingInitialThought", "기분이 안 좋았어요.");
    expect(genuineAnswer.missingFields).toEqual([]);
    expect(genuineAnswer.fields.openingInitialThought).toBe("기분이 안 좋았어요.");
  });

  it.each(["tbct-s01", "tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"])(
    "%s: a bare '네.' is rejected as filler the same way in every session -- pre-existing behavior, untouched by either scoped exception (only the 'idk'/'모르겠어요' family and process meta-questions were ever in scope)",
    async (sessionId) => {
      const field = sessionId === "tbct-s01" ? "openingInitialThought" : "someFreeTextField";
      const result = await extract(sessionId, field, "네.");
      expect(result.missingFields).toContain(field);
      expect(result.fields[field]).toBeUndefined();
    },
  );
});
