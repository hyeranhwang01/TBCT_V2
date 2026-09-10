import { describe, it, expect, beforeEach } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { editWorksheetField } from "@/shared/worksheet/worksheet-projection";
import { compileDialogueContract } from "@/shared/dialogue-agent/dialogue-contract-compiler";
import { loadRuntimeRelease } from "@/shared/runtime/runtime-release-loader";

// Section 7's exact scenario: the situation was originally captured as one
// thing, the participant edits and confirms a different value via the
// worksheet, and the very next dialogue-agent contract must reflect the
// EDITED value -- never the original chat-derived text. compileDialogueContract
// reads session.runtimeContext.fields directly (never chat history), so this
// is really testing that editWorksheetField's canonical write lands there
// before the next contract is compiled, not any dialogue-agent-specific logic.
describe("case 8: worksheet edit is reflected in the next dialogue contract", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
  });

  it("uses the participant's edited+confirmed value, not the original extracted one", async () => {
    process.env.AI_PROVIDER = "mock";
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", patientAlias: "Synthetic", locale: "en-US" });
    await startRuntimeSession(session.id);

    // Walk through the safety pre-check and intro-node turns (S03 opens with
    // both before Q1, plus the redirection-contract confirmation -- §6.3)
    // until the situation prompt is actually active, then answer it with the
    // original text. The pre-situation turns aren't all the same shape: the
    // redirection-contract prompt needs a real boolean answer, or it keeps
    // re-asking itself instead of advancing.
    let view = await getRuntimeSession(session.id);
    for (let guard = 0; guard < 6 && !view!.currentPromptItem?.outputFields.includes("situation"); guard += 1) {
      const isBooleanPrompt = (view!.currentPromptItem as { validation?: { kind?: string } } | undefined)?.validation?.kind === "boolean";
      // parseBooleanInput (runtime-deterministic-input.ts) only matches an
      // exact "yes"/"no" (plus a short fixed-word allowlist), not a full
      // sentence -- a bare "Yes" is required here.
      const patientInput = isBooleanPrompt ? { kind: "boolean" as const, value: true } : { kind: "text" as const, value: "No, nothing urgent. Please continue." };
      await submitPatientInput(session.id, patientInput, { clientTurnId: `t-pre-${guard}`, expectedSessionVersion: view!.session.version ?? 0 });
      view = await getRuntimeSession(session.id);
    }
    expect(view?.currentPromptItem?.outputFields).toContain("situation");
    await submitPatientInput(session.id, { kind: "text", value: "My partner did not reply to my messages yesterday afternoon." }, { clientTurnId: "t-situation", expectedSessionVersion: view!.session.version ?? 0 });

    view = await getRuntimeSession(session.id);
    expect(view!.session.runtimeContext.fields.situation).toBe("My partner did not reply to my messages yesterday afternoon.");

    // Participant edits the worksheet field directly (not via chat).
    await editWorksheetField(session.id, "tbct-s03", "situation", "I don't want to study. Studying gives me too much stress.");

    view = await getRuntimeSession(session.id);
    expect(view!.session.runtimeContext.fields.situation).toBe("I don't want to study. Studying gives me too much stress.");

    // The next dialogue contract (for whatever prompt is now active) must
    // ground on the edited value.
    const runtimeRelease = loadRuntimeRelease(view!.release!);
    const runtimePromptItem = runtimeRelease.promptItems.find((item) => item.sourcePromptItemId === view!.currentPromptItem!.id)!;
    const contract = compileDialogueContract({
      session: view!.session,
      node: view!.nodes.find((node) => node.id === view!.session.currentNodeId)!,
      sourcePromptItem: view!.currentPromptItem!,
      runtimePromptItem,
      recentMessages: view!.messages,
      clarificationAttemptCount: 0,
      isFirstPromptOfNode: false,
      isFirstPromptOfSession: false,
    });
    expect(contract.confirmedState.situation).toBe("I don't want to study. Studying gives me too much stress.");
    expect(contract.confirmedState.situation).not.toContain("did not reply to my messages");
  });
});
