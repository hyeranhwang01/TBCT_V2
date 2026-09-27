// Step fidelity of a session (.claude/TASK_SCOPE.json
// note2026_09_28_rct_backend, M2): which of the session's protocol steps were
// done, skipped or taken out of order, from two sources -- what the model
// reported on each turn (message metadata `step`, from the turn tool's
// currentStep) and what the program recorded (the session's fields, against
// each step's evidence fields). The model's report alone never makes a step
// with evidence fields "done": the program checks.

import { S01_STEPS } from "@/patient/sessions/s01/steps";
import { S02_STEPS } from "@/patient/sessions/s02/steps";
import type { StepTable } from "@/shared/trial/steps";

const STEP_TABLES: Record<string, StepTable> = { "tbct-s01": S01_STEPS, "tbct-s02": S02_STEPS };

export function stepTableFor(sessionDefinitionId: string): StepTable | undefined {
  return STEP_TABLES[sessionDefinitionId];
}

export type StepFidelity = {
  totalSteps: number;
  completedSteps: number;
  steps: Array<{ number: number; name: string; completed: boolean; reported: boolean; evidenceFields: string[] }>;
  skippedSteps: number[];
  /** Places where the reported step went backwards: [from, to]. */
  orderDeviations: Array<[number, number]>;
  highestReportedStep: number | null;
};

function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "" && value.trim() !== "—";
  if (Array.isArray(value)) return value.some(filled);
  return true;
}

export function computeStepFidelity(sessionDefinitionId: string, fields: Record<string, unknown>, reportedSteps: Array<number | null | undefined>): StepFidelity | null {
  const table = stepTableFor(sessionDefinitionId);
  if (!table) return null;
  const reported = reportedSteps.filter((step): step is number => typeof step === "number" && Number.isInteger(step));
  const reportedSet = new Set(reported);
  const highestReportedStep = reported.length ? Math.max(...reported) : null;
  const withEvidence = table.steps.map((step) => ({ step, evidence: step.evidence.filter((name) => filled(fields[name])) }));
  const highestEvidenced = Math.max(0, ...withEvidence.filter((item) => item.evidence.length).map((item) => item.step.number));
  const reach = Math.max(highestEvidenced, highestReportedStep ?? 0);
  const steps = withEvidence.map(({ step, evidence }) => {
    const completed = step.evidence.length ? evidence.length > 0 : reportedSet.has(step.number) || step.number < reach;
    return { number: step.number, name: step.name, completed, reported: reportedSet.has(step.number), evidenceFields: evidence };
  });
  // Skipped: not completed although the session went past it.
  const skippedSteps = steps.filter((step) => !step.completed && step.number < reach).map((step) => step.number);
  const orderDeviations: Array<[number, number]> = [];
  for (let index = 1; index < reported.length; index += 1) {
    if (reported[index] < reported[index - 1]) orderDeviations.push([reported[index - 1], reported[index]]);
  }
  return { totalSteps: steps.length, completedSteps: steps.filter((step) => step.completed).length, steps, skippedSteps, orderDeviations, highestReportedStep };
}
