// Local-only, offline scenario runner: plays a single depressed-patient
// persona through Sessions 1, 2, and 3 back to back and writes the full
// transcript (every assistant/patient message, plus per-turn prompt ID and
// session status) to a timestamped log file under baseline/.
//
// Reuses the same offline fake-store bootstrapping as
// scripts/run-local-session.ts (see that file's header comment for why this
// approach is needed instead of the DB-backed audit script). No dev server,
// no Postgres, no Supabase, no ANTHROPIC_API_KEY required -- every turn uses
// the approved deterministic/static text, same as production does on a
// provider failure.
//
// Usage:
//   npx tsx scripts/run-depressed-scenario.ts

import "fake-indexeddb/auto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
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

// ---------------------------------------------------------------------------
// Persona: 민지, 29세. 우울감, 무기력, 죄책감, 사회적 위축, 수면 문제를 겪는
// 가상의 내담자. 아래 답변 풀은 실제 검증에 쓰이는 syntheticPatientInput
// (src/lib/runtime/testing/session-fidelity-fixtures.ts)과 동일한 구조
// (validation.kind 기반 분기 + 필드명 정규식 매칭)를 따르되, 자유서술 내용만
// 이 우울 시나리오에 맞게 교체한 것이다. 구조적 검증(rating/boolean/enum)은
// 원본과 동일한 로직을 그대로 재사용해 프로토콜을 깨지 않는다.
// ---------------------------------------------------------------------------

const CONTENT_POOLS: Array<{ pattern: RegExp; replies: string[] }> = [
  { pattern: /situation/i, replies: [
    "어제저녁에 친구한테서 '무슨 일 있어?'라는 문자를 받았는데, 답장을 못 하고 그냥 두 시간 넘게 핸드폰만 보고 있었어요.",
    "아침에 일어나서 출근 준비를 해야 하는데, 그냥 계속 침대에 누워만 있었어요.",
    "며칠째 집에만 있었는데, 문득 방이 엉망인 걸 보고 아무것도 할 힘이 없다고 느꼈어요.",
    "점심시간에 동료들이 저를 부르는데, 그냥 자리에 앉아서 못 들은 척했어요.",
  ] },
  { pattern: /automaticThought|workingAutomaticThought|underlyingBelief/i, replies: [
    "나는 친구한테 짐만 되는 존재야, 답장할 힘도 없어.",
    "나는 아무것도 제대로 못 하는 사람이야.",
    "다들 나 없이 지내는 게 더 나을 거야.",
    "나는 결국 아무것도 해내지 못할 사람이야.",
  ] },
  { pattern: /coreBelief|positiveBelief/i, replies: [
    "저는 사랑받을 자격이 없는 사람인 것 같아요.",
    "결국 저는 사람들한테 짐이 되는 존재인 것 같아요.",
    "저는 뭘 해도 결국 실패할 사람인 것 같아요.",
  ] },
  { pattern: /emotion/i, replies: [
    "그냥 다 무기력하고 슬퍼요, 한 80% 정도요.",
    "죄책감이 크게 들었어요.",
    "아무 의욕도 없고 마음이 텅 빈 느낌이었어요.",
    "이유 없이 눈물이 날 것 같았어요.",
  ] },
  { pattern: /bodySensation/i, replies: [
    "몸이 천근만근처럼 무거웠어요.",
    "가슴이 답답하고 눈이 뜨거워졌어요.",
    "손끝 하나 움직이기도 힘들었어요.",
    "머리가 멍하고 어깨가 축 처지는 느낌이었어요.",
  ] },
  { pattern: /behavior|reaction/i, replies: [
    "그냥 핸드폰을 뒤집어 놓고 아무 답장도 안 했어요.",
    "그냥 이불 속에 계속 누워 있었어요.",
    "약속을 취소하고 방에만 있었어요.",
    "아무 말도 안 하고 그 자리를 피했어요.",
  ] },
  { pattern: /evidence/i, replies: [
    "예전에도 연락을 못 챙긴 적이 몇 번 있었어요.",
    "사실 저번 달에는 그 친구 생일도 안 잊고 챙겼어요.",
    "그 친구는 제가 힘들 때 오히려 더 걱정해줬던 사람이에요.",
    "요즘 확실히 예전만큼 사람들한테 신경을 못 쓰고 있어요.",
  ] },
  { pattern: /goal/i, replies: [
    "아침에 제시간에 일어나는 것이요.",
    "친구한테 먼저 연락해보는 것이요.",
    "하루에 한 번은 밖에 나가보는 것이요.",
    "예전에 좋아하던 일을 다시 해보는 것이요.",
  ] },
  { pattern: /problem/i, replies: [
    "아침에 일어나는 게 너무 힘들어요.",
    "사람들 연락을 자꾸 피하게 돼요.",
    "예전에 좋아하던 일에도 흥미가 안 생겨요.",
    "밤에 잠을 잘 못 자고 새벽까지 뒤척여요.",
  ] },
  { pattern: /distortion/i, replies: [
    "전부 아니면 전무라는 생각인 것 같아요.",
    "안 좋은 쪽으로만 넘겨짚는 것 같아요.",
    "다 제 탓으로 돌리는 것 같아요.",
  ] },
  { pattern: /summary/i, replies: [
    "그 생각 때문에 슬퍼졌고, 그래서 결국 답장을 안 하게 된 것 같아요.",
    "생각이 감정을 만들고, 그 감정 때문에 결국 사람들을 더 피하게 되는 것 같아요.",
    "상황이 있었고, 그 생각 때문에 슬퍼졌고, 그래서 결국 그렇게 행동하게 된 것 같아요.",
  ] },
];

let genericCounter = 0;
const fieldCounters = new Map<string, number>();
function nextReply(field: string): string {
  const bucket = CONTENT_POOLS.find((entry) => entry.pattern.test(field));
  if (bucket) {
    const index = fieldCounters.get(field) ?? 0;
    fieldCounters.set(field, index + 1);
    return bucket.replies[index % bucket.replies.length];
  }
  genericCounter += 1;
  const fallback = ["요즘은 그냥 다 그런 것 같아요.", "그런 것 같아요.", "네, 맞는 것 같아요."];
  return fallback[genericCounter % fallback.length];
}

function validationOf(prompt: PromptItem) {
  return (prompt.validation ?? {}) as { kind?: string; values?: Array<string | number>; min?: number; max?: number };
}

// Structural branching mirrors syntheticPatientInput exactly (same
// validation.kind handling) so every prompt gets a structurally valid
// answer regardless of theme -- only the free-text content differs.
function depressedPatientInput(prompt: PromptItem): PatientInput {
  const validation = validationOf(prompt);
  const fields = prompt.outputFields;
  if (validation.kind === "boolean") return { kind: "boolean", value: true };
  if (validation.kind === "enum" && validation.values?.length) {
    // Prefer a mid-to-low option over the first enum value where plausible
    // (e.g. globalEvaluation "a little better" over "same") for a more
    // clinically realistic depressed-but-engaged trajectory; otherwise fall
    // back to the first allowed value.
    const preferred = validation.values.find((value) => String(value).toLowerCase().includes("little"));
    return { kind: "single_choice", value: String(preferred ?? validation.values[0]) };
  }
  if (validation.kind === "rating" || fields.some((field) => /percent|rating|score|weight|intensit/i.test(field))) {
    const max = validation.max ?? 100;
    const value = Math.max(validation.min ?? 0, Math.min(max, max >= 10 ? 60 : max));
    return { kind: "rating", value: fields.map((_, index) => String(Math.max(validation.min ?? 0, value - index * 5))).join(", ") || String(value) };
  }
  if (fields.length > 1) {
    return { kind: "text", value: fields.map((field) => `${field}: ${nextReply(field)}`).join("; ") };
  }
  const field = fields[0] ?? "response";
  return { kind: "text", value: nextReply(field) };
}

function speakerLabel(role: string) {
  if (role === "assistant") return "상담사";
  if (role === "patient") return "민지(내담자)";
  return role;
}

async function runOneSession(sessionDefinitionId: string, log: string[]) {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId, patientAlias: "민지 (시나리오: 우울)", locale: "ko-KR" });
  log.push(`\n${"=".repeat(78)}`);
  log.push(`=== ${sessionDefinitionId} 세션 시작 (runtimeSessionId=${session.id}) ===`);
  log.push("=".repeat(78));
  await startRuntimeSession(session.id);

  let printed = 0;
  let turn = 0;
  const maxTurns = 300;
  while (turn < maxTurns) {
    const view = await getRuntimeSession(session.id);
    if (!view) throw new Error("세션을 다시 불러오지 못했습니다.");
    for (const message of view.messages.slice(printed)) {
      log.push(`\n[${speakerLabel(message.role)}] ${message.content}`);
    }
    printed = view.messages.length;

    if (view.session.status === "completed") {
      log.push(`\n--- ${sessionDefinitionId} 세션 완료 (총 ${turn}턴) ---`);
      return { status: "completed", turns: turn };
    }
    if (view.session.status !== "waiting_for_input") {
      log.push(`\n--- ${sessionDefinitionId} 세션이 "${view.session.status}" 상태로 종료됨 (총 ${turn}턴) ---`);
      return { status: view.session.status, turns: turn };
    }

    const prompt = view.currentPromptItem;
    if (!prompt) throw new Error("현재 활성화된 PromptItem이 없습니다.");
    const patientInput = depressedPatientInput(prompt);
    log.push(`  [promptId] ${prompt.id}`);
    await submitPatientInput(session.id, patientInput, { clientTurnId: `${sessionDefinitionId}-turn-${turn + 1}`, expectedSessionVersion: view.session.version ?? 0 });
    turn += 1;
  }
  log.push(`\n--- ${sessionDefinitionId} 세션이 ${maxTurns}턴 한도에 도달해 중단됨 ---`);
  return { status: "max_turns_reached", turns: turn };
}

async function main() {
  const log: string[] = [];
  log.push("TBCT S01-S03 시나리오 실행 로그");
  log.push("페르소나: 민지 (29세), 우울감·무기력·죄책감·사회적 위축·수면 문제");
  log.push(`실행 시각: ${new Date().toISOString()}`);
  log.push("환경: 오프라인 in-memory fake store, ANTHROPIC_API_KEY 없이 승인된 결정론적 텍스트로 진행");

  const summary: Array<{ session: string; status: string; turns: number }> = [];
  for (const sessionId of ["tbct-s01", "tbct-s02", "tbct-s03"]) {
    const result = await runOneSession(sessionId, log);
    summary.push({ session: sessionId, status: result.status, turns: result.turns });
  }

  log.push(`\n${"=".repeat(78)}`);
  log.push("=== 전체 요약 ===");
  for (const item of summary) log.push(`  ${item.session}: ${item.status} (${item.turns}턴)`);

  const outDir = join(process.cwd(), "baseline");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `depressed-scenario-s01-s03-${stamp}.log`);
  writeFileSync(outPath, log.join("\n"), "utf-8");

  console.log(log.join("\n"));
  console.log(`\n[저장 완료] ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
