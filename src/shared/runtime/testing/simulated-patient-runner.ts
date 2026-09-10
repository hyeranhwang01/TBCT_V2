import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { listRuntimeExecutionTraces } from "@/shared/data/repositories/runtime-session-repository";
import { syntheticPatientInput } from "@/shared/runtime/testing/session-fidelity-fixtures";
import type { TurnFidelityResult } from "@/types/runtime-session";

export type SessionFidelityAudit = {
  sessionId: string;
  runtimeSessionId: string;
  releaseId: string;
  patientTurns: number;
  programTurns: number;
  promptItemsExecuted: string[];
  promptItemsSkipped: string[];
  fallbackCount: number;
  repairCount: number;
  providerErrorCount: number;
  clarificationCount: number;
  safetyOverrideCount: number;
  expectedFields: string[];
  capturedFields: string[];
  missingFields: string[];
  finalState: string;
  fidelity: TurnFidelityResult[];
  result: "pass" | "partial" | "fail";
  reasons: string[];
};

/**
 * A field counts as missing when an UNCONDITIONAL prompt promised it and the
 * run finished without it -- including when that prompt was never reached.
 *
 * This used to also require `executed.has(prompt.id)`, which made the audit
 * blind to exactly the failure it exists to catch: if the runtime never
 * reached a prompt (a whole node skipped, or a passive prompt that declares
 * an output field nothing writes), the field was silently dropped from the
 * check, and the report said "Missing fields: none / PASS" while parts of the
 * protocol had produced no data at all.
 *
 * Prompts that are conditional by design are excluded -- both those the
 * runtime explicitly recorded as skipped and those carrying an
 * activationCondition that simply never became true (a "not ready" follow-up
 * in a run where the patient said "ready"). Those are branches not taken, not
 * data loss.
 */
/** Nodes reachable from the session's start node using only unconditional
 * edges -- i.e. the path every run takes. A node whose every incoming edge
 * carries a condition (S03's factual-thought branch, S04's social-anxiety
 * pathway, S05's residual-shame branch, S06's yellow/red homework block) is a
 * branch, and not entering it is a decision, not data loss. */
export function computeDefaultPathNodeIds(input: {
  startNodeId: string;
  edges: Array<{ source: string; target: string; condition?: unknown; isFallback?: boolean }>;
}) {
  const reachable = new Set<string>([input.startNodeId]);
  const unconditionalEdges = input.edges.filter((edge) => !edge.condition && !edge.isFallback);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of unconditionalEdges) {
      if (reachable.has(edge.source) && !reachable.has(edge.target)) {
        reachable.add(edge.target);
        grew = true;
      }
    }
  }
  return reachable;
}

export function computeMissingFields(input: {
  expectedFields: string[];
  capturedFields: string[];
  normalPrompts: Array<{ id: string; nodeId: string; outputFields: string[]; activationCondition?: unknown }>;
  skippedPromptItemIds: string[];
  defaultPathNodeIds: Set<string>;
}) {
  const skipped = new Set(input.skippedPromptItemIds);
  const captured = new Set(input.capturedFields);
  const unconditional = input.normalPrompts.filter((prompt) =>
    !skipped.has(prompt.id) && !prompt.activationCondition && input.defaultPathNodeIds.has(prompt.nodeId));
  return input.expectedFields.filter((field) =>
    !captured.has(field) && unconditional.some((prompt) => prompt.outputFields.includes(field)));
}

export async function runSimulatedPatientSession(sessionDefinitionId: string, maxTurns = 400): Promise<SessionFidelityAudit> {
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "mock";
  try {
    const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId, patientAlias: `Synthetic ${sessionDefinitionId}`, locale: "en-US" });
    await startRuntimeSession(session.id);
    let patientTurns = 0;
    const executed = new Set<string>();
    while (patientTurns < maxTurns) {
      const view = await getRuntimeSession(session.id);
      if (!view) throw new Error(`Session ${session.id} disappeared during audit.`);
      if (view.session.status === "completed") break;
      if (view.session.status !== "waiting_for_input") throw new Error(`Unexpected session status ${view.session.status}.`);
      const prompt = view.currentPromptItem;
      if (!prompt) throw new Error("Waiting session has no active PromptItem.");
      executed.add(prompt.id);
      let result;
      try {
        result = await submitPatientInput(session.id, syntheticPatientInput(prompt), {
          clientTurnId: `${sessionDefinitionId}-turn-${patientTurns + 1}`,
          expectedSessionVersion: view.session.version ?? 0,
        });
      } catch (error) {
        throw new Error(`${sessionDefinitionId}/${prompt.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      patientTurns += 1;
      if (result.turnOutcome === "clarification" || result.turnOutcome === "fallback" || result.turnOutcome === "safety_override" || result.turnOutcome === "rejected_duplicate") {
        throw new Error(`${prompt.id} produced ${result.turnOutcome}.`);
      }
    }
    const finalView = await getRuntimeSession(session.id);
    if (!finalView) throw new Error("Completed session could not be reloaded.");
    const traces = await listRuntimeExecutionTraces(session.id);
    const providerEvents = finalView.providerEvents;
    const assistantMessages = finalView.messages.filter((message) => message.role === "assistant");
    const normalPrompts = finalView.promptItems.filter((prompt) => prompt.sessionId === finalView.session.sessionDefinitionId && !prompt.nodeId.endsWith("safety-pause"));
    const expectedFields = [...new Set(normalPrompts.flatMap((prompt) => prompt.outputFields))];
    const capturedFields = Object.keys(finalView.session.runtimeContext.fields);
    const sessionDefinition = finalView.release.immutableSnapshot.sourceFidelity?.sessionDefinitions?.find((definition) => definition.id === finalView.session.sessionDefinitionId);
    const defaultPathNodeIds = computeDefaultPathNodeIds({
      startNodeId: sessionDefinition?.startNodeId ?? "",
      edges: finalView.edges.filter((edge) => edge.sessionId === finalView.session.sessionDefinitionId),
    });
    const missingFields = computeMissingFields({ expectedFields, capturedFields, normalPrompts, skippedPromptItemIds: finalView.session.skippedPromptItemIds ?? [], defaultPathNodeIds });
    const fallbackCount = traces.filter((trace) => trace.fallbackUsed).length;
    const providerErrorCount = providerEvents.filter((event) => Boolean(event.error)).length;
    const clarificationCount = assistantMessages.filter((message) => message.metadata?.turnOutcome === "clarification").length;
    const safetyOverrideCount = assistantMessages.filter((message) => message.metadata?.turnOutcome === "safety_override").length;
    const fidelity = traces.map((trace) => trace.fidelity);
    const reasons: string[] = [];
    if (finalView.session.status !== "completed") reasons.push(`Final status is ${finalView.session.status}.`);
    if (fallbackCount) reasons.push(`${fallbackCount} fallback turn(s) were used.`);
    if (providerErrorCount) reasons.push(`${providerErrorCount} provider error(s) occurred.`);
    if (missingFields.length) reasons.push(`Missing fields: ${missingFields.join(", ")}.`);
    if (fidelity.some((item) => item.safetyFidelity === "critical_fail" || item.activePromptFidelity === "fail" || item.sequenceFidelity === "fail" || item.roleFidelity === "fail" || item.languageFidelity === "fail" || item.transitionFidelity === "fail")) reasons.push("One or more deterministic fidelity dimensions failed.");
    const result = reasons.length === 0 ? "pass" : finalView.session.status === "completed" ? "partial" : "fail";
    return {
      sessionId: sessionDefinitionId, runtimeSessionId: session.id, releaseId: finalView.release.id, patientTurns,
      programTurns: assistantMessages.length, promptItemsExecuted: [...executed], promptItemsSkipped: finalView.session.skippedPromptItemIds ?? [],
      fallbackCount, repairCount: 0, providerErrorCount, clarificationCount, safetyOverrideCount, expectedFields, capturedFields, missingFields,
      finalState: finalView.session.status, fidelity, result, reasons,
    };
  } finally {
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
  }
}

export async function runSessions01To08Audit() {
  const reports: SessionFidelityAudit[] = [];
  for (let number = 1; number <= 8; number += 1) reports.push(await runSimulatedPatientSession(`tbct-s${String(number).padStart(2, "0")}`));
  return reports;
}
