import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RUNTIME_STORE_ENDPOINT } from "../src/shared/runtime/runtime-store-ops";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "../src/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "../src/shared/api/runtime-execution-api";
import { syntheticPatientInput } from "../src/shared/runtime/testing/session-fidelity-fixtures";
import type { PatientInput } from "../src/types/runtime-session";
import type { PromptItem } from "../src/shared/protocol/source-fidelity-types";

// Populates real patient-visible runtime sessions (Postgres-backed, via the
// running dev server's /api/runtime/session-store route) for tbct-s01..s08,
// so they show up on the patient portal ("Recent conversations" + session
// groups). AI_PROVIDER (the therapist/protocol text) stays "mock" -- that
// text is scripted verbatim protocol content, no reason to pay for it.
// ASSESSMENT_PROVIDER (semantic input validation) defaults to the free
// deterministic path, but can be switched to real Groq semantic checking
// with USE_GROQ_ASSESSMENT=true (reads GROQ_API_KEY/GROQ_MODEL from .env --
// nothing else from .env is ever loaded, so the Anthropic key never enters
// this process).
process.env.AI_PROVIDER = "mock";
if (process.env.USE_GROQ_ASSESSMENT === "true") {
  const envText = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = /^(GROQ_API_KEY|GROQ_MODEL)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1]] = match[2];
  }
  process.env.ASSESSMENT_PROVIDER = "groq";
  process.env.ALLOW_CLOUD_PATIENT_ASSESSMENT = "true";
  process.env.REDACT_CLOUD_ASSESSMENT_INPUT = "true";
} else {
  process.env.ASSESSMENT_PROVIDER = "deterministic";
  process.env.ALLOW_CLOUD_PATIENT_ASSESSMENT = "false";
}

const BASE_URL = process.env.RUNTIME_BASE_URL ?? "http://localhost:3011";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith("/")) return realFetch(`${BASE_URL}${url}`, init);
  return realFetch(input, init);
}) as typeof fetch;
void RUNTIME_STORE_ENDPOINT;

const PATIENT_ALIAS = "이서연";

// Short, colloquial "non-answers" -- used once per session as a deliberate
// trap for the shared clarification/insufficient-input validation path, then
// followed immediately by a real answer to confirm recovery.
// The deterministic (free) assessment model only recognizes a short,
// hardcoded non-answer list verbatim (see DeterministicAssessmentModel in
// src/shared/assessment/assessment-providers.ts) -- it has no semantic
// understanding, so a Korean "몰라요" style answer just gets recorded as-is.
// "idk"/"okay" are the phrases guaranteed to trip the same clarification
// path for free, so we use those for the trap turn and keep every other
// patient turn in Korean.
const TRAP_PHRASES = ["idk", "okay", "idk", "okay", "idk", "okay", "idk", "okay"];

function koreanValueFor(field: string): string {
  const key = field.toLowerCase();
  if (/candidateone.*emotion/.test(key)) return "기쁘고 안심되는 기분이 들 것 같아요.";
  if (/candidatetwo.*emotion/.test(key)) return "좀 슬프고 위축되는 기분일 것 같아요.";
  if (/candidatethree.*emotion/.test(key)) return "짜증나고 방어적인 기분이 들 것 같아요.";
  if (/candidateone.*(thought|possibility)/.test(key)) return "그 칭찬이 진심이고 저한테 진짜 기회가 있다고 생각할 것 같아요.";
  if (/candidatetwo.*(thought|possibility)/.test(key)) return "그 칭찬이 저한테는 별로 해당 안 된다고 생각할 것 같아요.";
  if (/candidatethree.*(thought|possibility)/.test(key)) return "면접관이 그냥 형식적으로 하는 말이라고 생각할 것 같아요.";
  if (/candidateone.*behavior/.test(key)) return "웃으면서 눈 마주치고 고맙다고 인사할 것 같아요.";
  if (/candidatetwo.*behavior/.test(key)) return "고개 숙이고 작은 목소리로 힘없이 대답할 것 같아요.";
  if (/candidatethree.*behavior/.test(key)) return "팔짱 끼고 퉁명스럽게 대답할 것 같아요.";
  if (/candidate.*samesituation/.test(key)) return "네, 똑같은 상황이에요.";
  if (/candidate.*reaction/.test(key)) return "긍정적일 것 같아요.";
  if (/candidate.*emotion/.test(key)) return "기쁠 것 같아요.";
  if (/candidate.*(thought|possibility)/.test(key)) return "칭찬을 그대로 믿을 것 같아요.";
  if (/candidate.*behavior/.test(key)) return "웃으면서 자신 있게 대답할 것 같아요.";
  if (/distressingsituation|situation|event|trigger|context/.test(key)) return "어제 회사에서 발표 준비하다가 실수한 일이요.";
  if (/automaticthought|workingautomaticthought|thought|belief|charge|assumption/.test(key)) return "제가 무능하다는 생각이 들었어요.";
  if (/emotion|feeling|shame|guilt|affect/.test(key)) return "많이 불안하고 좀 창피했어요.";
  if (/bodysensation/.test(key)) return "가슴이 답답하고 손에 땀이 났어요.";
  if (/behavior|action|reaction|response/.test(key)) return "그냥 자리를 피하고 아무 말도 못 했어요.";
  if (/evidence.*against|defen|counter|unrebutted/.test(key)) return "예전엔 비슷한 발표를 잘 끝낸 적도 있어요.";
  if (/evidence|prosecut/.test(key)) return "그날 발표에서 말을 좀 더듬었어요.";
  if (/conclusion|verdict|balancedconclusion/.test(key)) return "그 생각이 완전히 맞는 건 아닌 것 같아요.";
  if (/problem/.test(key)) return "요즘 계속되는 불안이 제일 힘들어요.";
  if (/goal/.test(key)) return "불안을 좀 줄이고 싶어요.";
  if (/homework|plan|obstacle/.test(key)) return "이번 주에 한 번 해볼게요.";
  if (/role|chair|ready|consent|acknowledg/.test(key)) return "네, 준비됐어요.";
  return "이번 주에 있었던 일 하나로 말씀드릴게요.";
}

function naturalAnswer(prompt: PromptItem): PatientInput {
  const generated = syntheticPatientInput(prompt);
  if (generated.kind !== "text") return generated;
  const fields = prompt.outputFields.length ? prompt.outputFields : ["response"];
  const value = fields.length > 1 ? fields.map((field) => `${field}: ${koreanValueFor(field)}`).join("; ") : koreanValueFor(fields[0]);
  return { ...generated, value };
}

function isTrapEligible(prompt: PromptItem) {
  const validation = (prompt.validation ?? {}) as { kind?: string };
  const isFreeText = !validation.kind || validation.kind === "text";
  const looksSafetySensitive = prompt.safetyRuleIds.length > 0 || prompt.outputFields.some((field) => /safety|risk|harm|danger/i.test(field));
  return isFreeText && !looksSafetySensitive;
}

type TurnLog = { turn: number; field: string; patient: string; outcome: string | undefined; trap: boolean };

async function runSession(number: number) {
  const definitionId = `tbct-s${String(number).padStart(2, "0")}`;
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: definitionId, patientAlias: PATIENT_ALIAS, locale: "ko-KR" });
  await startRuntimeSession(session.id);
  let turns = 0;
  let trapUsed = false;
  let trapPending = false;
  let trapRecovered = false;
  const log: TurnLog[] = [];

  while (turns < 300) {
    const view = await getRuntimeSession(session.id);
    if (!view) throw new Error(`${definitionId}: session disappeared mid-run`);
    if (view.session.status === "completed") break;
    if (view.session.status !== "waiting_for_input" || !view.currentPromptItem) {
      log.push({ turn: turns + 1, field: "-", patient: "-", outcome: `stopped:${view.session.status}`, trap: false });
      break;
    }
    const prompt = view.currentPromptItem;
    const trapThisTurn = !trapUsed && turns >= 1 && isTrapEligible(prompt);
    const input = trapThisTurn ? { kind: "text" as const, value: TRAP_PHRASES[(number - 1) % TRAP_PHRASES.length] } : naturalAnswer(prompt);
    const clientTurnId = `${definitionId}-turn-${turns + 1}`;
    const result = await submitPatientInput(session.id, input, { clientTurnId, expectedSessionVersion: view.session.version ?? 0 });
    turns += 1;
    if (trapThisTurn) {
      trapUsed = true;
      trapPending = result.turnOutcome === "clarification";
    } else if (trapPending && result.turnOutcome === "normal") {
      trapRecovered = true;
      trapPending = false;
    }
    log.push({ turn: turns, field: prompt.outputFields.join(",") || prompt.id, patient: String(input.value), outcome: result.turnOutcome, trap: trapThisTurn });
    console.log(`  [${definitionId}] turn ${turns}${trapThisTurn ? " (TRAP)" : ""}: ${prompt.outputFields.join(",") || prompt.id} -> ${result.turnOutcome}`);
    if (result.turnOutcome && ["safety_override", "rejected_duplicate"].includes(result.turnOutcome)) break;
  }

  const finalView = await getRuntimeSession(session.id);
  return {
    definitionId,
    runtimeSessionId: session.id,
    turns,
    trapUsed,
    trapRecovered,
    finalStatus: finalView?.session.status ?? "unknown",
    log,
  };
}

async function main() {
  const sessionNumbers = process.env.SESSION_NUMBERS
    ? process.env.SESSION_NUMBERS.split(",").map(Number)
    : Array.from({ length: Number(process.env.SESSION_COUNT ?? 8) }, (_, index) => index + 1);
  console.log(`Seeding realistic patient sessions against ${BASE_URL} (AI_PROVIDER=mock, ASSESSMENT_PROVIDER=${process.env.ASSESSMENT_PROVIDER}).`);
  const reports = [];
  for (const number of sessionNumbers) {
    console.log(`\n=== tbct-s${String(number).padStart(2, "0")} ===`);
    const report = await runSession(number);
    reports.push(report);
    console.log(`-> ${report.definitionId}: ${report.turns} turns, trap ${report.trapUsed ? (report.trapRecovered ? "recovered" : "NOT recovered") : "not injected"}, final status ${report.finalStatus}`);
  }
  const outputDir = resolve(process.cwd(), "artifacts", "realistic-patient-sessions");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify(reports, null, 2)}\n`, "utf8");
  const table = reports.map((report) => `| ${report.definitionId.toUpperCase()} | ${report.runtimeSessionId} | ${report.turns} | ${report.trapUsed ? "yes" : "no"} | ${report.trapRecovered ? "yes" : "no"} | ${report.finalStatus} |`).join("\n");
  await writeFile(resolve(outputDir, "summary.md"), `# Realistic patient session seed run\n\n| Session | Runtime session id | Turns | Trap injected | Recovered | Final status |\n|---|---|---:|---|---|---|\n${table}\n`, "utf8");
  console.log("\nDone. Summary written to artifacts/realistic-patient-sessions/summary.{json,md}");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
