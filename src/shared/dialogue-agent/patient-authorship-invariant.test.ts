import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/shared/protocol/source-fidelity-catalog";
import { getWorksheetBindings } from "@/shared/worksheet/worksheet-binding-registry";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { contractMayRequireAssembly } from "@/shared/dialogue-agent/message-composition";
import { projectRuntimeFieldsToWorksheet, getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import { createCanonicalTestRuntimeSession } from "@/shared/api/runtime-session-api";
import type { RuntimeSession } from "@/types/runtime-session";
import type { RuntimePromptItem } from "@/types/protocol-runtime";

// Permanence device for the Patient Authorship Invariant
// (.claude/TASK_SCOPE.json note2026_09_05, plan file
// goofy-orbiting-noodle.md): "the participant owns this field, but the
// assistant may supply its value" must never be a reachable state, for any
// field, in any of the 8 sessions -- present or future. This is exactly the
// bug tbct-s03.ts's 18 pilot bindings had (see that file's own header
// comment). These tests assert the INVARIANT, not any particular field's
// current value, so a new field or a new session that reintroduces the
// contradiction fails here automatically, without needing to update this
// file.

const ALL_SESSION_IDS = ["tbct-s01", "tbct-s02", "tbct-s03", "tbct-s04", "tbct-s05", "tbct-s06", "tbct-s07", "tbct-s08"];

function minimalSession(sessionDefinitionId: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: "invariant-test-session",
    projectId: "TBCT-BR-001",
    protocolId: "tbct-br-001",
    protocolVersion: "1",
    releaseId: "release-1",
    sessionDefinitionId,
    participantId: "invariant-test-participant",
    status: "waiting_for_input",
    patientAlias: "Synthetic",
    locale: "en-US",
    runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {} },
    ...overrides,
  } as RuntimeSession;
}

function minimalRuntimePromptItem(overrides: Partial<RuntimePromptItem> = {}): RuntimePromptItem {
  return {
    id: "invariant-test-runtime-prompt",
    nodeId: "invariant-test-node",
    roleId: "tbct_guide",
    scope: "node",
    sequenceIndex: 1,
    executionMode: "serial",
    modelGuidance: "",
    fallbackPatientText: "Placeholder task text.",
    completionCondition: { kind: "always" },
    allowedActions: ["ask"],
    forbiddenActions: [],
    requiredFields: [],
    validationRules: [],
    maxAttempts: 3,
    requiresPatientInput: true,
    outputSchemaVersion: "1",
    ...overrides,
  };
}

describe("Patient Authorship Invariant: worksheet bindings", () => {
  it("never declares a field participant-owned while also allowing the assistant to supply it, in any of the 8 sessions", () => {
    const offenders: string[] = [];
    for (const sessionId of ALL_SESSION_IDS) {
      for (const binding of getWorksheetBindings(sessionId)) {
        if (binding.participantOwned === true && binding.assistantMustNotSupply === false) {
          offenders.push(`${sessionId}.${binding.canonicalFieldKey}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Patient Authorship Invariant: compiled dialogue contracts", () => {
  it("never compiles a contract where participantOwned is true and assistantMustNotSupply is false, for any real prompt item across all 8 sessions", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const sessionId of ALL_SESSION_IDS) {
      const promptItems = CANONICAL_PROMPT_ITEMS.filter((item) => item.sessionId === sessionId && item.outputFields.length > 0);
      for (const promptItem of promptItems) {
        const node = CANONICAL_STAGE_NODES.find((candidate) => candidate.id === promptItem.nodeId);
        if (!node) continue; // orphaned prompt item -- covered separately by catalog integrity tests, not this invariant.
        const contract = compileDialogueContract({
          session: minimalSession(sessionId),
          node,
          sourcePromptItem: promptItem,
          runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id, fallbackPatientText: promptItem.fallbackPatientText ?? "Placeholder task text." }),
          recentMessages: [],
          clarificationAttemptCount: 0,
          isFirstPromptOfNode: false,
          isFirstPromptOfSession: false,
        });
        checked += 1;
        if (contract.participantOwned === true && contract.assistantMustNotSupply === false) {
          offenders.push(`${promptItem.id} (${contract.targetField})`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describe("Patient Authorship Invariant: node-level protected-field gap (2026-09-07 fix)", () => {
  // Real transcript-confirmed gap: a turn whose OWN targetField is a pure
  // administrative acknowledgment flag was not gated, even though its node
  // is also responsible for a genuinely protected field the turn's free
  // prose could still restate or invent content for -- S08's
  // roles-orientation turn restated the participant's own hedged charge as
  // a flat, invented declarative. See dialogue-contract-compiler.ts's
  // isFieldProtected and message-composition.ts's contractMayRequireAssembly.
  it("gates S08's roles-orientation turn via nodeRequiresProtectedField, even though its own field is an administrative flag", () => {
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id === "tbct-s08-n03-p01-roles-orientation")!;
    const node = CANONICAL_STAGE_NODES.find((candidate) => candidate.id === promptItem.nodeId)!;
    expect(promptItem).toBeDefined();
    expect(node).toBeDefined();
    const contract = compileDialogueContract({
      session: minimalSession("tbct-s08"),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id, fallbackPatientText: promptItem.fallbackPatientText ?? "task" }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    expect(contract.targetField).toBe("courtroomOrientationAcknowledged");
    expect(contract.assistantMustNotSupply).toBe(false); // own field's meaning stays precise
    expect(contract.nodeRequiresProtectedField).toBe(true); // node also requires "charge"
    expect(contractMayRequireAssembly(contract)).toBe(true);
  });

  it("gates S08's daily-appeal-homework turn the same way (node also requires appealEvidence)", () => {
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id === "tbct-s08-n19-p02-daily-appeal-homework")!;
    const node = CANONICAL_STAGE_NODES.find((candidate) => candidate.id === promptItem.nodeId)!;
    expect(promptItem).toBeDefined();
    expect(node).toBeDefined();
    const contract = compileDialogueContract({
      session: minimalSession("tbct-s08"),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id, fallbackPatientText: promptItem.fallbackPatientText ?? "task" }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    expect(contract.targetField).toBe("appealHomeworkAcknowledged");
    expect(contract.assistantMustNotSupply).toBe(false);
    expect(contract.nodeRequiresProtectedField).toBe(true);
    expect(contractMayRequireAssembly(contract)).toBe(true);
  });

  it("does not widen the gate for a turn whose node has no protected requiredFields at all", () => {
    // Sanity check against over-widening: an ordinary content-bearing S03
    // turn (evidenceFor) whose node doesn't happen to ALSO require some
    // other field should not need nodeRequiresProtectedField to be gated --
    // it's already gated via its own assistantMustNotSupply.
    const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id === "tbct-s03-n10-p01-evidence-for")!;
    const node = CANONICAL_STAGE_NODES.find((candidate) => candidate.id === promptItem.nodeId)!;
    expect(promptItem).toBeDefined();
    const contract = compileDialogueContract({
      session: minimalSession("tbct-s03"),
      node,
      sourcePromptItem: promptItem,
      runtimePromptItem: minimalRuntimePromptItem({ nodeId: node.id, fallbackPatientText: promptItem.fallbackPatientText ?? "task" }),
      recentMessages: [],
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    expect(contract.assistantMustNotSupply).toBe(true);
  });
});

describe("Patient Authorship Invariant: worksheet provenance", () => {
  it("projects a participant-owned field's value as participant_verbatim, never participant_confirmed_summary, before any confirmation has happened", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03" });
    await projectRuntimeFieldsToWorksheet({
      runtimeSessionId: session.id,
      sessionDefinitionId: "tbct-s03",
      fields: { automaticThought: "She will correct me in front of everyone." },
    });
    const view = await getWorksheetView(session.id, "tbct-s03");
    const field = view?.fields.find((item) => item.definition.canonicalFieldKey === "automaticThought");
    expect(field?.value?.provenance).toBe("participant_verbatim");
    expect(field?.value?.status).toBe("draft_extracted");
  });

  it("projects a system-owned (participantOwned: false) field's value as system_calculated, not participant_verbatim", async () => {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02" });
    await projectRuntimeFieldsToWorksheet({
      runtimeSessionId: session.id,
      sessionDefinitionId: "tbct-s02",
      fields: { totalProblemScore: 7 },
    });
    const view = await getWorksheetView(session.id, "tbct-s02");
    const field = view?.fields.find((item) => item.definition.canonicalFieldKey === "totalProblemScore");
    expect(field?.value?.provenance).toBe("system_calculated");
  });
});
