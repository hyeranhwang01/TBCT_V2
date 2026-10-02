import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { recordParticipantMemoryConsent } from "@/shared/api/participant-api";
import { listMemoryChunkRetrievals } from "@/shared/data/repositories/memory-chunk-repository";
import { installScriptedPromptSession, lastParticipantText, type ScriptedAnswer, type ScriptedPromptSession } from "@/test/fakes/prompt-session.fake";
import type { PromptSessionRequest } from "@/shared/dialogue-agent/prompt-session-agent";

// The whole memory path through the real runtime: a participant completes S01
// (scripted model), then S02 opens. What reaches the model on each S02 call
// depends only on their consent answer; the basic bridge is there either way;
// every call is logged; and nothing from memory can be recorded as today's
// answer. retrieval-v2 (note2026_10_02_memory_rag_v2_phase_a): the S02
// opening offers only last week's homework (none here); the S01 moment comes
// up once the model's themes point to it (the pattern the participant
// recognized in S01, kept on the chunk), and is marked when shown again.

const S01_THOUGHT = "팀장님이 나를 무시한다";

async function say(sessionId: string, text: string, turn: number) {
  const view = await getRuntimeSession(sessionId);
  await submitPatientInput(sessionId, { kind: "text", value: text }, { clientTurnId: `${sessionId}-${turn}`, expectedSessionVersion: view!.session.version ?? 0 });
}

function s01Script(request: PromptSessionRequest): ScriptedAnswer {
  const said = lastParticipantText(request);
  if (!said) return { reply: "요즘 가장 힘든 일이 뭔가요?", focusField: "s01Problems" };
  if (said.includes("회의")) return { reply: "그때 어떤 생각이 스쳤나요?", focusField: "thoughtLine", fieldUpdates: { s01Problems: ["회의에서 말을 못 해요"], s01Goal: "회의에서 한 번은 의견 말하기", situationLine: "팀 회의에서 팀장님이 내 보고서를 넘겼다" } };
  return { reply: "오늘은 여기까지 할게요.", inputHint: "none", sessionComplete: true, fieldUpdates: { thoughtLine: S01_THOUGHT, participantSelectedDistortions: ["마음읽기"] } };
}

describe("earlier-session memory in S02", () => {
  let fake: ScriptedPromptSession | undefined;
  afterEach(() => fake?.uninstall());
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
  });

  async function runS01ThenOpenS02(decision: "granted" | "declined" | undefined, s02Script: (request: PromptSessionRequest) => ScriptedAnswer) {
    fake = installScriptedPromptSession((request) => (request.sessionDefinitionId === "tbct-s01" ? s01Script(request) : s02Script(request)));
    const s01 = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s01", locale: "ko-KR" });
    if (decision) await recordParticipantMemoryConsent(s01.participantId, { decision, source: "first_visit_dialog", locale: "ko" });
    await startRuntimeSession(s01.id);
    await say(s01.id, "회의에서 말을 하려고 하면 얼어붙어요", 1);
    await say(s01.id, "팀장님이 나를 무시한다는 생각이요", 2);
    expect((await getRuntimeSession(s01.id))?.session.status).toBe("completed");
    const s02 = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR", participantId: s01.participantId });
    await startRuntimeSession(s02.id);
    const s02Requests = () => fake!.requests.filter((request) => request.sessionDefinitionId === "tbct-s02");
    return { s01, s02, s02Requests };
  }

  it("with consent: brings their own S01 moment up at the opening, logs it, and keeps it out of today's answers", async () => {
    const { s02, s02Requests } = await runS01ThenOpenS02("granted", (request) => {
      const said = lastParticipantText(request);
      if (!said) return { reply: "다시 만나서 반가워요. 오늘은 생각의 패턴을 봐요.", focusField: "distortionExamples", currentThemes: { domains: ["work_study"], persons: ["boss"], emotions: [], beliefs: [], distortions: ["mind-reading"] } };
      // The model tries to fill today's example from what it was shown.
      return { reply: "그 예를 조금 더 말해 주시겠어요?", focusField: "distortionExamples", fieldUpdates: { distortionExamples: [S01_THOUGHT] } };
    });

    const opening = s02Requests()[0].programBlock;
    // The opening goes back to the S01 diagram (book PDF p.52): their own
    // moment is offered before anything is said.
    expect(opening).toContain("Earlier-session memory (program note):");
    expect(opening).toContain(S01_THOUGHT);
    expect(opening).not.toContain("mentioned earlier today");
    // The basic bridge is there regardless.
    expect(opening).toContain("From earlier sessions (program note)");
    // No usage instructions in the block: those are the prompt's (Common §7).
    expect(opening).not.toMatch(/never record it|not said today/);

    await say(s02.id, "네 그런 적 있어요", 1);
    const afterAnswer = s02Requests().at(-1)!.programBlock;
    expect(afterAnswer).toContain(S01_THOUGHT);
    expect(afterAnswer).not.toMatch(/never record it|not said today/);

    await say(s02.id, "음 잘 모르겠어요", 2);
    expect(s02Requests().at(-1)!.programBlock).toMatch(/participant · mentioned earlier today\] .*팀장님이 나를 무시한다/);

    const view = await getRuntimeSession(s02.id);
    // Authorship: the S01 thought was not said today, so it is not today's example.
    expect(view?.session.runtimeContext.fields.distortionExamples).toBeUndefined();
    const last = view!.messages.filter((message) => message.role === "assistant").at(-1)!;
    expect(last.metadata?.rejectedFieldUpdates).toEqual([expect.objectContaining({ name: "distortionExamples" })]);
    expect(last.metadata?.memoryRetrieval).toMatchObject({ consentState: "granted", algorithmVersion: "retrieval-v2", indexVersion: "chunks-v1", surfacedThisSession: [true] });

    const log = await listMemoryChunkRetrievals(s02.id);
    expect(log.length).toBe(s02Requests().length);
    expect(log.every((entry) => entry.consentState === "granted" && entry.messageId)).toBe(true);
    // Opening: their own moment through the fixed slot; afterwards it comes
    // back on the themes and is marked as already shown today.
    expect(log[0].selected).toEqual([expect.objectContaining({ surfacedThisSession: false, parts: expect.objectContaining({ slot: 1 }) })]);
    expect(log[1].selected).toEqual([expect.objectContaining({ chunkId: log[0].selected[0].chunkId, surfacedThisSession: true, parts: expect.objectContaining({ slot: 0, tags: 0.5 }) })]);
    expect(log[2].selected).toEqual([expect.objectContaining({ chunkId: log[0].selected[0].chunkId, surfacedThisSession: true })]);
    expect(view?.memoryChunkRetrievals?.length).toBe(log.length);
    expect(view?.retrievedMemoryChunks?.some((chunk) => chunk.content.includes(S01_THOUGHT))).toBe(true);
  }, 60_000);

  it("once the participant says it themselves today, it is theirs to record", async () => {
    const { s02 } = await runS01ThenOpenS02("granted", (request) => {
      const said = lastParticipantText(request);
      if (!said) return { reply: "오늘은 생각의 패턴을 봐요.", focusField: "distortionExamples" };
      return { reply: "고마워요.", focusField: "distortionExamples", fieldUpdates: { distortionExamples: [S01_THOUGHT] } };
    });
    await say(s02.id, `이번 주에도 ${S01_THOUGHT}고 생각했어요`, 1);
    expect((await getRuntimeSession(s02.id))?.session.runtimeContext.fields.distortionExamples).toEqual([S01_THOUGHT]);
  }, 60_000);

  it("keeps what the model showed on an earlier call unrecordable, even when this call selects nothing", async () => {
    const empty = { domains: [], persons: [], emotions: [], beliefs: [], distortions: [] };
    const { s02, s02Requests } = await runS01ThenOpenS02("granted", (request) => {
      const said = lastParticipantText(request);
      if (!said) return { reply: "오늘은 생각의 패턴을 봐요.", focusField: "distortionExamples", currentThemes: { ...empty, distortions: ["mind-reading"] } };
      // The second call is shown the S01 moment and quotes it; the themes it
      // sets are empty, so the third call -- answering a bare "네" --
      // retrieves nothing.
      if (said.includes("그런 적")) return { reply: `첫 회기에 "${S01_THOUGHT}"라고 하셨죠. 오늘 순서대로 해 볼까요?`, focusField: "sessionAgendaAgreed", currentThemes: empty };
      return { reply: "알겠어요.", focusField: "distortionExamples", fieldUpdates: { distortionExamples: [S01_THOUGHT] } };
    });
    await say(s02.id, "네 그런 적 있어요", 1);
    await say(s02.id, "네", 2);
    expect(s02Requests()[1].programBlock).toContain(S01_THOUGHT);
    expect(s02Requests().at(-1)!.programBlock).not.toContain("Earlier-session memory");
    expect((await getRuntimeSession(s02.id))?.session.runtimeContext.fields.distortionExamples).toBeUndefined();
  }, 60_000);

  it("records nothing from a turn the model flags for safety, so nothing from it can become memory", async () => {
    const { s02 } = await runS01ThenOpenS02("granted", (request) => {
      const said = lastParticipantText(request);
      if (!said) return { reply: "오늘은 생각의 패턴을 봐요.", focusField: "distortionExamples" };
      return { reply: "잠깐 여쭤볼게요.", safetyConcern: true, fieldUpdates: { distortionExamples: ["다 부질없다는 생각이 들어요"] } };
    });
    await say(s02.id, "다 부질없다는 생각이 들어요", 1);
    const view = await getRuntimeSession(s02.id);
    expect(view?.session.runtimeContext.fields.distortionExamples).toBeUndefined();
    expect(view!.messages.filter((message) => message.role === "assistant").at(-1)?.metadata?.clarificationReason).toBe("safety_clarification");
  }, 60_000);

  for (const decision of ["declined", undefined] as const) {
    it(`${decision ?? "undecided"}: sends nothing from earlier sessions but the basic bridge, and records that`, async () => {
      const { s02, s02Requests } = await runS01ThenOpenS02(decision, (request) => (lastParticipantText(request) ? { reply: "알겠어요.", focusField: "distortionExamples" } : { reply: "다시 만나서 반가워요.", focusField: "distortionExamples" }));
      await say(s02.id, "팀장님 때문에 힘들었어요", 1);
      for (const request of s02Requests()) {
        expect(request.programBlock).not.toContain("Earlier-session memory");
        expect(request.programBlock).not.toContain(S01_THOUGHT);
        expect(request.history.map((message) => message.content).join("\n")).not.toContain("얼어붙어요");
      }
      expect(s02Requests()[0].programBlock).toContain("From earlier sessions (program note)");
      const log = await listMemoryChunkRetrievals(s02.id);
      expect(log.length).toBe(s02Requests().length);
      expect(log.every((entry) => entry.consentState === (decision ?? "undecided") && entry.selected.length === 0 && entry.candidateCount === 0)).toBe(true);
    }, 60_000);
  }
});
