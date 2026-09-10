// Local-only counseling-session runner. No dev server, no Postgres, no
// Supabase required -- only ANTHROPIC_API_KEY (optional; without it every
// turn falls back to the approved deterministic text, same as production
// does on a provider failure).
//
// Why this exists: scripts/audit-sessions-01-08.ts looks similar but is NOT
// standalone -- outside a browser/jsdom `window`, resolveStoreUrl() builds an
// absolute http://localhost:3000/... URL for every *-store call, which needs
// a running, authenticated dev server backed by a real DATABASE_URL. It also
// forces a scripted synthetic patient and never prints the conversation text
// (src/shared/runtime/testing/simulated-patient-runner.ts / audit script).
//
// This script instead monkey-patches globalThis.fetch the same way
// src/test/setup.ts does for `vitest run` -- redirecting every *-store
// endpoint to the same in-memory fakes under src/test/fakes/ -- so the
// runtime engine runs fully offline. The dialogue agent is untouched: in
// plain Node (no `window`), dialogue-agent-client.ts / runtime-orchestrator.ts
// already import the Anthropic call directly instead of going through fetch,
// so real Claude phrasing still runs whenever ANTHROPIC_API_KEY is set.
//
// Usage:
//   npx tsx scripts/run-local-session.ts tbct-s01                 # auto-play with a synthetic patient
//   npx tsx scripts/run-local-session.ts tbct-s02 --interactive   # type your own answers
//   npx tsx scripts/run-local-session.ts tbct-s03 --interactive --en

// Loads ANTHROPIC_API_KEY (and anything else) from .env.local if present, so
// the key never has to be typed into a shell command (which would persist in
// shell history) or pasted into a chat session (which would persist in
// conversation logs) -- put it in .env.local instead (already covered by
// .gitignore's ".env*" pattern, so it's never committed). Silently skipped
// if the file doesn't exist; process.loadEnvFile does not override variables
// already set in the environment.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local -- fine, fall back to whatever's already in the environment
}

import "fake-indexeddb/auto";
import { createInterface } from "node:readline";
import { RUNTIME_STORE_ENDPOINT } from "../src/shared/runtime/runtime-store-ops";
import { PARTICIPANT_STORE_ENDPOINT } from "../src/shared/runtime/participant-store-ops";
import { SAFETY_STORE_ENDPOINT } from "../src/shared/runtime/safety-store-ops";
import { PROTOCOL_STUDIO_STORE_ENDPOINT } from "../src/shared/runtime/protocol-studio-store-ops";
import { WORKSHEET_STORE_ENDPOINT } from "../src/shared/runtime/worksheet-store-ops";
import { HOMEWORK_STORE_ENDPOINT } from "../src/shared/runtime/homework-store-ops";
import { dispatchFakeRuntimeStoreOp } from "../src/test/fakes/runtime-session-store.fake";
import { dispatchFakeParticipantStoreOp } from "../src/test/fakes/participant-store.fake";
import { dispatchFakeSafetyStoreOp } from "../src/test/fakes/safety-store.fake";
import { dispatchFakeProtocolStudioStoreOp } from "../src/test/fakes/protocol-studio-store.fake";
import { dispatchFakeWorksheetStoreOp } from "../src/test/fakes/worksheet-store.fake";
import { dispatchFakeHomeworkStoreOp } from "../src/test/fakes/homework-store.fake";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "../src/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "../src/shared/api/runtime-execution-api";
import { syntheticPatientInput } from "../src/shared/runtime/testing/session-fidelity-fixtures";
import type { PatientInput } from "@/types/runtime-session";

const FAKE_STORES: Array<{ endpoint: string; dispatch: (op: unknown) => Promise<unknown> }> = [
  { endpoint: RUNTIME_STORE_ENDPOINT, dispatch: dispatchFakeRuntimeStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: PARTICIPANT_STORE_ENDPOINT, dispatch: dispatchFakeParticipantStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: SAFETY_STORE_ENDPOINT, dispatch: dispatchFakeSafetyStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: PROTOCOL_STUDIO_STORE_ENDPOINT, dispatch: dispatchFakeProtocolStudioStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: WORKSHEET_STORE_ENDPOINT, dispatch: dispatchFakeWorksheetStoreOp as (op: unknown) => Promise<unknown> },
  { endpoint: HOMEWORK_STORE_ENDPOINT, dispatch: dispatchFakeHomeworkStoreOp as (op: unknown) => Promise<unknown> },
];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const store = init?.method === "POST" ? FAKE_STORES.find((candidate) => url.endsWith(candidate.endpoint)) : undefined;
  if (store) {
    try {
      const op = JSON.parse(init!.body as string);
      const result = await store.dispatch(op);
      return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  }
  return realFetch(input, init);
}) as typeof fetch;

const args = process.argv.slice(2);
const sessionDefinitionId = args.find((arg) => !arg.startsWith("--")) ?? "tbct-s01";
const interactive = args.includes("--interactive");
const locale = args.includes("--en") ? "en-US" : "ko-KR";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("[info] ANTHROPIC_API_KEY is not set -- every turn will use the approved deterministic fallback text instead of live Claude phrasing.\n");
}

// interactive 모드에서는 "환자" 발화를 다시 찍지 않는다 -- 참가자가 방금
// [환자] 프롬프트에 직접 타이핑한 내용이 화면에 이미 보이는 상태이므로,
// 다음 루프에서 세션 히스토리를 다시 읽어와 같은 문장을 [환자]로 재출력하면
// 나(입력) / 환자(재출력) / 상담사, 이렇게 화자가 셋인 것처럼 보인다.
// [나] 프롬프트 자체를 [환자]로 통일하고, 히스토리 재출력은 상담사 메시지만
// 골라 찍어서 상담사 ↔ 환자 핑퐁 하나로 보이게 한다. auto-play(비대화형)
// 모드는 타이핑 에코가 없으므로 환자 메시지도 그대로 찍는다.
function printMessages(messages: Array<{ role: string; content: string }>, from: number, options: { skipPatient: boolean } = { skipPatient: false }) {
  for (const message of messages.slice(from)) {
    if (options.skipPatient && message.role === "patient") continue;
    const speaker = message.role === "assistant" ? "상담사" : message.role === "patient" ? "환자" : message.role;
    console.log(`\n[${speaker}] ${message.content}`);
  }
  return messages.length;
}

// node:readline's Interface auto-closes once its input stream hits EOF --
// fine for a live terminal (never reaches EOF until the user quits), but a
// piped/redirected stdin (`printf '...' | npx tsx run-local-session.ts
// tbct-s02 --interactive`, exactly how this script gets driven in CI/local
// verification without a real terminal) delivers all its bytes instantly.
// This script does real async work (session creation, store round-trips)
// before the loop's first `rl.question()` call, which is enough time for
// the interface to see EOF and close itself before anything ever asks it a
// question -- every subsequent `.question()` then throws
// ERR_USE_AFTER_CLOSE (or, via the equivalent node:readline/promises API,
// silently resolves with undefined instead of throwing). Piped input has no
// "live typing" pacing to preserve anyway, so when stdin isn't a real TTY
// this reads every line up front into a plain queue and hands them out one
// at a time -- immune to the interface's own EOF/close timing entirely.
// A real terminal (`process.stdin.isTTY`) keeps the original live
// question-per-turn behavior.
async function readAllStdinLines(): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines));
  });
}

async function main() {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId, patientAlias: "Local Test Patient", locale });
  console.log(`=== ${sessionDefinitionId} 세션 시작 (runtimeSessionId=${session.id}, locale=${locale}) ===`);
  await startRuntimeSession(session.id);

  let printed = 0;
  const isRealTerminal = Boolean(process.stdin.isTTY);
  const rl = interactive && isRealTerminal ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const pipedAnswers = interactive && !isRealTerminal ? await readAllStdinLines() : null;
  let pipedAnswerIndex = 0;

  for (let turn = 0; turn < 200; turn += 1) {
    const view = await getRuntimeSession(session.id);
    if (!view) throw new Error("세션을 다시 불러오지 못했습니다.");
    printed = printMessages(view.messages, printed, { skipPatient: interactive });

    if (view.session.status === "completed") {
      console.log("\n=== 세션 완료 ===");
      break;
    }
    if (view.session.status === "paused" || view.session.status === "safety_paused" || view.session.status === "escalated") {
      console.log(`\n=== 세션이 ${view.session.status} 상태로 멈췄습니다 (재개하려면 별도 로직 필요) ===`);
      break;
    }
    if (view.session.status !== "waiting_for_input") {
      console.log(`\n=== 예상치 못한 상태: ${view.session.status} ===`);
      break;
    }

    const prompt = view.currentPromptItem;
    if (!prompt) throw new Error("현재 활성화된 PromptItem이 없습니다.");

    let patientInput: PatientInput;
    if (interactive && pipedAnswers) {
      if (pipedAnswerIndex >= pipedAnswers.length) {
        console.log("\n=== 입력된 답변을 모두 사용했습니다 (piped stdin 소진) ===");
        break;
      }
      const answer = pipedAnswers[pipedAnswerIndex];
      pipedAnswerIndex += 1;
      console.log(`\n[환자] ${answer}`);
      if (["exit", "quit", "종료"].includes(answer.trim().toLowerCase())) break;
      patientInput = { kind: "text", value: answer };
    } else if (interactive) {
      const answer = await new Promise<string>((resolve) => rl!.question("\n[환자] ", resolve));
      if (["exit", "quit", "종료"].includes(answer.trim().toLowerCase())) break;
      patientInput = { kind: "text", value: answer };
    } else {
      patientInput = syntheticPatientInput(prompt);
    }

    await submitPatientInput(session.id, patientInput, { clientTurnId: `local-turn-${turn + 1}`, expectedSessionVersion: view.session.version ?? 0 });
  }

  rl?.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
