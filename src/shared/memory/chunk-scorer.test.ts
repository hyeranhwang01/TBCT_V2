import { describe, expect, it } from "vitest";
import { MAX_SELECTED, MAX_SELECTED_CHARS, OPENING_STEP, bigrams, containment, scoreChunks, selectChunks } from "@/shared/memory/chunk-scorer";
import { retrievalAffinityFor } from "@/shared/memory/chunk-configs";
import { authorshipViolations, bridgeTexts, retrievalProgramLines } from "@/shared/memory/memory-retrieval";
import type { MemoryChunk } from "@/types/memory-chunks";

let seq = 0;
function chunk(content: string, extra: Partial<MemoryChunk> = {}): MemoryChunk {
  seq += 1;
  return { id: `C${String(seq).padStart(3, "0")}`, participantId: "PT", runtimeSessionId: "RS-1", sessionDefinitionId: "tbct-s01", sessionIndex: 1, chunkKind: "worksheet", elementKind: "other", fieldNames: [], sourceMessageIds: [], content, distortionIds: [], sourceCreatedAt: "2026-09-20T00:00:00.000Z", indexVersion: "chunks-v1", tags: null, suppressed: false, createdAt: "2026-09-20T00:00:00.000Z", ...extra };
}

const S02 = retrievalAffinityFor("tbct-s02");
const query = (text: string, extra: Partial<Parameters<typeof scoreChunks>[1]> = {}) => ({ text, currentSessionIndex: 2, opening: false, ...extra });

describe("matching words", () => {
  it("reads Korean and English as character bigrams, ignoring spacing, punctuation and the Q/A markers", () => {
    expect([...bigrams("A: 팀장 님!")]).toEqual(["팀장", "장님"]);
    expect(containment("팀장님이 무시해요", "Q: …\nA: 회의에서 팀장님이 나를 무시했다")).toBeGreaterThan(0.5);
    expect(containment("", "anything")).toBe(0);
  });
});

describe("scoring", () => {
  const ownCase = chunk("상황: 팀 회의에서 팀장님이 내 보고서를 넘겼다\n자동적 사고: 팀장님이 나를 무시한다", { elementKind: "own_case", distortionIds: ["mind-reading"] });
  const sleep = chunk("어려움: 잠을 못 자요\n예: 새벽 3시에 깼어요", { elementKind: "problem" });
  const family = chunk("A: 엄마랑 통화하면 늘 싸우게 돼요", { chunkKind: "episode", elementKind: "conversation", tags: { domains: ["family"], persons: ["parent"], emotions: ["anger"], beliefs: [], distortions: [] } });
  const later = chunk("S02에서 나온 말", { sessionIndex: 2, elementKind: "own_case" });
  const hidden = chunk("팀장님 얘기 숨김", { elementKind: "own_case", suppressed: true });
  const all = [ownCase, sleep, family, later, hidden];

  it("never offers a chunk from this session or later, or a suppressed one", () => {
    const ids = scoreChunks(all, query("팀장님"), S02).map((item) => item.chunk.id);
    expect(ids).not.toContain(later.id);
    expect(ids).not.toContain(hidden.id);
  });

  it("brings back the participant's own moment when S02 asks for an example, and ranks what they just said above the rest", () => {
    const selected = selectChunks(scoreChunks(all, query("상사가 절 우습게 보는 것 같아요, 팀장님이요", { focusField: "distortionExamples" }), S02));
    expect(selected[0].chunk.id).toBe(ownCase.id);
    expect(selected.map((item) => item.chunk.id)).not.toContain(sleep.id);
  });

  it("finds the same person under different words through the themes", () => {
    const withThemes = selectChunks(scoreChunks(all, query("어머니랑 또 부딪혔어요", { focusField: "distortionExamples", themes: { domains: ["family"], persons: ["parent"], emotions: [], beliefs: [], distortions: [] } }), S02));
    const without = selectChunks(scoreChunks(all, query("어머니랑 또 부딪혔어요", { focusField: "distortionExamples" }), S02));
    expect(withThemes.map((item) => item.chunk.id)).toContain(family.id);
    expect(without.map((item) => item.chunk.id)).not.toContain(family.id);
  });

  it("links a shared distortion strongly", () => {
    const scored = scoreChunks([ownCase, sleep], query("", { focusField: "cdQuestFrequency", themes: { domains: [], persons: [], emotions: [], beliefs: [], distortions: ["mind-reading"] } }), S02);
    expect(scored.find((item) => item.chunk.id === ownCase.id)?.parts.tags).toBe(1);
  });

  it("at the opening, offers the own moment and homework without anything said yet", () => {
    const homework = chunk("과제 — 마음읽기 예시: 동료가 날 싫어한다", { chunkKind: "homework", elementKind: "homework" });
    const selected = selectChunks(scoreChunks([ownCase, sleep, homework], query("", { opening: true }), S02));
    expect(selected.map((item) => item.chunk.id).sort()).toEqual([ownCase.id, homework.id].sort());
    expect(S02[OPENING_STEP]).toBeDefined();
  });

  it("offers nothing when nothing fits", () => {
    expect(selectChunks(scoreChunks(all, query("날씨가 좋네요", { focusField: "sessionAgendaAgreed" }), S02))).toEqual([]);
  });

  it("is deterministic, and stays within three chunks and the character budget", () => {
    const many = Array.from({ length: 10 }, (_, index) => chunk(`팀장님 이야기 ${index} ${"가".repeat(200)}`, { elementKind: "own_case" }));
    const first = selectChunks(scoreChunks(many, query("팀장님 이야기", { focusField: "distortionExamples" }), S02));
    const again = selectChunks(scoreChunks([...many].reverse(), query("팀장님 이야기", { focusField: "distortionExamples" }), S02));
    expect(first.map((item) => item.chunk.id)).toEqual(again.map((item) => item.chunk.id));
    expect(first.length).toBeLessThanOrEqual(MAX_SELECTED);
    expect(first.reduce((sum, item) => sum + item.chunk.content.length, 0)).toBeLessThanOrEqual(MAX_SELECTED_CHARS);
  });

  it("always fits the best chunk even when it is longer than the budget for extras", () => {
    const long = chunk(`상황: 팀장님 회의 ${"가".repeat(1000)}`, { elementKind: "own_case" });
    const selected = selectChunks(scoreChunks([long], query("팀장님 회의", { focusField: "distortionExamples" }), S02));
    expect(selected.map((item) => item.chunk.id)).toEqual([long.id]);
  });

  it("puts at most one counsellor's note in, and shows it apart from the participant's words", () => {
    const notes = [chunk("팀장님 관련 메모 1", { chunkKind: "clinician_note", elementKind: "clinician_note", sessionIndex: 0 }), chunk("팀장님 관련 메모 2", { chunkKind: "clinician_note", elementKind: "clinician_note", sessionIndex: 0 })];
    const selected = selectChunks(scoreChunks([...notes, ownCase], query("팀장님", { focusField: "distortionExamples" }), S02));
    expect(selected.filter((item) => item.chunk.chunkKind === "clinician_note")).toHaveLength(1);
    const lines = retrievalProgramLines(selected);
    expect(lines[0]).toMatch(/participant's own words from before, not said today/);
    expect(lines.findIndex((line) => line.startsWith("Counsellor's note"))).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("Session 1 · 2026-09-20 · their own moment");
  });
});

describe("the authorship guard", () => {
  const remembered = ["자동적 사고: 팀장님이 나를 무시한다"];

  it("rejects a value that is in the memory but in nothing the participant said today", () => {
    expect(authorshipViolations({ distortionExamples: ["팀장님이 나를 무시한다"] }, remembered, ["네 그런 적 있어요"])).toEqual([{ name: "distortionExamples", reason: expect.stringContaining("earlier-session memory") }]);
  });

  it("accepts it once the participant says it again today, and never touches values unrelated to the memory", () => {
    expect(authorshipViolations({ distortionExamples: ["팀장님이 나를 무시한다"] }, remembered, ["맞아요, 팀장님이 나를 무시한다고 또 생각했어요"])).toEqual([]);
    expect(authorshipViolations({ homeworkReport: "이번 주엔 과제를 두 번 했어요" }, remembered, ["네"])).toEqual([]);
    expect(authorshipViolations({ distortionExamples: ["팀장님이 나를 무시한다"] }, [], [])).toEqual([]);
  });

  it("covers the basic bridge too: S01's goal is not today's answer until they say it", () => {
    const bridge = bridgeTexts({ previousS01Goal: "회의에서 한 번은 의견 말하기", previousS01Problems: ["회의에서 말을 못 해요"], homeworkReport: "x", previousHomeworkStatus: 2 });
    expect(bridge).toEqual(["회의에서 한 번은 의견 말하기", "회의에서 말을 못 해요"]);
    expect(authorshipViolations({ cdQuestReflection: "회의에서 한 번은 의견 말하기" }, bridge, ["네"])).toHaveLength(1);
    expect(authorshipViolations({ cdQuestReflection: "회의에서 한 번은 의견 말하기" }, bridge, ["저는 회의에서 한 번은 의견 말하기가 목표예요"])).toEqual([]);
  });
});
