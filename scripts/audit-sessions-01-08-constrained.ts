import "fake-indexeddb/auto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "../src/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "../src/shared/api/runtime-execution-api";
import { getLocalDb } from "../src/shared/data/db/tbct-local-db";
import { listRuntimeExecutionTraces } from "../src/shared/data/repositories/runtime-session-repository";
import { syntheticPatientInput } from "../src/shared/runtime/testing/session-fidelity-fixtures";
import { installFakeStoreFetch, resetAllFakeStores } from "../src/test/fakes/install-fake-store-fetch";
import type { PatientInput, RuntimeMessage } from "../src/types/runtime-session";

type ConstraintCase = {
  name: string;
  input: (latestProgram: string) => PatientInput;
  expectedOutcome: "clarification" | "normal";
  expectedRisk?: "low";
};

const CONSTRAINT_CASES: ConstraintCase[] = [
  { name: "empty_input", input: () => ({ kind: "text", value: "   " }), expectedOutcome: "clarification" },
  { name: "copied_program_question", input: (message) => ({ kind: "text", value: message }), expectedOutcome: "clarification" },
  { name: "low_effort_unknown", input: () => ({ kind: "text", value: "I don't know." }), expectedOutcome: "clarification" },
  { name: "low_effort_acknowledgement", input: () => ({ kind: "text", value: "Okay." }), expectedOutcome: "clarification" },
  { name: "benign_plan_not_safety", input: () => ({ kind: "text", value: "I plan to visit my mother this weekend." }), expectedOutcome: "clarification", expectedRisk: "low" },
  { name: "clarification_request", input: () => ({ kind: "text", value: "Could you say that more simply?" }), expectedOutcome: "clarification" },
  { name: "minimal_non_answer", input: () => ({ kind: "text", value: "Hmm." }), expectedOutcome: "clarification" },
  { name: "out_of_range_number", input: () => ({ kind: "rating", value: "150" }), expectedOutcome: "clarification" },
];

function loadEnvText(text: string) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function loadLocalEnvironment() {
  for (const file of [".env", ".env.local"]) {
    try { loadEnvText(await readFile(resolve(process.cwd(), file), "utf8")); } catch { /* optional */ }
  }
}

function shortNormalInput(prompt: Parameters<typeof syntheticPatientInput>[0]): PatientInput {
  const generated = syntheticPatientInput(prompt);
  if (generated.kind !== "text") return generated;
  const naturalValue = (field: string) => {
    const key = field.toLowerCase();
    if (/situation|event|trigger|context/.test(key)) return "I had too much work.";
    if (/automaticthought|thought|belief|charge|accus/.test(key)) return "I thought I was failing.";
    if (/emotion|feeling|shame|guilt|affect/.test(key)) return "I felt anxious.";
    if (/behavior|action|reaction|response/.test(key)) return "I avoided the task.";
    if (/evidence.*against|defen|counter/.test(key)) return "I finished several hard tasks.";
    if (/evidence|prosecut/.test(key)) return "I missed one deadline.";
    if (/conclusion|verdict|summary/.test(key)) return "The belief is not fully true.";
    if (/problem|difficulty/.test(key)) return "Constant anxiety.";
    if (/goal|hope|outcome/.test(key)) return "I want less anxiety.";
    // The three TBCT candidates are meant to diverge (happy/confident vs.
    // sad/discouraged vs. irritated/hostile) so the participant can compare
    // reactions to the identical compliment. Keep that divergence here
    // instead of returning the same canned answer for every candidate.
    if (/candidateone.*emotion/.test(key)) return "They felt happy and a little relieved.";
    if (/candidatetwo.*emotion/.test(key)) return "They might feel sad or discouraged.";
    if (/candidatethree.*emotion/.test(key)) return "They might feel irritated or hostile.";
    if (/candidateone.*(?:thought|possibility)/.test(key)) return "They believed the compliment was sincere and that they had a real chance.";
    if (/candidatetwo.*(?:thought|possibility)/.test(key)) return "They thought the compliment didn't really apply to them.";
    if (/candidatethree.*(?:thought|possibility)/.test(key)) return "They thought the interviewer was just being fake or manipulative.";
    if (/candidateone.*behavior/.test(key)) return "They smiled, made eye contact, and thanked the interviewer.";
    if (/candidatetwo.*behavior/.test(key)) return "They looked down and answered quietly, with little energy.";
    if (/candidatethree.*behavior/.test(key)) return "They crossed their arms and answered curtly.";
    if (/candidate.*emotion/.test(key)) return "They felt happy.";
    if (/candidate.*thought|possibility/.test(key)) return "They believed the compliment.";
    if (/candidate/.test(key)) return "They smiled and answered confidently.";
    if (/role|chair/.test(key)) return "I am ready.";
    if (/homework|plan/.test(key)) return "I will write one example.";
    return "One clear example from this week.";
  };
  const fields = prompt.outputFields;
  const value = fields.length > 1
    ? fields.map((field) => `${field}: ${naturalValue(field)}`).join("; ")
    : naturalValue(fields[0] ?? "response");
  return { ...generated, value };
}

function lastProgram(messages: RuntimeMessage[]) {
  return [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
}

function mdValue(value: unknown) {
  return `\`${JSON.stringify(value)?.replaceAll("`", "\\`") ?? "null"}\``;
}

async function runSession(sessionNumber: number) {
  const definitionId = `tbct-s${String(sessionNumber).padStart(2, "0")}`;
  const constraint = CONSTRAINT_CASES[sessionNumber - 1];
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: definitionId, patientAlias: `Short audit ${definitionId}`, locale: "en-US" });
  await startRuntimeSession(session.id);
  let submissions = 0;
  let constraintInjected = false;
  let constraintRecovered = false;
  let constraintExpectationMet = false;
  const attempts: Array<Record<string, unknown>> = [];

  while (submissions < 500) {
    const before = await getRuntimeSession(session.id);
    if (!before) throw new Error(`${definitionId}: session disappeared`);
    if (before.session.status === "completed") break;
    if (before.session.status !== "waiting_for_input" || !before.currentPromptItem) {
      attempts.push({ submission: submissions + 1, constraint: null, turnOutcome: "runtime_stopped", sessionStatus: before.session.status, nodeId: before.session.currentNodeId, promptItemId: before.currentPromptItem?.id });
      break;
    }

    const validation = (before.currentPromptItem.validation ?? {}) as { kind?: string };
    const ratingLike = validation.kind === "rating" || before.currentPromptItem.outputFields.some((field) => /rating|score|percent|intensit/i.test(field));
    const shouldInject = !constraintInjected && (constraint.name !== "out_of_range_number" || ratingLike);
    const patientInput = shouldInject
      ? constraint.input(lastProgram(before.messages))
      : shortNormalInput(before.currentPromptItem);
    const clientTurnId = `${definitionId}-short-${submissions + 1}`;
    const result = await submitPatientInput(session.id, patientInput, { clientTurnId, expectedSessionVersion: before.session.version ?? 0 });
    submissions += 1;
    const after = await getRuntimeSession(session.id);
    if (!after) throw new Error(`${definitionId}: missing after turn`);
    attempts.push({
      submission: submissions,
      clientTurnId,
      constraint: shouldInject ? constraint.name : null,
      nodeId: before.session.currentNodeId,
      promptItemId: before.currentPromptItem.id,
      programMessage: lastProgram(before.messages),
      patientInput,
      turnOutcome: result.turnOutcome,
      sessionStatus: result.sessionStatus,
      riskLevel: after.session.runtimeContext.riskLevel,
      extractedFields: result.stateExtraction?.fields ?? {},
      currentNodeAfter: after.session.currentNodeId,
      currentPromptItemAfter: after.session.currentPromptItemId,
    });
    if (shouldInject) {
      constraintInjected = true;
      constraintExpectationMet = result.turnOutcome === constraint.expectedOutcome
        && (!constraint.expectedRisk || after.session.runtimeContext.riskLevel === constraint.expectedRisk);
      constraintRecovered = result.turnOutcome === "normal";
    } else if (constraintInjected && !constraintRecovered && result.turnOutcome === "normal") {
      constraintRecovered = true;
    }
    if (result.turnOutcome && ["safety_override", "rejected_duplicate"].includes(result.turnOutcome)) break;
  }

  const view = await getRuntimeSession(session.id);
  if (!view) throw new Error(`${definitionId}: final view missing`);
  // Was reading db.runtimeExecutionTraces, a Dexie table the runtime stopped
  // writing to when the conversation store moved to Postgres (see the NOTE in
  // tbct-local-db.ts). It returned [] on every run, which made fallbackCount
  // and repairCount structurally zero AND made the pass condition below --
  // `traces.every((trace) => !trace.fallbackUsed)` -- vacuously true. The
  // script has been reporting a clean pass it never actually checked.
  const traces = await listRuntimeExecutionTraces(session.id);
  const providerEvents = view.providerEvents;
  const validations = view.validationEvents;
  const duplicateMessages = view.messages.filter((message, index, all) => message.role === "assistant" && index > 0 && all[index - 1]?.role === "assistant" && all[index - 1]?.content.trim() === message.content.trim());
  const result = view.session.status === "completed" && constraintInjected && constraintExpectationMet && constraintRecovered && !providerEvents.some((event) => event.error) && traces.every((trace) => !trace.fallbackUsed) && duplicateMessages.length === 0 ? "pass" : "fail";
  return {
    sessionId: definitionId,
    runtimeSessionId: session.id,
    releaseId: view.release.id,
    constraint: constraint.name,
    constraintInjected,
    constraintExpectationMet,
    constraintRecovered,
    totalSubmissions: submissions,
    totalMessages: view.messages.length,
    finalStatus: view.session.status,
    riskLevel: view.session.runtimeContext.riskLevel,
    completedPromptItemIds: view.session.completedPromptItemIds ?? [],
    skippedPromptItemIds: view.session.skippedPromptItemIds ?? [],
    promptExecutionStatuses: view.session.promptExecutionStatuses ?? {},
    fallbackCount: traces.filter((trace) => trace.fallbackUsed).length,
    repairCount: traces.filter((trace) => trace.validation.corrected).length,
    providerErrorCount: providerEvents.filter((event) => event.error).length,
    duplicateAssistantMessages: duplicateMessages.map((message) => message.id),
    fields: view.session.runtimeContext.fields,
    attempts,
    messages: view.messages,
    traces,
    providerEvents,
    validations,
    logs: view.logs,
    result,
  };
}

function sessionMarkdown(report: Awaited<ReturnType<typeof runSession>>) {
  const turns = report.attempts.map((attempt) => `## Submission ${attempt.submission}\n\n- Active node: ${attempt.nodeId}\n- PromptItem: ${attempt.promptItemId}\n- Program: ${attempt.programMessage}\n- Patient: ${mdValue(attempt.patientInput)}\n- Constraint: ${attempt.constraint ?? "none"}\n- Extracted fields: ${mdValue(attempt.extractedFields)}\n- Outcome: ${attempt.turnOutcome}\n- Next: ${attempt.currentNodeAfter} / ${attempt.currentPromptItemAfter}\n- Risk: ${attempt.riskLevel}`).join("\n\n");
  return `# ${report.sessionId.toUpperCase()} short constrained full run\n\n- Result: **${report.result.toUpperCase()}**\n- Final status: ${report.finalStatus}\n- Constraint: ${report.constraint}\n- Constraint expectation met: ${report.constraintExpectationMet}\n- Constraint recovered: ${report.constraintRecovered}\n- Submissions: ${report.totalSubmissions}\n- Fallbacks: ${report.fallbackCount}\n- Repairs: ${report.repairCount}\n- Provider errors: ${report.providerErrorCount}\n- Duplicate assistant messages: ${report.duplicateAssistantMessages.length}\n\n${turns}\n`;
}

async function main() {
  await loadLocalEnvironment();
  process.env.ASSESSMENT_PROVIDER = process.env.GROQ_API_KEY ? "groq" : "deterministic";
  process.env.ALLOW_CLOUD_PATIENT_ASSESSMENT = process.env.GROQ_API_KEY ? "true" : "false";
  process.env.REDACT_CLOUD_ASSESSMENT_INPUT = "true";
  // The audit exercises current assessment and deterministic routing. Patient-visible
  // fixed protocol text remains verbatim; it never fabricates a live Claude result.
  process.env.AI_PROVIDER = process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock";

  // The six Postgres-backed store endpoints are served from the in-memory
  // fakes the test suite uses, so this runs fully offline. Without it every
  // repository call fetches http://localhost:3000 and the script dies on
  // ECONNREFUSED -- which is why it silently rotted after the store moved.
  //
  // The dialogue agent is deliberately NOT faked. Under vite-node `window` is
  // undefined, so dialogue-agent-client takes the server-direct path (no
  // fetch to intercept): with ANTHROPIC_API_KEY it reaches the real Claude,
  // and without one it returns its own deterministic decision marked
  // notConfigured -- which the orchestrator does not count as a fallback, so
  // a provider-free run is not failed for a reason unrelated to fidelity.
  const dialogueProviderConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  installFakeStoreFetch();
  resetAllFakeStores();
  console.log(`dialogue provider: ${dialogueProviderConfigured ? "anthropic (live)" : "deterministic (no ANTHROPIC_API_KEY)"}`);

  const db = getLocalDb();
  await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
  const outputDir = resolve(process.cwd(), "artifacts", "session-fidelity", "short-constrained-full-run");
  await mkdir(outputDir, { recursive: true });
  const reports = [];
  for (let number = 1; number <= 8; number += 1) {
    const report = await runSession(number);
    reports.push(report);
    const slug = report.sessionId.replace("tbct-", "");
    await writeFile(resolve(outputDir, `${slug}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(resolve(outputDir, `${slug}.md`), sessionMarkdown(report), "utf8");
    console.log(`${report.sessionId}: ${report.result}, ${report.totalSubmissions} submissions, constraint=${report.constraint}`);
  }

  const table = reports.map((report) => `| ${report.sessionId.toUpperCase()} | ${report.constraint} | ${report.constraintRecovered ? "yes" : "no"} | ${report.totalSubmissions} | ${report.finalStatus} | ${report.fallbackCount} | ${report.repairCount} | ${report.providerErrorCount} | ${report.duplicateAssistantMessages.length} | ${report.result} |`).join("\n");
  const summary = `# S01-S08 short constrained full-run audit\n\n- Assessment provider: ${process.env.ASSESSMENT_PROVIDER}\n- Dialogue provider: ${dialogueProviderConfigured ? "anthropic (live)" : "deterministic (no ANTHROPIC_API_KEY)"}\n- Patient answers: short synthetic, de-identified\n- Critical-risk interruption: excluded from this completion run and should be audited separately\n\n| Session | Constraint injection | Recovered | Inputs | Final status | Fallbacks | Repairs | Provider errors | Duplicates | Result |\n|---|---|---:|---:|---|---:|---:|---:|---:|---|\n${table}\n`;
  await writeFile(resolve(outputDir, "summary.md"), summary, "utf8");
  await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), assessmentProvider: process.env.ASSESSMENT_PROVIDER, dialogueProviderConfigured, reports }, null, 2)}\n`, "utf8");

  if (reports.some((report) => report.result !== "pass")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
